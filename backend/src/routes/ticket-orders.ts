import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js'
import { bookTicketsSchema } from '../validation/ticket.schema.js';

const router = Router();

// Book tickets
router.post('/', authenticate, async (req, res) => {
  const parsed = bookTicketsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid booking details',
      errors: parsed.error.flatten(),
    });
  }

  const { ticket_type_id, quantity, attendee_names } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find the event, then lock it. All bookings for the same event
    // serialize here, protecting the event's overall capacity.
    const eventResult = await client.query(
      `SELECT e.id, e.capacity, e.status
       FROM events e
       JOIN ticket_types tt ON tt.event_id = e.id
       WHERE tt.id = $1`,
      [ticket_type_id]
    );

    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Ticket type not found' });
    }

    const eventId = eventResult.rows[0].id;

    const lockedEvent = await client.query(
      `SELECT id, capacity, status
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (lockedEvent.rows[0].status !== 'published') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Event is not open for booking' });
    }

    // Lock the ticket type before checking its quota.
    const typeResult = await client.query(
      `SELECT id, event_id, name, member_price, non_member_price,
              quantity_available, sales_start, sales_end
       FROM ticket_types
       WHERE id = $1
       FOR UPDATE`,
      [ticket_type_id]
    );

    const ticketType = typeResult.rows[0];

    const saleWindow = await client.query(
      `SELECT
         ($1::timestamptz IS NULL OR $1::timestamptz <= NOW()) AS started,
         ($2::timestamptz IS NULL OR $2::timestamptz > NOW()) AS not_ended`,
      [ticketType.sales_start, ticketType.sales_end]
    );

    if (!saleWindow.rows[0].started || !saleWindow.rows[0].not_ended) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Ticket sales are not open' });
    }

    // Count pending and paid tickets. Pending orders reserve capacity.
    const eventCount = await client.query(
      `SELECT COUNT(*)::int AS sold
       FROM tickets t
       JOIN ticket_orders o ON o.id = t.ticket_order_id
       JOIN ticket_types tt ON tt.id = t.ticket_type_id
       WHERE tt.event_id = $1
         AND o.status IN ('pending', 'paid')`,
      [eventId]
    );

    const typeCount = await client.query(
      `SELECT COUNT(*)::int AS sold
       FROM tickets t
       JOIN ticket_orders o ON o.id = t.ticket_order_id
       WHERE t.ticket_type_id = $1
         AND o.status IN ('pending', 'paid')`,
      [ticket_type_id]
    );

    if (eventCount.rows[0].sold + quantity > lockedEvent.rows[0].capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Not enough event capacity' });
    }

    if (typeCount.rows[0].sold + quantity > ticketType.quantity_available) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Not enough tickets available' });
    }

    // Determine the price using the user's active membership.
    const membershipResult = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM memberships
         WHERE user_id = $1
           AND status = 'active'
           AND start_date <= CURRENT_DATE
           AND end_date >= CURRENT_DATE
       ) AS is_member`,
      [req.user!.id]
    );

    const unitPrice = membershipResult.rows[0].is_member
      ? Number(ticketType.member_price)
      : Number(ticketType.non_member_price);

    const totalAmount = unitPrice * quantity;

    const orderResult = await client.query(
      `INSERT INTO ticket_orders (user_id, status, total_amount)
       VALUES ($1, 'pending', $2)
       RETURNING id, user_id, status, total_amount, created_at`,
      [req.user!.id, totalAmount]
    );

    const order = orderResult.rows[0];
    const tickets = [];

    for (let i = 0; i < quantity; i++) {
      const ticketResult = await client.query(
        `INSERT INTO tickets
           (ticket_order_id, ticket_type_id, price_paid,
            attendee_name, ticket_code)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, ticket_type_id, price_paid,
                   attendee_name, ticket_code, checked_in_at`,
        [
          order.id,
          ticket_type_id,
          unitPrice,
          attendee_names?.[i] ?? null,
          randomUUID(),
        ]
      );

      tickets.push(ticketResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Tickets reserved. Complete payment to confirm your order.',
      order,
      tickets,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Ticket booking failed' });
  } finally {
    client.release();
  }
});

// List the logged-in user's orders
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.status, o.total_amount, o.created_at,
              COUNT(t.id)::int AS ticket_count
       FROM ticket_orders o
       LEFT JOIN tickets t ON t.ticket_order_id = o.id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.user!.id]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch orders' });
  }
});

// Get one order, including its tickets. Owners only.
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id AS order_id, o.status, o.total_amount, o.created_at,
              t.id AS ticket_id, t.ticket_type_id, t.price_paid,
              t.attendee_name, t.ticket_code, t.checked_in_at
       FROM ticket_orders o
       LEFT JOIN tickets t ON t.ticket_order_id = o.id
       WHERE o.id = $1 AND o.user_id = $2
       ORDER BY t.id`,
      [req.params.id, req.user!.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    return res.json({
      order: {
        id: result.rows[0].order_id,
        status: result.rows[0].status,
        total_amount: result.rows[0].total_amount,
        created_at: result.rows[0].created_at,
      },
      tickets: result.rows
        .filter((row) => row.ticket_id !== null)
        .map((row) => ({
          id: row.ticket_id,
          ticket_type_id: row.ticket_type_id,
          price_paid: row.price_paid,
          attendee_name: row.attendee_name,
          ticket_code: row.ticket_code,
          checked_in_at: row.checked_in_at,
        })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch order' });
  }
});

// Cancel an unpaid order
router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE ticket_orders
       SET status = 'cancelled'
       WHERE id = $1
         AND user_id = $2
         AND status = 'pending'
       RETURNING id, status`,
      [req.params.id, req.user!.id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        message: 'Order not found, not yours, or cannot be cancelled',
      });
    }

    return res.json({
      message: 'Pending order cancelled; its tickets no longer reserve capacity.',
      order: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to cancel order' });
  }
});

export default router;
