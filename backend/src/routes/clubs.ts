import express from 'express';
import pool from '../db/pool.js';
import { authenticate, authorize } from '../middlewares/auth.middlewares.js';
import { clubApprovalSchema, createClubSchema } from '../validation/club.schema.js';
import { clubJoinDecisionSchema, clubJoinRequestSchema } from '../validation/club-membership.schema.js';

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
                    c.approved_by, c.approved_at, c.created_at, cm.role,
                    r.status AS join_request_status
             FROM clubs c
             JOIN club_members cm ON cm.club_id = c.id AND cm.user_id = $1
             LEFT JOIN club_join_requests r ON r.club_id = c.id AND r.user_id = $1
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

router.get('/join-requests/mine', authenticate, async (req, res) => {
    try {
        requireDatabase();
        const result = await pool!.query(
            `SELECT r.id, r.club_id, r.status, r.message, r.created_at, c.name AS club_name
             FROM club_join_requests r
             JOIN clubs c ON c.id = r.club_id
             WHERE r.user_id = $1
             ORDER BY r.created_at DESC`,
            [req.user!.id],
        );
        return res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Failed to list personal club join requests:', error);
        return res.status(503).json({ success: false, message: 'Club membership service is unavailable' });
    }
});

router.post('/:id/join-requests', authenticate, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return res.status(400).json({ success: false, message: 'Invalid club ID' });
    const parsed = clubJoinRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid join request', errors: parsed.error.flatten() });
    try {
        requireDatabase();
        const club = await pool!.query(`SELECT id FROM clubs WHERE id = $1 AND status = 'approved'`, [id]);
        if (!club.rowCount) return res.status(404).json({ success: false, message: 'Approved club not found' });
        const existingMember = await pool!.query(`SELECT 1 FROM club_members WHERE club_id = $1 AND user_id = $2`, [id, req.user!.id]);
        if (existingMember.rowCount) return res.status(409).json({ success: false, message: 'You are already a member of this club' });
        const result = await pool!.query(
            `INSERT INTO club_join_requests (club_id, user_id, message)
             VALUES ($1, $2, $3)
             ON CONFLICT (club_id, user_id)
             DO UPDATE SET message = EXCLUDED.message, status = 'pending', reviewed_by = NULL, reviewed_at = NULL
             RETURNING *`,
            [id, req.user!.id, parsed.data.message ?? null],
        );
        return res.status(201).json({ success: true, message: 'Join request sent to the club lead', data: result.rows[0] });
    } catch (error) {
        console.error('Failed to create club join request:', error);
        return res.status(503).json({ success: false, message: 'Club membership service is unavailable. Apply the club membership migration first.' });
    }
});

router.get('/:id/join-requests', authenticate, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return res.status(400).json({ success: false, message: 'Invalid club ID' });
    try {
        requireDatabase();
        const access = await pool!.query(
            `SELECT 1 FROM club_members
             WHERE club_id = $1 AND user_id = $2 AND role IN ('lead', 'admin')`,
            [id, req.user!.id],
        );
        if (!access.rowCount && !req.user!.roles.includes('ADMIN')) return res.status(403).json({ success: false, message: 'Only club leads and admins can review requests' });
        const result = await pool!.query(
            `SELECT r.id, r.club_id, r.user_id, r.message, r.status, r.created_at,
                    u.name AS user_name, u.email
             FROM club_join_requests r
             JOIN users u ON u.id = r.user_id
             WHERE r.club_id = $1 AND r.status = 'pending'
             ORDER BY r.created_at ASC`,
            [id],
        );
        return res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Failed to list club join requests:', error);
        return res.status(503).json({ success: false, message: 'Club membership service is unavailable' });
    }
});

router.patch('/:id/join-requests/:requestId', authenticate, async (req, res) => {
    const { id, requestId } = req.params;
    if (typeof id !== 'string' || typeof requestId !== 'string' || !/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(requestId)) return res.status(400).json({ success: false, message: 'Invalid club or request ID' });
    const parsed = clubJoinDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    try {
        requireDatabase();
        const access = await pool!.query(`SELECT 1 FROM club_members WHERE club_id = $1 AND user_id = $2 AND role IN ('lead', 'admin')`, [id, req.user!.id]);
        if (!access.rowCount && !req.user!.roles.includes('ADMIN')) return res.status(403).json({ success: false, message: 'Only club leads and admins can review requests' });
        const client = await pool!.connect();
        try {
            await client.query('BEGIN');
            const request = await client.query(`SELECT id, user_id, status FROM club_join_requests WHERE id = $1 AND club_id = $2 FOR UPDATE`, [requestId, id]);
            if (!request.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Join request not found' }); }
            if (request.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(409).json({ success: false, message: 'Join request has already been reviewed' }); }
            await client.query(`UPDATE club_join_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3`, [parsed.data.status, req.user!.id, requestId]);
            if (parsed.data.status === 'approved') {
                await client.query(`INSERT INTO club_members (club_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT (club_id, user_id) DO NOTHING`, [id, request.rows[0].user_id]);
            }
            await client.query('COMMIT');
            return res.json({ success: true, message: `Join request ${parsed.data.status}` });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    } catch (error) {
        console.error('Failed to review club join request:', error);
        return res.status(503).json({ success: false, message: 'Club membership service is unavailable' });
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