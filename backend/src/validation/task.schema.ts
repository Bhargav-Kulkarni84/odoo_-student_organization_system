
import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  fundraiser_id: z.number().int().positive().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  fundraiser_id: z.number().int().positive().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  status: z.enum(['todo', 'in_progress', 'done', 'cancelled']).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one field to update',
});

export const assignTaskSchema = z.object({
  user_ids: z.array(z.number().int().positive()).min(1).max(200),
});
