    import express from 'express';
    import pool from '../db/pool.js';

    //Zod validation
    import { createUserSchema } from '../validation/user.schema.js';

    //Auth requirements
    import bcrypt from 'bcrypt';

    const router = express.Router();

    router.get('/', async (req, res) => {
        try {

            const result = await pool.query(`
                SELECT id, name, email, is_active, created_at
                FROM users
                ORDER BY id ASC
            `);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                data: result.rows,
            });

        } 
        
        catch (error) {
            console.error('Failed to fetch users:', error);

            res.status(500).json({
                success: false,
                message: 'Failed to retrieve users',
            });
        }
    });

    //Get user based on id
    router.get('/:id', async (req, res) => {
        const id = Number(req.params.id);

        //throw error if invaldd parameter id
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid user ID',
            });
        }


        try {
            const result = await pool.query(
                `SELECT id, name, email, is_active, created_at
                FROM users
                WHERE id = $1`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.status(200).json({
                success: true,
                data: result.rows[0],
            });
        } 
        
        catch (error) {
            console.error('Failed to fetch user:', error);

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve user',
            });
        }
    });

    //Sign in user
    router.post('/', async (req, res) => {

        //Validate user inputs
        const validation = createUserSchema.safeParse(req.body);

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

        const { name, email, password } = validation.data;

        try {
            const passwordHash = await bcrypt.hash(password, 12);

            const result = await pool.query(
                `INSERT INTO users (name, email, password_hash)
                VALUES ($1, $2, $3)
                RETURNING id, name, email, is_active, created_at`,
                [name, email, passwordHash]
            );

            return res.status(201).json({
                success: true,
                message: 'User created successfully',
                data: result.rows[0],
            });
        } 
        
        catch (error) {
            
            if (typeof error === 'object' && error !== null && 'code' in error &&error.code === '23505') {
                
                return res.status(409).json({
                    success: false,
                    message: 'A user with this email already exists',
                });
            }

            console.error('Failed to create user:', error);

            return res.status(500).json({
                success: false,
                message: 'Failed to create user',
            });
        }
    });


    export default router;
