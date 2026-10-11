import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const isDatabaseConfigured = Boolean(process.env.DB_URL);

const pool = isDatabaseConfigured
    ? new Pool({
        connectionString: process.env.DB_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    : null;

pool?.on('error', (error) => {
    console.error('Unexpected idle database connection error:', error);
});

// Database-only route modules guard availability at runtime before querying.
export default pool as pg.Pool;