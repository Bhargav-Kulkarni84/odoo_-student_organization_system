import express from 'express'

//Routes from routers
import test from './test.js'
import usersRouter from './users.js'
import eventsRouter from './events.js';
import authRouter from './auth/auth.js';

const router = express.Router();

router.use("/api/v1",test);
router.use('/api/v1/users', usersRouter);
router.use('/api/v1/events', eventsRouter);
router.use('/api/v1/auth', authRouter);
export default router;