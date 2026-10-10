
import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';

const router = Router();

const dateSchema = z.string().date();

// GET /api/v1/financial-reports/summary?from=2026-10-01&to=2026-10-31
router.get('/summary', authenticate, async (req, res) => {
  const from = req.query.from;
  const to = req.query.to;

  if (
    (from !== undefined && !dateSchema.safeParse(from).success) ||
    (to !== undefined && !dateSchema.safeParse(to).success)
  ) {
    return res.status(400).json({
      message: 'from and to must use YYYY-MM-DD format',
    });
  }

  if (from && to && String(from) > String(to)) {
    return res.status(400).json({
      message: 'from must be on or before to',
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE direction = 'inflow'
         ), 0) AS total_inflows,
         COALESCE(SUM(amount) FILTER (
           WHERE transaction_type IN ('membership_income',
             'ticket_income', 'merchandise_income', 'fundraiser_income')
             AND direction = 'inflow'
         ), 0) AS operating_income,
         COALESCE(SUM(amount) FILTER (
           WHERE transaction_type = 'expense'
         ), 0) AS approved_expenses,
         COALESCE(SUM(amount) FILTER (
           WHERE transaction_type = 'reimbursement'
         ), 0) AS reimbursements_paid,
         COALESCE(SUM(amount) FILTER (
           WHERE direction = 'outflow'
             AND transaction_type <> 'expense'
         ), 0) AS recorded_cash_outflows
       FROM financial_transactions
       WHERE ($1::date IS NULL OR transaction_date >= $1::date)
         AND ($2::date IS NULL OR transaction_date < ($2::date + INTERVAL '1 day'))`,
      [from ?? null, to ?? null],
    );

    return res.json({
      period: { from: from ?? null, to: to ?? null },
      summary: result.rows[0],
      note: 'Approved expenses and reimbursements are reported separately to avoid double-counting the same expense.',
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to generate financial report' });
  }
});

// GET /api/v1/financial-reports/transactions
router.get('/transactions', authenticate, async (req, res) => {
  const limitParsed = z.coerce.number().int().min(1).max(100).safeParse(
    req.query.limit ?? 50,
  );

  if (!limitParsed.success) {
    return res.status(400).json({ message: 'limit must be between 1 and 100' });
  }

  try {
    const result = await pool.query(
      `SELECT id, transaction_type, direction, amount, description,
              transaction_date, source_type, source_id, recorded_by
       FROM financial_transactions
       ORDER BY transaction_date DESC
       LIMIT $1`,
      [limitParsed.data],
    );

    return res.json({ transactions: result.rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to fetch transactions' });
  }
});

export default router;
