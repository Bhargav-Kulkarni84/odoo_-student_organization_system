
import { z } from 'zod';

export const createExpenseSchema = z.object({
  description: z.string().trim().min(1).max(1000),
  amount: z.number().positive(),
  expense_date: z.string().date().optional(),
  receipt_url: z.string().url().max(2000).nullable().optional(),
});

export const reviewExpenseSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

export const reimbursementSchema = z.object({
  reimbursed_at: z.string().datetime().optional(),
});
