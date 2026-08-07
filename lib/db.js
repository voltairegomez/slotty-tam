// Turso (libSQL) data layer — works locally and on Vercel serverless.
// Reads credentials from env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN.
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.warn('[db] TURSO_DATABASE_URL is not set — set it in your environment / Vercel project settings.');
}

export const db = createClient({ url, authToken });

// Small helpers so route code stays readable.
export async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
export async function get(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] ?? null;
}
export async function run(sql, args = []) {
  return db.execute({ sql, args });
}
