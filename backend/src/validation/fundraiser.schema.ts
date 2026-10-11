
import { z } from 'zod';

export const createFundraiserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  target_amount: z.number().nonnegative().nullable().optional(),
});

export const updateFundraiserSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  target_amount: z.number().nonnegative().nullable().optional(),
  status: z.enum(['planned', 'active', 'completed', 'cancelled']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one field to update',
});

export const recordDonationSchema = z.object({
  amount: z.number().positive(),
  description: z.string().trim().max(500).optional(),
});
