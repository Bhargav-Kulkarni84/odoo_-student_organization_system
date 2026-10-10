
import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {createFundraiserSchema,updateFundraiserSchema,recordDonationSchema} from '../validation/fundraiser.schema.js';

const router = Router();

// GET /api/v1/fundraisers
router.get('/', async (req, res) => {
  try {
    const status = req.query.status;

    if (
      status !== undefined &&
      !['planned', 'active', 'completed', 'cancelled'].includes(String(status))
    ) {
      return res.status(400).json({ message: 'Invalid fundraiser status' });
    }

    const result = await pool.query(
      `SELECT f.id, f.name, f.description, f.starts_at, f.ends_at,
              f.target_amount, f.status, f.created_at,
              COALESCE(
                SUM(ft.amount) FILTER (WHERE ft.direction = 'inflow'), 0
              ) AS total_raised
       FROM fundraisers f
       LEFT JOIN financial_transactions ft
         ON ft.source_type = 'fundraiser'
        AND ft.source_id = f.id
        AND ft.transaction_type = 'fundraiser_income'
       WHERE ($1::text IS NULL OR f.status = $1)
       GROUP BY f.id
       ORDER BY f.created_at DESC`,
      [status === undefined ? null : String(status)],
    );

    return res.json({ fundraisers: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch fundraisers' });
  }
});

// GET /api/v1/fundraisers/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.name, f.description, f.starts_at, f.ends_at,
              f.target_amount, f.status, f.created_at,
              COALESCE(
                SUM(ft.amount) FILTER (WHERE ft.direction = 'inflow'), 0
              ) AS total_raised
       FROM fundraisers f
       LEFT JOIN financial_transactions ft
         ON ft.source_type = 'fundraiser'
        AND ft.source_id = f.id
        AND ft.transaction_type = 'fundraiser_income'
       WHERE f.id = $1
       GROUP BY f.id`,
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Fundraiser not found' });
    }

    return res.json({ fundraiser: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch fundraiser' });
  }
});

// POST /api/v1/fundraisers
router.post('/', authenticate, async (req, res) => {
  const parsed = createFundraiserSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid fundraiser',
      errors: parsed.error.flatten(),
    });
  }

  const data = parsed.data;

  if (
    data.starts_at && data.ends_at &&
    new Date(data.ends_at) < new Date(data.starts_at)
  ) {
    return res.status(400).json({
      message: 'ends_at cannot be earlier than starts_at',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO fundraisers
         (name, description, starts_at, ends_at, target_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.name,
        data.description ?? null,
        data.starts_at ?? null,
        data.ends_at ?? null,
        data.target_amount ?? null,
        req.user!.id,
      ],
    );

    return res.status(201).json({ fundraiser: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to create fundraiser' });
  }
});

// PATCH /api/v1/fundraisers/:id
router.patch('/:id', authenticate, async (req, res) => {
  const parsed = updateFundraiserSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid fundraiser update',
      errors: parsed.error.flatten(),
    });
  }

  const data = parsed.data;

  if (
    data.starts_at && data.ends_at &&
    new Date(data.ends_at) < new Date(data.starts_at)
  ) {
    return res.status(400).json({
      message: 'ends_at cannot be earlier than starts_at',
    });
  }

  const allowed = [
    'name', 'description', 'starts_at', 'ends_at',
    'target_amount', 'status',
  ] as const;

  const fields = allowed.filter((key) =>
    Object.prototype.hasOwnProperty.call(data, key),
  );

  try {
    const values = fields.map((key) => data[key]);
    const assignments = fields.map(
      (key, index) => `${key} = $${index + 1}`,
    );

    const result = await pool.query(
      `UPDATE fundraisers
       SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1}
       RETURNING *`,
      [...values, req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Fundraiser not found' });
    }

    return res.json({ fundraiser: result.rows[0] });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to update fundraiser' });
  }
});

// POST /api/v1/fundraisers/:id/donations
// Use only for donations already received and verified outside this endpoint.
// This is not a public payment or donation checkout endpoint.
router.post('/:id/donations', authenticate, async (req, res) => {
  const parsed = recordDonationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid donation',
      errors: parsed.error.flatten(),
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const fundraiser = await client.query(
      `SELECT id, name, status
       FROM fundraisers
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if (!fundraiser.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Fundraiser not found' });
    }

    if (fundraiser.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Donations can only be recorded for active fundraisers',
      });
    }

    const { amount, description } = parsed.data;

    const transaction = await client.query(
      `INSERT INTO financial_transactions
         (transaction_type, direction, amount, description,
          source_type, source_id, recorded_by)
       VALUES (
         'fundraiser_income', 'inflow', $1, $2,
         'fundraiser', $3, $4
       )
       RETURNING *`,
      [
        amount,
        description ?? `Donation for ${fundraiser.rows[0].name}`,
        req.params.id,
        req.user!.id,
      ],
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Received donation recorded',
      transaction: transaction.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Failed to record donation' });
  } finally {
    client.release();
  }
});

// GET /api/v1/fundraisers/:id/donations
router.get('/:id/donations', authenticate, async (req, res) => {
  try {
    const fundraiser = await pool.query(
      `SELECT id FROM fundraisers WHERE id = $1`,
      [req.params.id],
    );

    if (!fundraiser.rowCount) {
      return res.status(404).json({ message: 'Fundraiser not found' });
    }

    const result = await pool.query(
      `SELECT id, amount, description, transaction_date, recorded_by
       FROM financial_transactions
       WHERE source_type = 'fundraiser'
         AND source_id = $1
         AND transaction_type = 'fundraiser_income'
         AND direction = 'inflow'
       ORDER BY transaction_date DESC`,
      [req.params.id],
    );

    return res.json({ donations: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch donations' });
  }
});

export default router;
