import { z } from 'zod';

export const createClubSchema = z.object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().min(10).max(5000),
    category: z.string().trim().min(2).max(80),
});

export const clubApprovalSchema = z.object({
    status: z.enum(['approved', 'rejected']),
});