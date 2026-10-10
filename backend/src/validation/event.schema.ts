import { z } from 'zod';

export const createEventSchema = z.object({

    title: z.string().trim().min(1).max(180),
    description: z.string().optional(),
    location: z.string().trim().max(255).optional(),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    capacity: z.number().int().positive(),
    organizer_id: z.number().int().positive().nullable().optional(),

})
.refine((data) => new Date(data.ends_at) > new Date(data.starts_at),
    {   
        message: 'End time must be after start time',
        path: ['ends_at'],
    }
);
