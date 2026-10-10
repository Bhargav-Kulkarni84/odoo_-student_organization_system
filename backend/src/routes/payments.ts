
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import { createPaymentSchema } from '../validation/payment.schema.js';

const router = Router();

// POST /api/v1/payments
// Initiates a payment record. It does NOT mark the purchase as paid.
router.post('/', authenticate, async (req, res) => {
  const parsed = createPaymentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid payment request',
      errors: parsed.error.flatten(),
    });
  }

  const { reference_type, reference_id } = parsed.data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let amount: string | number;
    let referenceColumn: string;
    let ownershipQuery: string;

    if (reference_type === 'membership') {
      referenceColumn = 'membership_id';

      ownershipQuery = `
        SELECT m.id, mp.price AS amount
        FROM memberships m
        JOIN membership_plans mp ON mp.id = m.plan_id
        WHERE m.id = $1 AND m.user_id = $2
          AND m.status = 'pending'
        FOR UPDATE OF m
      `;
    } else if (reference_type === 'ticket_order') {
      referenceColumn = 'ticket_order_id';

      ownershipQuery = `
        SELECT id, total_amount AS amount
        FROM ticket_orders
        WHERE id = $1 AND user_id = $2 AND status = 'pending'
        FOR UPDATE
      `;
    } else {
      referenceColumn = 'order_id';

      ownershipQuery = `
        SELECT id, total_amount AS amount
        FROM orders
        WHERE id = $1 AND user_id = $2 AND status = 'pending'
        FOR UPDATE
      `;
    }

    const purchase = await client.query(
      ownershipQuery,
      [reference_id, req.user!.id],
    );

    if (!purchase.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        message: 'Purchase not found, not owned by you, or not pending',
      });
    }

    amount = purchase.rows[0].amount;

    // Accept a caller-provided idempotency key to avoid duplicate attempts
    // when the same request is retried. Generate one if not supplied.
    const suppliedKey = req.get('Idempotency-Key');
    const idempotencyKey = suppliedKey || randomUUID();

    if (idempotencyKey.length > 255) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Idempotency-Key must be 255 characters or fewer',
      });
    }

    const existing = await client.query(
      `SELECT * FROM payments WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    if (existing.rowCount) {
      const payment = existing.rows[0];
      const samePurchase =
        String(payment[referenceColumn]) === String(reference_id);

      if (!samePurchase) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          message: 'Idempotency key has already been used for another purchase',
        });
      }

      await client.query('COMMIT');
      return res.json({
        message: 'Existing payment attempt returned',
        payment,
      });
    }

    const referenceColumns: Record<string, string> = {
      membership: 'membership_id',
      ticket_order: 'ticket_order_id',
      order: 'order_id',
    };

    const columns = referenceColumns[reference_type];

    const paymentResult = await client.query(
      `INSERT INTO payments
         (${columns}, amount, currency, status, idempotency_key)
       VALUES ($1, $2, 'INR', 'pending', $3)
       RETURNING id, ${columns}, amount, currency, status,
                 provider, provider_reference, created_at`,
      [reference_id, amount, idempotencyKey],
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Payment attempt created; payment is not yet confirmed',
      payment: paymentResult.rows[0],
    });
  } catch (error: any) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      return res.status(409).json({
        message: 'Duplicate payment attempt. Retry with the same idempotency key.',
      });
    }

    console.error(error);
    return res.status(500).json({ message: 'Failed to initiate payment' });
  } finally {
    client.release();
  }
});

// GET /api/v1/payments/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.membership_id, p.ticket_order_id, p.order_id,
              p.amount, p.currency, p.status, p.provider,
              p.provider_reference, p.paid_at, p.created_at
       FROM payments p
       LEFT JOIN memberships m ON m.id = p.membership_id
       LEFT JOIN ticket_orders t ON t.id = p.ticket_order_id
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE m.user_id = $1 OR t.user_id = $1 OR o.user_id = $1
       ORDER BY p.created_at DESC`,
      [req.user!.id],
    );

    return res.json({ payments: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch payments' });
  }
});

export default router;
