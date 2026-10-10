import express from 'express';
import usersRouter from './users.js'
import eventsRouter from './events.js';
import authRouter from './auth/auth.js';
import clubsRouter from './clubs.js';

const router = express.Router();

router.get('/api/v1', (_req, res) => {
    res.status(200).json({
        success: true,
        data: {
            name: 'Student Organization System API',
            version: '1.0',
            endpoints: ['/api/v1/auth', '/api/v1/events', '/api/v1/users', '/api/v1/clubs'],
        },
    });
});
router.use('/api/v1/users', usersRouter);
router.use('/api/v1/events', eventsRouter);
router.use('/api/v1/auth', authRouter);
router.use('/api/v1/clubs', clubsRouter);
export default router;