import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

const client = postgres(connectionString);

export const db = drizzle(client, { schema });

// Re-export schema tables for convenient imports:
// import { db, users, workflows, tasks, documents } from '@/db'
export { schema };
export const { users, sessions, workflows, tasks, documents, auditLogs, waitlistSignups } = schema;
