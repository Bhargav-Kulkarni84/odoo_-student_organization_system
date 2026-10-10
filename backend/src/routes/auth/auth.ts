import express from 'express';

// DB
import pool from '../../db/pool.js';

// Auth
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt';

// Validation
import { registerSchema, loginSchema } from "../../validation/auth.schema.js";

const router = express.Router();

//signups users based on the inputs and auto assigns then as member
router.post('/register', async (req, res) => {

    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validation.error.issues,
        });
    }

    const { name, email, password } = validation.data;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const passwordHash = await bcrypt.hash(password, 12);

        const userResult = await client.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, name, email, is_active, created_at`,
            [name, email, passwordHash]
        );

        const user = userResult.rows[0];
        const studentIDResult = await client.query(`SELECT id FROM roles WHERE name = $1`,["STUDENT"]);
        const studentID = studentIDResult.rows[0].id;

        await client.query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2);`,
            [user.id,studentID]
        );

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Registration successful',
            data: user,
        });

    } 

    catch (error) {
        await client.query('ROLLBACK');

        if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'An account with this email already exists',
            });
        }

        console.error('Registration failed:', error);

        return res.status(500).json({
            success: false,
            message: 'Registration failed',
        });
    } 

    finally {
        client.release();
    }

});

//Logs user in, returning ROLE,JWT, user name, user email
router.post('/login', async (req, res) => {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: validation.error.issues,
        });
    }

    const { email, password } = validation.data;

    try {
        const result = await pool.query(
            `SELECT id, name, email, password_hash, is_active
             FROM users
             WHERE email = $1`,
            [email]
        );

        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password',
            });
        }

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                message: 'This account is inactive',
            });
        }

        const rolesResult = await pool.query(
            `SELECT r.name
             FROM roles r
             JOIN user_roles ur ON ur.role_id = r.id
             WHERE ur.user_id = $1`,
            [user.id]
        );

        const roles: string[] = rolesResult.rows.map(
            (row: { name: string }) => row.name
        );

        const secret = process.env.JWT_SECRET;

        if (!secret) {
            throw new Error('JWT_SECRET is not configured');
        }

        // const token = jwt.sign({email: user.email,roles,}, secret,{subject: String(user.id),expiresIn: '1h',});
        const token = jwt.sign({email: user.email,roles,}, secret,{subject: String(user.id)});

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            data: {
                id: user.id,
                name: user.name,
                email: user.email,
                roles,
            },
        });
    } 
    
    catch (error) {
        console.error('Login failed:', error);

        return res.status(500).json({
            success: false,
            message: 'Login failed',
        });
    }

});


export default router;
