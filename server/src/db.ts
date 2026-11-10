import pg from 'pg';
import { readFileSync } from 'node:fs';
import { config } from './config.ts';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (err) => console.error('[db] idle client error', err.message));

export async function migrate() {
  await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
}

export const q = <T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) =>
  pool.query<T>(text, params).then((r) => r.rows);
