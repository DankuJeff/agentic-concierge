/**
 * Production database migration runner.
 *
 * Compiled to dist/db/migrate.js and called by docker-entrypoint.sh before
 * the server starts. Safe to run multiple times — Drizzle tracks applied
 * migrations in the __drizzle_migrations table.
 *
 * Usage:
 *   node dist/db/migrate.js
 *
 * The migrations folder is expected at dist/db/migrations/ (copied there
 * by the Dockerfile from src/db/migrations/).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// In the production container: dist/db/migrate.js → dist/db/migrations/
const migrationsFolder = join(__dirname, 'migrations');

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Cannot run migrations.');
}

const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

console.log(`[migrate] Applying migrations from ${migrationsFolder}...`);
await migrate(db, { migrationsFolder });
console.log('[migrate] All migrations applied successfully.');
await client.end();
