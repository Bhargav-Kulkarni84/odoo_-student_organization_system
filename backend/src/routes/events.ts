import express from 'express';
import pool from '../db/pool.js';

// Validation
import { createEventSchema } from '../validation/event.schema.js';

// Authentication
import { authenticate, authorize } from '../middlewares/auth.middlewares.js';

const router = express.Router();

// events layout , only admin eligible to create an event
router.post('/', authenticate, authorize('ADMIN'),async (req, res) => {
    
    const validation = createEventSchema.safeParse(req.body);

    //If there is validation error, do not schedule the event (add the event in the table)
    if (!validation.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validation.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    const {title,description,location,starts_at,ends_at,capacity,organizer_id} = validation.data;

    try {
        const result = await pool.query(
            `INSERT INTO events (
                title,
                description,
                location,
                starts_at,
                ends_at,
                capacity,
                organizer_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [
                title,
                description ?? null,
                location ?? null,
                starts_at,
                ends_at,
                capacity,
                organizer_id ?? null,
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

export default router;
