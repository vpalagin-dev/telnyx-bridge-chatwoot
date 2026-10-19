import { parse } from 'pg-connection-string';
import { Pool, type PoolConfig } from 'pg';

export type JamaContactsConnectionTarget = {
  user?: string;
  host?: string;
  port?: number;
  database?: string;
};

function appendQueryParams(connectionString: string): string {
  let value = connectionString.trim();
  if (!value.includes('uselibpqcompat=')) {
    value += `${value.includes('?') ? '&' : '?'}uselibpqcompat=true`;
  }
  if (!value.includes('sslmode=')) {
    value += '&sslmode=require';
  }
  return value;
}

export function describeJamaContactsTarget(databaseUrl: string): JamaContactsConnectionTarget {
  const parsed = parse(appendQueryParams(databaseUrl));
  const target: JamaContactsConnectionTarget = {};
  if (parsed.user) target.user = parsed.user;
  if (parsed.host) target.host = parsed.host;
  if (parsed.port) target.port = Number.parseInt(String(parsed.port), 10);
  if (parsed.database) target.database = parsed.database;
  return target;
}

/** Supabase pooler + node-pg: explicit fields avoid broken URI parsing when passwords contain @/#/etc. */
export function createJamaContactsPool(databaseUrl: string, passwordOverride?: string): Pool {
  const parsed = parse(appendQueryParams(databaseUrl));
  const config: PoolConfig = {
    host: parsed.host ?? undefined,
    port: parsed.port ? Number.parseInt(String(parsed.port), 10) : undefined,
    user: parsed.user ?? undefined,
    password: passwordOverride?.trim() || parsed.password || undefined,
    database: parsed.database ?? undefined,
    ssl: { rejectUnauthorized: false },
  };
  return new Pool(config);
}
