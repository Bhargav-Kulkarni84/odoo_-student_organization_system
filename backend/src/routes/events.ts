import express from 'express';
import pool from '../db/pool.js';

// Validation
import { createEventSchema,updateEventSchema } from '../validation/event.schema.js';

// Authentication
import { authenticate, authorize } from '../middlewares/auth.middlewares.js';

const router = express.Router();

const canManageEvents = authorize('ADMIN', 'TEAM_LEAD');

// GET /api/v1/events?upcoming=true
// Public listing shows published events only.
router.get('/', async (req, res) => {
    const upcoming = req.query.upcoming === 'true';

    try {
        const result = await pool.query(
            `SELECT id, title, description, location, starts_at,
                    ends_at, capacity, status, organizer_id, created_at
             FROM events
             WHERE status = 'published'
               AND ($1::boolean = false OR starts_at >= NOW())
             ORDER BY starts_at ASC`,
            [upcoming]
        );

        return res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows,
        });
    } 
    catch (error) {
        console.error('Failed to list events:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve events',
        });
    }
});

// GET /api/v1/events/:id
// Get event from event id.
router.get('/:id', async (req, res) => {
    const id = req.params.id;

    if (!id || !/^[1-9]\d*$/.test(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid event ID',
        });
    }

    try {
        const result = await pool.query(
            `SELECT id, title, description, location, starts_at,
                    ends_at, capacity, status, organizer_id, created_at
             FROM events
             WHERE id = $1 AND status = 'published'`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Event not found',
            });
        }

        return res.status(200).json({
            success: true,
            data: result.rows[0],
        });
    } 
    catch (error) {
        console.error('Failed to fetch event:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve event',
        });
    }
});

// POST /api/v1/events
//Allow creation of new event only to TeamLead and Manager
router.post('/', authenticate, canManageEvents, async (req, res) => {
    const validation = createEventSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validation.error.issues,
        });
    }

    const {title, description, location, starts_at, ends_at, capacity} = validation.data;

    try {
        const result = await pool.query(
            `INSERT INTO events
                (title, description, location, starts_at, ends_at,
                 capacity, organizer_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                title,
                description ?? null,
                location ?? null,
                starts_at,
                ends_at,
                capacity,
                req.user!.id,
            ]
        );

        return res.status(201).json({
            success: true,
            message: 'Event created successfully',
            data: result.rows[0],
        });
    } 
    catch (error) {
        console.error('Failed to create event:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create event',
        });
    }
});

// PATCH /api/v1/events/:id
//Update the previously scheduled event
router.patch('/:id',authenticate,canManageEvents,async (req, res) => {
        
    const id = req.params.id;
        
        if (!id){
            return res.status(400).json({
                success: false,
                message: 'Invalid event ID',
            });
        }

        // type check to make sure it's a single string, not an array
        if (!id || typeof id !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Invalid event ID format',
            });
        }

        const validation = updateEventSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.error.issues,
            });
        }

        try {
            const currentResult = await pool.query(`SELECT * FROM events WHERE id = $1`,[id]);

            if (currentResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Event not found',
                });
            }

            const current = currentResult.rows[0];
            const updates = validation.data;

            const startsAt = updates.starts_at ?? current.starts_at;
            const endsAt = updates.ends_at ?? current.ends_at;

            if (new Date(endsAt) <= new Date(startsAt)) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be after start time',
                });
            }

            const fields = Object.keys(updates) as Array<
                keyof typeof updates
            >;

            const values = fields.map((field) => updates[field]);
            const assignments = fields.map(
                (field, index) => `${field} = $${index + 1}`
            );

            values.push(id);

            const result = await pool.query(
                `UPDATE events
                 SET ${assignments.join(', ')}
                 WHERE id = $${values.length}
                 RETURNING *`,
                values
            );

            return res.status(200).json({
                success: true,
                message: 'Event updated successfully',
                data: result.rows[0],
            });
        } catch (error) {
            console.error('Failed to update event:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to update event',
            });
        }
    }
);

export default router;
