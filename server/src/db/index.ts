import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';
import { env } from '../env.js';

const needsSsl = /sslmode=require|neon\.tech|supabase\.co|render\.com/.test(env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Applies pending SQL migrations from server/drizzle. Safe to run on every boot. */
export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.resolve(here, '../../drizzle') });
}

export { schema };
