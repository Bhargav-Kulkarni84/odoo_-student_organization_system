import express from 'express';
import usersRouter from './users.js'
import eventsRouter from './events.js';
import membershipsRouter from './membership.js';
import authRouter from './auth/auth.js';
import clubsRouter from './clubs.js';
import ticketTypesRouter from './ticket-types.js';
import ticketOrdersRouter from './ticket-orders.js';
import ticketsRouter from './tickets.js';
import paymentsRouter from './payments.js';
import merchandiseRouter from './marchandise.js';
import announcementsRouter from './announcements.js';
import tasksRouter from './tasks.js';
import fundraisersRouter from './fundraiser.js';
import expensesRouter from './expense.js';
import financialReportsRouter from './financial-reports.js';

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
router.use('/api/v1/memberships', membershipsRouter);
router.use('/api/v1/events/:eventId/ticket-types', ticketTypesRouter);
router.use('/api/v1/ticket-orders', ticketOrdersRouter);
router.use('/api/v1/tickets', ticketsRouter);
router.use('/api/v1/payments', paymentsRouter);
router.use('/api/v1/merchandise', merchandiseRouter);
router.use('/api/v1/announcements', announcementsRouter);
router.use('/api/v1/tasks', tasksRouter);
router.use('/api/v1/fundraisers', fundraisersRouter);
router.use('/api/v1/expenses', expensesRouter);
router.use('/api/v1/financial-reports', financialReportsRouter);
export default router;