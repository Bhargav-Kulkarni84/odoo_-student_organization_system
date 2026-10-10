import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { fileURLToPath } from 'url';

// Configure the connection pool using environment variables
const pool = new Pool({
    connectionString: process.env.DB_URL, 
    ssl: {rejectUnauthorized: false}
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration(): Promise<void> {

    const client: PoolClient = await pool.connect();

    try {
        console.log('Connected to the database. Reading schema file...');
        
        // Read the schema.sql file
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Executing schema migration...');
        
        // Execute the entire SQL script
        await client.query(schemaSql);
        console.log('Database schema created successfully!');
    } 
    catch (err: unknown) {
            
        if (err instanceof Error) {
            console.error('Migration failed:', err.message);
            console.error(err.stack);
        } 
        else {
            console.error('An unknown error occurred:', err);
        }
    } 
    finally {
        // Release client back to the pool and close the pool
        client.release();
        await pool.end();
    }
}

runMigration();