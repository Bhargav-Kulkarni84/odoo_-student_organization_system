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
  audience: z.enum(['all_users', 'event_participants', 'club_members', 'club_user', 'individual_users']).default('all_users'),
  event_id: z.coerce.number().int().positive().optional(),
  club_id: z.coerce.number().int().positive().optional(),
  user_ids: z.array(z.number().int().positive()).min(1).max(5000).optional(),
}).superRefine((data, context) => {
  if (data.audience === 'event_participants' && !data.event_id) {
    context.addIssue({ code: 'custom', path: ['event_id'], message: 'event_id is required for event participants' });
  }
  if ((data.audience === 'club_members' || data.audience === 'club_user') && !data.club_id) {
    context.addIssue({ code: 'custom', path: ['club_id'], message: 'club_id is required for club audiences' });
  }
  if (data.audience === 'individual_users' && !data.user_ids?.length) {
    context.addIssue({ code: 'custom', path: ['user_ids'], message: 'user_ids is required for individual users' });
  }
});
