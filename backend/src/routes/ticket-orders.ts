import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js'
import { bookTicketsSchema } from '../validation/ticket.schema.js';
import { createReceiptDownloadUrl, uploadReceipt } from '../services/supabase-storage.js';

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

    // Find the event associated with the ticket type.
    const eventResult = await client.query(
      `SELECT e.id, e.status, e.title, e.starts_at, e.ends_at, e.location,
              c.name AS club_name
       FROM events e
       JOIN ticket_types tt ON tt.event_id = e.id
       LEFT JOIN clubs c ON c.id = e.club_id
       WHERE tt.id = $1`,
      [ticket_type_id]
    );

    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Ticket type not found' });
    }

    const eventId = eventResult.rows[0].id;

    if (eventResult.rows[0].status !== 'published') {
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

    const typeCount = await client.query(
      `SELECT COUNT(*)::int AS sold
       FROM tickets t
       JOIN ticket_orders o ON o.id = t.ticket_order_id
       WHERE t.ticket_type_id = $1
         AND o.status IN ('pending', 'paid')`,
      [ticket_type_id]
    );

    if (typeCount.rows[0].sold + quantity > ticketType.quantity_available) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Not enough tickets available' });
    }

    // Determine the price using the user's active membership.
    const membershipResult = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM club_members cm
         JOIN events e ON e.club_id = cm.club_id
         WHERE e.id = $1 AND cm.user_id = $2
           AND cm.role IN ('lead', 'admin', 'member')
       ) AS is_member`,
      [eventId, req.user!.id]
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

    const receiptPath = `orders/${order.id}/receipt.html`;
    let receiptStatus = 'unavailable';
    try {
      await uploadReceipt(receiptPath, buildReceiptHtml({
        order,
        event: eventResult.rows[0],
        ticketType,
        tickets,
      }));
      await pool.query(
        'UPDATE ticket_orders SET receipt_path = $1 WHERE id = $2 AND user_id = $3',
        [receiptPath, order.id, req.user!.id],
      );
      receiptStatus = 'stored';
    } catch (receiptError) {
      console.error('Failed to store ticket receipt:', receiptError);
    }

    return res.status(201).json({
      message: 'Tickets reserved. Complete payment to confirm your order.',
      order,
      tickets,
      receipt: { status: receiptStatus },
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
              (o.receipt_path IS NOT NULL) AS receipt_available,
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
      `SELECT o.id AS order_id, o.status, o.total_amount, o.created_at, o.receipt_path,
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
        receipt_available: Boolean(result.rows[0].receipt_path),
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

// Generate a short-lived link for the owner's private receipt.
router.get('/:id/receipt', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT receipt_path
       FROM ticket_orders
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id],
    );
    if (!result.rowCount) return res.status(404).json({ message: 'Order not found' });
    if (!result.rows[0].receipt_path) {
      return res.status(404).json({ message: 'Receipt is not available for this order yet' });
    }
    const url = await createReceiptDownloadUrl(result.rows[0].receipt_path);
    return res.json({ url, expires_in: 3600 });
  } catch (error) {
    console.error('Failed to create receipt link:', error);
    return res.status(503).json({ message: 'Receipt storage is temporarily unavailable' });
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

function buildReceiptHtml(input: {
  order: { id: number; total_amount: number; created_at: string };
  event: { title: string; starts_at: string; ends_at: string; location?: string; club_name?: string };
  ticketType: { name: string };
  tickets: Array<{ ticket_code: string; attendee_name?: string | null; price_paid: number }>;
}) {
  const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] || character));
  const rows = input.tickets.map((ticket) => `
    <tr><td>${e(ticket.attendee_name || 'Attendee')}</td><td>${e(ticket.ticket_code)}</td><td>${e(ticket.price_paid)}</td></tr>
  `).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${e(input.order.id)}</title>
    <style>body{font-family:Arial,sans-serif;color:#102a43;max-width:760px;margin:40px auto;padding:0 24px}
    header{border-bottom:3px solid #bce9d7;padding-bottom:20px}h1{margin:0 0 8px}p{color:#52697b}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}
    .meta div{padding:12px;background:#f4f7f8;border-radius:8px}small{display:block;color:#718394;margin-bottom:5px}
    table{width:100%;border-collapse:collapse;margin-top:20px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dfe7eb}
    th{font-size:12px;color:#718394;text-transform:uppercase}.total{text-align:right;font-size:18px;font-weight:bold;margin-top:24px}</style></head>
    <body><header><h1>Gather ticket receipt</h1><p>Order #${e(input.order.id)} · ${e(input.order.created_at)}</p></header>
    <h2>${e(input.event.title)}</h2><p>${e(input.event.club_name || 'Independent event')} · ${e(input.event.location || 'Location not provided')}</p>
    <div class="meta"><div><small>Event starts</small>${e(input.event.starts_at)}</div><div><small>Ticket type</small>${e(input.ticketType.name)}</div></div>
    <table><thead><tr><th>Attendee</th><th>Ticket code</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total">Total: ${e(input.order.total_amount)}</div></body></html>`;
}
