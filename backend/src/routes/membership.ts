import express from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middlewares/auth.middlewares.js';
import {membershipRequestSchema,membershipDecisionSchema,} from '../validation/membership.schema.js'

const router = express.Router();

// GET /api/v1/memberships/plans
//Get available membership plans of the club
router.get('/plans', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, price, duration_days, benefits
             FROM membership_plans
             WHERE is_active = TRUE
             ORDER BY price`
        );

        return res.json({
            success: true,
            data: result.rows,
        });
    } 
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve plans',
        });
    }
});

// POST /api/v1/memberships
// Submit a new membership request.
router.post('/', authenticate, async (req, res) => {

    const validation = membershipRequestSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            success: false,
            errors: validation.error.issues,
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Serialize membership requests for this user.
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE',[req.user!.id]);

        const plan = await client.query(
            `SELECT id FROM membership_plans
             WHERE id = $1 AND is_active = TRUE`,
            [validation.data.plan_id]
        );

        if (plan.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Membership plan not found',
            });
        }

        const existing = await client.query(
            `SELECT id FROM memberships
             WHERE user_id = $1
               AND status IN ('pending', 'active')
               AND end_date >= CURRENT_DATE
             LIMIT 1`,
            [req.user!.id]
        );

        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'You already have a pending or active membership',
            });
        }

        const result = await client.query(
            `INSERT INTO memberships
                (user_id, plan_id, start_date, end_date, status)
             VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE, 'pending')
             RETURNING *`,
            [req.user!.id, validation.data.plan_id]
        );

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Membership request submitted',
            data: result.rows[0],
        });
    } 
    
    catch (error) {
        await client.query('ROLLBACK');
        console.error(error);

        return res.status(500).json({
            success: false,
            message: 'Failed to submit membership request',
        });
    } 
    
    finally {
        client.release();
    }
});

// GET /api/v1/memberships/me
//Get own membership
router.get('/me', authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.*, mp.name AS plan_name, mp.price
             FROM memberships m
             JOIN membership_plans mp ON mp.id = m.plan_id
             WHERE m.user_id = $1
             ORDER BY m.created_at DESC`,
            [req.user!.id]
        );

        return res.json({
            success: true,
            data: result.rows,
        });
    } 
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve memberships',
        });
    }
});

// GET /api/v1/memberships
// Review pending requests.
router.get('/', authenticate, async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.*, u.name AS user_name, u.email,
                    mp.name AS plan_name, mp.price
             FROM memberships m
             JOIN users u ON u.id = m.user_id
             JOIN membership_plans mp ON mp.id = m.plan_id
             ORDER BY
                CASE WHEN m.status = 'pending' THEN 0 ELSE 1 END,
                m.created_at DESC`
        );

        return res.json({
            success: true,
            data: result.rows,
        });
    } 
    catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to retrieve membership requests',
        });
    }
});

// PATCH /api/v1/memberships/:id
// Approve or reject a membership request.
router.patch('/:id', authenticate, async (req, res) => {

    const id = req.params.id;

    // type check to make sure it's a single string, not an array
    if (!id || typeof id !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Invalid event ID format',
        });
    }

    if (!id || !/^[1-9]\d*$/.test(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid membership ID',
        });
    }

    const validation = membershipDecisionSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            success: false,
            errors: validation.error.issues,
        });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const membershipResult = await client.query(
            `SELECT m.*, mp.duration_days
             FROM memberships m
             JOIN membership_plans mp ON mp.id = m.plan_id
             WHERE m.id = $1
             FOR UPDATE OF m`,
            [id]
        );

        const membership = membershipResult.rows[0];

        if (!membership) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Membership not found',
            });
        }

        if (membership.status !== 'pending') {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'This request has already been processed',
            });
        }

        let result;

        if (validation.data.status === 'active') {
            result = await client.query(
                `UPDATE memberships
                 SET status = 'active',
                     start_date = CURRENT_DATE,
                     end_date = CURRENT_DATE + $2::integer
                 WHERE id = $1
                 RETURNING *`,
                [id, membership.duration_days]
            );

            await client.query(
                `INSERT INTO user_roles (user_id, role_id)
                 SELECT $1, id FROM roles WHERE name = 'MEMBER'
                 ON CONFLICT DO NOTHING`,
                [membership.user_id]
            );
        } 
        else {
            result = await client.query(
                `UPDATE memberships
                 SET status = 'cancelled'
                 WHERE id = $1
                 RETURNING *`,
                [id]
            );
        }

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: validation.data.status === 'active'
                ? 'Membership approved'
                : 'Membership request rejected',
            data: result.rows[0],
        });
    } 
    catch (error) {
        await client.query('ROLLBACK');
        console.error(error);

        return res.status(500).json({
            success: false,
            message: 'Failed to process membership request',
        });
    } 
    finally {
        client.release();
    }
});

// POST /api/v1/memberships/:id/renew
//Renew the membership
router.post('/:id/renew', authenticate, async (req, res) => {
    const id = req.params.id;

        // type check to make sure it's a single string, not an array
    if (!id || typeof id !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'Invalid event ID format',
        });
    }

    if (!id || !/^[1-9]\d*$/.test(id)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid membership ID',
        });
    }

    try {
        const previous = await pool.query(
            `SELECT plan_id FROM memberships
             WHERE id = $1 AND user_id = $2`,
            [id, req.user!.id]
        );

        if (previous.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Membership not found',
            });
        }

        const result = await pool.query(
            `INSERT INTO memberships
                (user_id, plan_id, start_date, end_date, status)
             VALUES ($1, $2, CURRENT_DATE, CURRENT_DATE, 'pending')
             RETURNING *`,
            [req.user!.id, previous.rows[0].plan_id]
        );

        return res.status(201).json({
            success: true,
            message: 'Renewal request submitted',
            data: result.rows[0],
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Failed to submit renewal request',
        });
    }
});

export default router;
