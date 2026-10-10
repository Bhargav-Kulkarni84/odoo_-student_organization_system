import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {createTicketTypeSchema,updateTicketTypeSchema} from '../validation/ticket.schema.js';
import { Request, Response , Router} from 'express';

const router = Router({ mergeParams: true });

interface RouteParams {
  eventId: string;
}

// List ticket types for a published event
router.get('/', async (req: Request<RouteParams>, res: Response) => {
  try {
    const { eventId } = req.params;

    const result = await pool.query(
      `SELECT tt.id, tt.event_id, tt.name,
              tt.member_price, tt.non_member_price,
              tt.quantity_available, tt.sales_start, tt.sales_end
       FROM ticket_types tt
       JOIN events e ON e.id = tt.event_id
       WHERE e.id = $1 AND e.status = 'published'
       ORDER BY tt.id`,
      [eventId]
    );

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
    const { eventId } = req.params;
    const data = parsed.data;

    const event = await pool.query(
      `SELECT id FROM events WHERE id = $1`,
      [eventId]
    );

    if (event.rowCount === 0) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const result = await pool.query(
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
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      values.push(value ?? null);
      fields.push(`${key} = $${values.length}`);
    }

    values.push(req.params.id);

    const result = await pool.query(
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
