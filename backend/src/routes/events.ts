import express from 'express';
import pool, { isDatabaseConfigured } from '../db/pool.js';
import {
    createFallbackEvent,
    getFallbackEventById,
    isDbUnavailableError,
    listFallbackEvents,
    updateFallbackEvent,
} from '../db/fallbackStore.js';

// Validation
import { createEventSchema, updateEventSchema } from '../validation/event.schema.js';

// Authentication
import { authenticate } from '../middlewares/auth.middlewares.js';

const router = express.Router();
const canManageClubEvents = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Authentication required' });
    if (req.user.roles.some((role) => ['ADMIN', 'TEAM_LEAD'].includes(role))) return next();
    if (!useDatabase()) return res.status(503).json({ success: false, message: 'Club event management requires the database' });
    let clubId = req.body?.club_id;
    try {
        if (req.params.id && !Number.isInteger(clubId)) {
            const current = await pool!.query('SELECT club_id FROM events WHERE id = $1', [req.params.id]);
            clubId = current.rows[0]?.club_id;
        }
        if (!Number.isInteger(clubId) || clubId < 1) return res.status(403).json({ success: false, message: 'An approved club is required' });
        const result = await pool!.query(
            `SELECT 1 FROM club_members cm JOIN clubs c ON c.id = cm.club_id
             WHERE cm.club_id = $1 AND cm.user_id = $2 AND cm.role IN ('lead', 'admin')
               AND c.status = 'approved'`,
            [clubId, req.user.id],
        );
        if (!result.rowCount) return res.status(403).json({ success: false, message: 'You cannot manage events for this club' });
        return next();
    } catch (error) {
        console.error('Failed to authorize club event:', error);
        return res.status(503).json({ success: false, message: 'Club event service is unavailable' });
    }
};

const useDatabase = () => isDatabaseConfigured && Boolean(pool);

// GET /api/v1/events?upcoming=true
router.get('/', async (req, res) => {
    const upcoming = req.query.upcoming === 'true';

    if (!useDatabase()) {
        const data = listFallbackEvents(upcoming);
        return res.status(200).json({ success: true, count: data.length, data });
    }

    try {
        const result = await pool!.query(
            `            SELECT e.id, e.title, e.description, e.location, e.starts_at,
                   e.ends_at, e.status, e.organizer_id, e.club_id,
                   e.created_at, c.name AS club_name
            FROM events e LEFT JOIN clubs c ON c.id = e.club_id
             WHERE e.status = 'published'
               AND ($1::boolean = false OR e.starts_at >= NOW())
             ORDER BY e.starts_at ASC`,
            [upcoming],
        );

        return res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows,
        });
    } catch (error) {
        if (isDbUnavailableError(error)) {
            const data = listFallbackEvents(upcoming);
            return res.status(200).json({ success: true, count: data.length, data });
        }

        console.error('Failed to list events:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve events',
        });
    }
});

// GET /api/v1/events/managed
// Returns drafts and published events the current user is allowed to manage.
router.get('/managed', authenticate, async (req, res) => {
    if (!useDatabase()) {
        return res.status(503).json({ success: false, message: 'Managed events require the database' });
    }

    try {
        const hasGlobalAccess = req.user!.roles.some((role) => ['ADMIN', 'TEAM_LEAD'].includes(role));
        const result = await pool!.query(
            `SELECT e.id, e.title, e.description, e.location, e.starts_at,
                    e.ends_at, e.status, e.organizer_id, e.club_id,
                    e.created_at, c.name AS club_name
             FROM events e
             LEFT JOIN clubs c ON c.id = e.club_id
             ${hasGlobalAccess
                ? ''
                : `JOIN club_members cm ON cm.club_id = e.club_id
                   WHERE cm.user_id = $1 AND cm.role IN ('lead', 'admin')
                     AND c.status = 'approved'`}
             ${hasGlobalAccess ? 'ORDER BY e.starts_at ASC' : 'ORDER BY e.starts_at ASC'}`,
            hasGlobalAccess ? [] : [req.user!.id],
        );
        return res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
    } catch (error) {
        console.error('Failed to list managed events:', error);
        return res.status(500).json({ success: false, message: 'Failed to retrieve managed events' });
    }
});

// GET /api/v1/events/:id
router.get('/:id', async (req, res) => {
    const id = req.params.id;

    if (!id || !/^[1-9]\d*$/.test(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid event ID',
        });
    }

    if (!useDatabase()) {
        const event = getFallbackEventById(Number(id));
        if (!event) {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }
        return res.status(200).json({ success: true, data: event });
    }

    try {
        const result = await pool!.query(
            `            SELECT e.id, e.title, e.description, e.location, e.starts_at,
                   e.ends_at, e.status, e.organizer_id, e.club_id,
                   e.created_at, c.name AS club_name
            FROM events e LEFT JOIN clubs c ON c.id = e.club_id
             WHERE e.id = $1 AND e.status = 'published'`,
            [id],
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
    } catch (error) {
        if (isDbUnavailableError(error)) {
            const event = getFallbackEventById(Number(id));
            if (!event) {
                return res.status(404).json({ success: false, message: 'Event not found' });
            }
            return res.status(200).json({ success: true, data: event });
        }

        console.error('Failed to fetch event:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve event',
        });
    }
});

// POST /api/v1/events
router.post('/', authenticate, canManageClubEvents, async (req, res) => {
    const validation = createEventSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validation.error.issues,
        });
    }

    const { title, description, location, starts_at, ends_at, club_id } = validation.data;

    if (!useDatabase()) {
        const event = createFallbackEvent({
            title,
            description: description ?? null,
            location: location ?? null,
            starts_at,
            ends_at,
            capacity: 0,
            organizer_id: Number(req.user?.id ?? 1),
        });

        return res.status(201).json({
            success: true,
            message: 'Event created successfully',
            data: event,
        });
    }

    try {
        const result = await pool!.query(
            `INSERT INTO events
                (title, description, location, starts_at, ends_at,
                 organizer_id, club_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
                title,
                description ?? null,
                location ?? null,
                starts_at,
                ends_at,
                req.user!.id,
                club_id ?? null,
            ],
        );

        return res.status(201).json({
            success: true,
            message: 'Event created successfully',
            data: result.rows[0],
        });
    } catch (error) {
        if (isDbUnavailableError(error)) {
            const event = createFallbackEvent({
                title,
                description: description ?? null,
                location: location ?? null,
                starts_at,
                ends_at,
                capacity: 0,
                organizer_id: Number(req.user?.id ?? 1),
            });

            return res.status(201).json({
                success: true,
                message: 'Event created successfully',
                data: event,
            });
        }

        console.error('Failed to create event:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create event',
        });
    }
});

// PATCH /api/v1/events/:id
router.patch('/:id', authenticate, canManageClubEvents, async (req, res) => {
    const id = req.params.id;

    if (!id) {
        return res.status(400).json({
            success: false,
            message: 'Invalid event ID',
        });
    }

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

    if (!useDatabase()) {
        const current = getFallbackEventById(Number(id));
        if (!current) {
            return res.status(404).json({ success: false, message: 'Event not found' });
        }

        const updates = validation.data;
        const startsAt = updates.starts_at ?? current.starts_at;
        const endsAt = updates.ends_at ?? current.ends_at;

        if (new Date(endsAt) <= new Date(startsAt)) {
            return res.status(400).json({
                success: false,
                message: 'End time must be after start time',
            });
        }

        const updated = updateFallbackEvent(Number(id), { ...updates, starts_at: startsAt, ends_at: endsAt });
        return res.status(200).json({
            success: true,
            message: 'Event updated successfully',
            data: updated,
        });
    }

    try {
        const currentResult = await pool!.query('SELECT * FROM events WHERE id = $1', [id]);

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

        const fields = Object.keys(updates) as Array<keyof typeof updates>;
        const values = fields.map((field) => updates[field]);
        const assignments = fields.map((field, index) => `${field} = $${index + 1}`);

        values.push(id);

        const result = await pool!.query(
            `UPDATE events
                 SET ${assignments.join(', ')}
                 WHERE id = $${values.length}
                 RETURNING *`,
            values,
        );

        return res.status(200).json({
            success: true,
            message: 'Event updated successfully',
            data: result.rows[0],
        });
    } catch (error) {
        if (isDbUnavailableError(error)) {
            const current = getFallbackEventById(Number(id));
            if (!current) {
                return res.status(404).json({ success: false, message: 'Event not found' });
            }
            const updates = validation.data;
            const startsAt = updates.starts_at ?? current.starts_at;
            const endsAt = updates.ends_at ?? current.ends_at;
            if (new Date(endsAt) <= new Date(startsAt)) {
                return res.status(400).json({ success: false, message: 'End time must be after start time' });
            }
            const updated = updateFallbackEvent(Number(id), { ...updates, starts_at: startsAt, ends_at: endsAt });
            return res.status(200).json({ success: true, message: 'Event updated successfully', data: updated });
        }

        console.error('Failed to update event:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update event',
        });
    }
});

router.delete('/:id', authenticate, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) {
        return res.status(400).json({ success: false, message: 'Invalid event ID' });
    }
    if (!useDatabase()) {
        return res.status(503).json({ success: false, message: 'Event deletion requires the database' });
    }
    try {
        const event = await pool!.query('SELECT club_id FROM events WHERE id = $1', [id]);
        if (!event.rowCount) return res.status(404).json({ success: false, message: 'Event not found' });
        const clubId = event.rows[0].club_id;
        const isGlobalManager = req.user!.roles.some((role) => ['ADMIN', 'TEAM_LEAD'].includes(role));
        if (!isGlobalManager) {
            const membership = await pool!.query(
                `SELECT 1 FROM club_members cm JOIN clubs c ON c.id = cm.club_id
                 WHERE cm.club_id = $1 AND cm.user_id = $2
                   AND cm.role IN ('lead', 'admin') AND c.status = 'approved'`,
                [clubId, req.user!.id],
            );
            if (!membership.rowCount) return res.status(403).json({ success: false, message: 'You cannot delete this event' });
        }

        const tickets = await pool!.query(
            `SELECT COUNT(*)::int AS count
             FROM tickets t
             JOIN ticket_types tt ON tt.id = t.ticket_type_id
             WHERE tt.event_id = $1`,
            [id],
        );
        if (tickets.rows[0].count > 0) {
            return res.status(409).json({
                success: false,
                message: 'This event cannot be deleted because tickets have already been issued. Cancel the event instead to preserve ticket and receipt history.',
            });
        }

        await pool!.query('DELETE FROM events WHERE id = $1', [id]);
        return res.json({ success: true, message: 'Event deleted successfully' });
    } catch (error) {
        if ((error as { code?: string }).code === '23503') {
            return res.status(409).json({
                success: false,
                message: 'This event cannot be deleted because it has issued tickets or related financial records. Cancel the event instead to preserve history.',
            });
        }
        console.error('Failed to delete event:', error);
        return res.status(500).json({ success: false, message: 'Failed to delete event' });
    }
});

export default router;
