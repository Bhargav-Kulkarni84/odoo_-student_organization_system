import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one field to update',
});

export const publishAnnouncementSchema = z.object({
  // Omit user_ids to target all active users.
  // Supply user_ids to target only those users.
  user_ids: z.array(z.number().int().positive()).min(1).max(5000).optional(),
});
