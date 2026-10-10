import express from 'express'

//Routes from routers
import test from './test.js'
import usersRouter from './users.js'

const router = express.Router();

router.use("/api/v1",test);
router.use('/api/v1/users', usersRouter);

export default router;