import express from 'express'

//Routes from routers
import test from './test.js'
import usersRouter from './users.js'
import eventsRouter from './events.js';
import membershipsRouter from './membership.js';
import authRouter from './auth/auth.js';
import ticketTypesRouter from './ticket-types.js';
import ticketOrdersRouter from './ticket-orders.js';
import ticketsRouter from './tickets.js';

const router = express.Router();

router.use("/api/v1",test);
router.use('/api/v1/users', usersRouter);
router.use('/api/v1/events', eventsRouter);
router.use('/api/v1/auth', authRouter);
router.use('/api/v1/memberships', membershipsRouter);
router.use('/api/v1/events/:eventId/ticket-types',ticketTypesRouter);
router.use('/api/v1/ticket-orders', ticketOrdersRouter);
router.use('/api/v1/tickets', ticketsRouter);

export default router;