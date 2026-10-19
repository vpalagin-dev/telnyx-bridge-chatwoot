import dns from 'node:dns';
import { parse } from 'pg-connection-string';
import { Pool, type PoolConfig } from 'pg';

function lookupIpv4(hostname: string, _: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family?: number) => void): void {
  dns.lookup(hostname, { family: 4 }, callback);
}

export type JamaContactsPoolOptions = {
  databaseUrl: string;
  password?: string;
  user?: string;
  host?: string;
  port?: number;
  database?: string;
};

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

function resolvePoolConfig(options: JamaContactsPoolOptions): PoolConfig {
  const parsed = parse(appendQueryParams(options.databaseUrl));
  const host = options.host ?? parsed.host ?? undefined;
  const user = options.user ?? parsed.user ?? undefined;
  const config: PoolConfig = {
    host,
    port: options.port ?? (parsed.port ? Number.parseInt(String(parsed.port), 10) : undefined),
    user,
    password: options.password?.trim() || parsed.password || undefined,
    database: options.database ?? parsed.database ?? undefined,
    ssl: { rejectUnauthorized: false, ...(host ? { servername: host } : {}) },
  };
  if (host?.includes('pooler.supabase.com') && (!user || user === 'postgres')) {
    throw new Error(
      'Supabase pooler requires user postgres.PROJECT_REF (copy from Connect → Direct). Set JAMA_CONTACTS_PG_USER if the URI username is wrong.',
    );
  }
  if (!user || !host || !config.database) {
    throw new Error('JAMA_CONTACTS_DATABASE_URL is missing user, host, or database after parsing');
  }
  return config;
}

export function describeJamaContactsTarget(options: JamaContactsPoolOptions): JamaContactsConnectionTarget {
  const config = resolvePoolConfig(options);
  const target: JamaContactsConnectionTarget = {};
  if (config.user) target.user = String(config.user);
  if (config.host) target.host = String(config.host);
  if (config.port) target.port = Number(config.port);
  if (config.database) target.database = String(config.database);
  return target;
}

export function createJamaContactsPool(options: JamaContactsPoolOptions): Pool {
  return new Pool({ ...resolvePoolConfig(options), lookup: lookupIpv4 } as PoolConfig);
}
