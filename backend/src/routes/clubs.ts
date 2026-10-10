import express from 'express';
import pool from '../db/pool.js';
import { authenticate, authorize } from '../middlewares/auth.middlewares.js';
import { clubApprovalSchema, createClubSchema } from '../validation/club.schema.js';

const router = express.Router();
const requireDatabase = () => {
    if (!pool) throw new Error('Database is not configured');
};

router.get('/', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'approved';
    if (!['pending', 'approved', 'rejected'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid club status' });
    }
    try {
        requireDatabase();
        const result = await pool!.query(
            `SELECT c.id, c.name, c.description, c.category, c.status, c.created_by,
                    c.approved_by, c.approved_at, c.created_at,
                    COUNT(cm.user_id)::int AS member_count
             FROM clubs c
             LEFT JOIN club_members cm ON cm.club_id = c.id
             WHERE c.status = $1
             GROUP BY c.id
             ORDER BY c.created_at DESC`,
            [status],
        );
        return res.json({ success: true, count: result.rows.length, data: result.rows });
    } catch (error) {
        console.error('Failed to list clubs:', error);
        return res.status(503).json({ success: false, message: 'Club service is unavailable' });
    }
});

router.get('/mine', authenticate, async (req, res) => {
    try {
        requireDatabase();
        const result = await pool!.query(
            `SELECT c.id, c.name, c.description, c.category, c.status, c.created_by,
                    c.approved_by, c.approved_at, c.created_at, cm.role
             FROM clubs c
             JOIN club_members cm ON cm.club_id = c.id AND cm.user_id = $1
             ORDER BY c.created_at DESC`,
            [req.user!.id],
        );
        return res.json({ success: true, count: result.rows.length, data: result.rows });
    } catch (error) {
        console.error('Failed to list user clubs:', error);
        return res.status(503).json({ success: false, message: 'Club service is unavailable' });
    }
});

router.post('/', authenticate, async (req, res) => {
    const parsed = createClubSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid club details', errors: parsed.error.flatten() });
    try {
        requireDatabase();
        const client = await pool!.connect();
        try {
            await client.query('BEGIN');
            const club = await client.query(
                `INSERT INTO clubs (name, description, category, created_by)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, name, description, category, status, created_by, created_at`,
                [parsed.data.name, parsed.data.description, parsed.data.category, req.user!.id],
            );
            await client.query(
                `INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, 'lead')`,
                [club.rows[0].id, req.user!.id],
            );
            await client.query('COMMIT');
            return res.status(201).json({ success: true, message: 'Club submitted for admin approval', data: club.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK');
            if ((error as { code?: string }).code === '23505') return res.status(409).json({ success: false, message: 'A club with this name already exists' });
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Failed to create club:', error);
        return res.status(503).json({ success: false, message: 'Club service is unavailable' });
    }
});

router.patch('/:id/approval', authenticate, authorize('ADMIN'), async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return res.status(400).json({ success: false, message: 'Invalid club ID' });
    const parsed = clubApprovalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Approval status must be approved or rejected' });
    try {
        requireDatabase();
        const result = await pool!.query(
            `UPDATE clubs
             SET status = $1::varchar, approved_by = CASE WHEN $1::varchar = 'approved' THEN $2::bigint ELSE NULL END,
                 approved_at = CASE WHEN $1::varchar = 'approved' THEN NOW() ELSE NULL END
             WHERE id = $3
             RETURNING id, name, description, category, status, created_by, approved_by, approved_at, created_at`,
            [parsed.data.status, req.user!.id, id],
        );
        if (!result.rowCount) return res.status(404).json({ success: false, message: 'Club not found' });
        return res.json({ success: true, message: `Club ${parsed.data.status}`, data: result.rows[0] });
    } catch (error) {
        console.error('Failed to update club approval:', error);
        return res.status(503).json({ success: false, message: 'Club service is unavailable' });
    }
});

export default router;