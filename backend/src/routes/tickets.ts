import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js'

const router = Router();

// Check in a ticket using its ticket ID.
router.post('/:id/check-in', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE tickets t
       SET checked_in_at = NOW()
       FROM ticket_orders o
       WHERE t.id = $1
         AND t.ticket_order_id = o.id
         AND o.status = 'paid'
         AND t.checked_in_at IS NULL
       RETURNING t.id, t.ticket_code, t.attendee_name, t.checked_in_at`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        message: 'Ticket is invalid, not paid, or already checked in',
      });
    }

    return res.json({
      message: 'Ticket checked in successfully',
      ticket: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Ticket check-in failed' });
  }
});

export default router;
