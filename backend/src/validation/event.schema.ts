import { z } from 'zod';

const eventFields = {
    title: z.string().trim().min(1).max(180),
    description: z.string().max(5000).nullable().optional(),
    location: z.string().trim().max(255).nullable().optional(),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    capacity: z.coerce.number().int().positive(),
    club_id: z.preprocess((value) => value === '' || value === undefined ? undefined : value === null ? null : Number(value), z.number().int().positive().nullable().optional()),
    status: z.enum(['draft', 'published', 'cancelled', 'completed']),
};

export const createEventSchema = z.object({
    title: eventFields.title,
    description: eventFields.description,
    location: eventFields.location,
    starts_at: eventFields.starts_at,
    ends_at: eventFields.ends_at,
    capacity: eventFields.capacity,
    club_id: eventFields.club_id,
}).refine(
    (data) => new Date(data.ends_at) > new Date(data.starts_at),
    {
        message: 'End time must be after start time',
        path: ['ends_at'],
    }
);

export const updateEventSchema = z.object({
    title: eventFields.title.optional(),
    description: eventFields.description,
    location: eventFields.location,
    starts_at: eventFields.starts_at.optional(),
    ends_at: eventFields.ends_at.optional(),
    capacity: eventFields.capacity.optional(),
    status: eventFields.status.optional(),
    club_id: eventFields.club_id,
}).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'Provide at least one field to update' }
);
