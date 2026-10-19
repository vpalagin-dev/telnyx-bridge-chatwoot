import { Pool } from 'pg';

/** Supabase pooler + node-pg: avoid verify-full cert failures on Railway. */
export function createJamaContactsPool(databaseUrl: string): Pool {
  let connectionString = databaseUrl.trim();
  if (!connectionString.includes('uselibpqcompat=')) {
    connectionString += `${connectionString.includes('?') ? '&' : '?'}uselibpqcompat=true`;
  }
  if (!connectionString.includes('sslmode=')) {
    connectionString += '&sslmode=require';
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}
