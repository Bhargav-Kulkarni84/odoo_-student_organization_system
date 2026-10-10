import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const isDatabaseConfigured = Boolean(process.env.DB_URL);

const pool = isDatabaseConfigured
    ? new Pool({
        connectionString: process.env.DB_URL,
        ssl: { rejectUnauthorized: false },
      })
    : null;

export default pool;