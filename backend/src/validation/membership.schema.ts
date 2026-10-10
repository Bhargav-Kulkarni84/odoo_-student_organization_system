import { z } from 'zod';

export const membershipRequestSchema = z.object({plan_id: z.number().int().positive()});

export const membershipDecisionSchema = z.object({status: z.enum(['active', 'cancelled'])});
