import pool from '../db/pool.js';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middlewares.js';
import {createTicketTypeSchema,updateTicketTypeSchema} from '../validation/ticket.schema.js';
import { Router } from 'express';

const router = Router({ mergeParams: true });

async function canManageEvent(eventId: string, userId: string, roles: string[]) {
  if (roles.some((role) => ['ADMIN', 'TEAM_LEAD'].includes(role))) return true;
  const result = await pool!.query(
    `SELECT 1
     FROM events e
     JOIN club_members cm ON cm.club_id = e.club_id
     JOIN clubs c ON c.id = e.club_id
     WHERE e.id = $1 AND cm.user_id = $2
       AND cm.role IN ('lead', 'admin') AND c.status = 'approved'`,
    [eventId, userId],
  );
  return Boolean(result.rowCount);
}

// List ticket types and live availability for a published event.
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const eventId = String((req.params as { eventId?: string }).eventId ?? '');
    if (!eventId) return res.status(400).json({ message: 'Invalid event ID' });

    const result = await pool!.query(
      `SELECT tt.id, tt.event_id, tt.name,
              tt.member_price, tt.non_member_price,
              tt.quantity_available, tt.sales_start, tt.sales_end,
              GREATEST(
                tt.quantity_available - COALESCE((
                  SELECT COUNT(*) FROM tickets t
                  JOIN ticket_orders o ON o.id = t.ticket_order_id
                  WHERE t.ticket_type_id = tt.id
                    AND o.status IN ('pending', 'paid')
                ), 0), 0
              )::int AS remaining
              , EXISTS (
                SELECT 1 FROM club_members cm
                WHERE cm.club_id = e.club_id AND cm.user_id = $2
                  AND cm.role IN ('lead', 'admin', 'member')
              ) AS is_member
       FROM ticket_types tt
       JOIN events e ON e.id = tt.event_id
       WHERE e.id = $1 AND (e.status = 'published' OR EXISTS (
         SELECT 1 FROM club_members cm JOIN clubs c ON c.id = e.club_id
         WHERE cm.club_id = e.club_id AND cm.user_id = $2
           AND cm.role IN ('lead', 'admin') AND c.status = 'approved'
       ))
       ORDER BY tt.id`,
      [eventId, req.user?.id ?? null]
    );

    if (result.rows.length === 0) {
      return res.json([]);
    }

    return res.json(result.rows);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch ticket types' });
  }
});

// Create a ticket type
router.post('/', authenticate, async (req, res) => {
  const parsed = createTicketTypeSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid ticket type',
      errors: parsed.error.flatten(),
    });
  }

  try {
    const eventId = req.params.eventId;
    if (typeof eventId !== 'string') return res.status(400).json({ message: 'Invalid event ID' });
    const data = parsed.data;

    const event = await pool!.query(
      `SELECT id FROM events WHERE id = $1`,
      [eventId]
    );

    if (event.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }
    if (!await canManageEvent(eventId, req.user!.id, req.user!.roles)) {
      return res.status(403).json({ message: 'You cannot manage tickets for this event' });
    }

    const result = await pool!.query(
      `INSERT INTO ticket_types
         (event_id, name, member_price, non_member_price,
          quantity_available, sales_start, sales_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        eventId,
        data.name,
        data.member_price,
        data.non_member_price,
        data.quantity_available,
        data.sales_start ?? null,
        data.sales_end ?? null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'A ticket type with this name already exists for this event',
      });
    }

    console.error(error);
    return res.status(500).json({ message: 'Failed to create ticket type' });
  }
});

// Update a ticket type
router.patch('/:id', authenticate, async (req, res) => {
  const parsed = updateTicketTypeSchema.safeParse(req.body);

  if (!parsed.success || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      message: 'Provide valid fields to update',
      ...(parsed.success ? {} : { errors: parsed.error.flatten() }),
    });
  }

  try {
    const data = parsed.data;
    const event = await pool!.query(
      `SELECT e.id FROM events e
       WHERE e.id = (SELECT event_id FROM ticket_types WHERE id = $1)`,
      [req.params.id],
    );
    if (event.rowCount === 0) return res.status(404).json({ message: 'Ticket type not found' });
    if (!await canManageEvent(event.rows[0].id, req.user!.id, req.user!.roles)) {
      return res.status(403).json({ message: 'You cannot manage tickets for this event' });
    }
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      values.push(value ?? null);
      fields.push(`${key} = $${values.length}`);
    }

    values.push(req.params.id);

    const result = await pool!.query(
      `UPDATE ticket_types
       SET ${fields.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Ticket type not found' });
    }

    return res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Ticket type name already exists' });
    }

    console.error(error);
    return res.status(500).json({ message: 'Failed to update ticket type' });
  }
});

export default router;
