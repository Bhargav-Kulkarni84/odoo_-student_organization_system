import express from 'express'
import test from './test.js'

const router = express.Router();

router.use("/api/v1",test);

export default router;