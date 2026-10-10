
import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';

import {createExpenseSchema,reviewExpenseSchema,reimbursementSchema} from '../validation/expense.schema.js';

const router = Router();

// GET /api/v1/expenses/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, description, amount, expense_date, receipt_url,
              status, reviewed_by, reviewed_at, reimbursed_at, created_at
       FROM expenses
       WHERE submitted_by = $1
       ORDER BY created_at DESC`,
      [req.user!.id],
    );

    return res.json({ expenses: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch your expenses' });
  }
});

// GET /api/v1/expenses?status=submitted
router.get('/', authenticate, async (req, res) => {
  const status = req.query.status;
  const allowedStatuses = [
    'submitted', 'approved', 'rejected', 'reimbursed',
  ];

  if (status !== undefined && !allowedStatuses.includes(String(status))) {
    return res.status(400).json({ message: 'Invalid expense status' });
  }

  try {
    const result = await pool.query(
      `SELECT e.id, e.description, e.amount, e.expense_date,
              e.receipt_url, e.status, e.submitted_by,
              submitter.name AS submitted_by_name,
              e.reviewed_by, reviewer.name AS reviewed_by_name,
              e.reviewed_at, e.reimbursed_at, e.created_at
       FROM expenses e
       JOIN users submitter ON submitter.id = e.submitted_by
       LEFT JOIN users reviewer ON reviewer.id = e.reviewed_by
       WHERE ($1::text IS NULL OR e.status = $1)
       ORDER BY e.created_at DESC`,
      [status === undefined ? null : String(status)],
    );

    return res.json({ expenses: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch expenses' });
  }
});

// POST /api/v1/expenses
router.post('/', authenticate, async (req, res) => {
  const parsed = createExpenseSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid expense',
      errors: parsed.error.flatten(),
    });
  }

  const data = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO expenses
         (submitted_by, description, amount, expense_date, receipt_url)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5)
       RETURNING *`,
      [
        req.user!.id,
        data.description,
        data.amount,
        data.expense_date ?? null,
        data.receipt_url ?? null,
      ],
    );

    return res.status(201).json({
      message: 'Expense submitted for review',
      expense: result.rows[0],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to submit expense' });
  }
});

// PATCH /api/v1/expenses/:id/review
router.patch('/:id/review', authenticate, async (req, res) => {
  const parsed = reviewExpenseSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid review decision',
      errors: parsed.error.flatten(),
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const expenseResult = await client.query(
      `SELECT id, description, amount, status
       FROM expenses
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if (!expenseResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Expense not found' });
    }

    const expense = expenseResult.rows[0];

    if (expense.status !== 'submitted') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Only submitted expenses can be reviewed',
      });
    }

    const { status } = parsed.data;

    const updated = await client.query(
      `UPDATE expenses
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, req.user!.id, req.params.id],
    );

    // Record approved expenses once. Rejected expenses do not enter the ledger.
    if (status === 'approved') {
      await client.query(
        `INSERT INTO financial_transactions
           (transaction_type, direction, amount, description,
            transaction_date, source_type, source_id, recorded_by)
         VALUES ('expense', 'outflow', $1, $2, NOW(), 'expense', $3, $4)
         ON CONFLICT DO NOTHING`,
        [
          expense.amount,
          expense.description,
          req.params.id,
          req.user!.id,
        ],
      );
    }

    await client.query('COMMIT');

    return res.json({
      message: `Expense ${status}`,
      expense: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Failed to review expense' });
  } finally {
    client.release();
  }
});

// PATCH /api/v1/expenses/:id/reimburse
router.patch('/:id/reimburse', authenticate, async (req, res) => {
  const parsed = reimbursementSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid reimbursement data',
      errors: parsed.error.flatten(),
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const expenseResult = await client.query(
      `SELECT id, description, amount, status
       FROM expenses
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id],
    );

    if (!expenseResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Expense not found' });
    }

    const expense = expenseResult.rows[0];

    if (expense.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'Only approved expenses can be reimbursed',
      });
    }

    const updated = await client.query(
      `UPDATE expenses
       SET status = 'reimbursed',
           reimbursed_at = COALESCE($1::timestamptz, NOW())
       WHERE id = $2
       RETURNING *`,
      [parsed.data.reimbursed_at ?? null, req.params.id],
    );

    // Record the actual reimbursement separately from the approved expense.
    await client.query(
      `INSERT INTO financial_transactions
         (transaction_type, direction, amount, description,
          transaction_date, source_type, source_id, recorded_by)
       VALUES ('reimbursement', 'outflow', $1, $2, NOW(), 'expense', $3, $4)
       ON CONFLICT DO NOTHING`,
      [
        expense.amount,
        `Reimbursement: ${expense.description}`,
        req.params.id,
        req.user!.id,
      ],
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Expense marked as reimbursed',
      expense: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: 'Failed to reimburse expense' });
  } finally {
    client.release();
  }
});

export default router;
