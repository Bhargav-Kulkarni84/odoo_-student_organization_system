import { z } from 'zod';

export const clubJoinRequestSchema = z.object({
  message: z.string().trim().max(1000).optional().nullable(),
});

export const clubJoinDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});
