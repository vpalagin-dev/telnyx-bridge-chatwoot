import dns from 'node:dns/promises';
import { parse } from 'pg-connection-string';
import { Pool, type PoolConfig } from 'pg';

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
  /** Resolved IPv4 used for TCP connect when different from host (TLS SNI stays on host). */
  connectHost?: string;
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

function isSupabaseDirectHost(hostname: string): boolean {
  return /^db\.[a-z0-9]+\.supabase\.co$/i.test(hostname);
}

function supabaseDirectIpv4Hint(hostname: string): string {
  return (
    `Host ${hostname} has no IPv4 A record (Supabase direct connection is IPv6-only). ` +
    'Railway and many hosts cannot reach it. Use Supabase Connect → Session pooler instead: ' +
    'host aws-0-<region>.pooler.supabase.com, user <role>.<project_ref> (e.g. postgres.ref or sms_service.ref), port 5432. ' +
    'Set JAMA_CONTACTS_PG_HOST and JAMA_CONTACTS_PG_USER, or put the pooler URI in JAMA_CONTACTS_DATABASE_URL.'
  );
}

async function resolveHostToIpv4(hostname: string): Promise<{ connectHost: string; tlsServername: string }> {
  try {
    const addresses = await dns.resolve4(hostname);
    if (addresses[0]) {
      return { connectHost: addresses[0], tlsServername: hostname };
    }
  } catch {
    // try lookup next
  }
  try {
    const { address } = await dns.lookup(hostname, { family: 4 });
    return { connectHost: address, tlsServername: hostname };
  } catch {
    if (isSupabaseDirectHost(hostname)) {
      throw new Error(supabaseDirectIpv4Hint(hostname));
    }
    throw new Error(`Could not resolve an IPv4 address for PostgreSQL host ${hostname}`);
  }
}

async function resolvePoolConfig(options: JamaContactsPoolOptions): Promise<{ config: PoolConfig; displayHost: string }> {
  const parsed = parse(appendQueryParams(options.databaseUrl));
  const host = options.host ?? parsed.host ?? undefined;
  const parsedUser = parsed.user ?? undefined;
  const user = options.user ?? parsedUser ?? undefined;
  const userOverridden = Boolean(options.user && parsedUser && options.user !== parsedUser);
  const hostOverridden = Boolean(options.host && parsed.host && options.host !== parsed.host);
  const envPassword = options.password?.trim();
  const uriPassword = parsed.password || undefined;
  let password: string | undefined;
  if (envPassword) {
    password = envPassword;
  } else if (userOverridden || hostOverridden) {
    throw new Error(
      'JAMA_CONTACTS_PG_USER or JAMA_CONTACTS_PG_HOST override the URI; set JAMA_CONTACTS_DATABASE_PASSWORD (Supabase database password). Remove stale passwords from JAMA_CONTACTS_DATABASE_URL.',
    );
  } else {
    password = uriPassword;
  }
  if (!password) {
    throw new Error('JAMA_CONTACTS_DATABASE_PASSWORD is required (Supabase → Database settings, not API keys).');
  }
  const resolved = host ? await resolveHostToIpv4(host) : { connectHost: undefined, tlsServername: undefined };
  const config: PoolConfig = {
    host: resolved.connectHost,
    port: options.port ?? (parsed.port ? Number.parseInt(String(parsed.port), 10) : undefined),
    user,
    password,
    database: options.database ?? parsed.database ?? undefined,
    ssl: resolved.tlsServername
      ? { rejectUnauthorized: false, servername: resolved.tlsServername }
      : { rejectUnauthorized: false },
  };
  if (host?.includes('pooler.supabase.com') && (!user || user === 'postgres')) {
    throw new Error(
      'Supabase pooler requires user <role>.PROJECT_REF (from Connect, e.g. postgres.ref or sms_service.ref). Set JAMA_CONTACTS_PG_USER if the URI username is wrong.',
    );
  }
  if (!user || !host || !config.database) {
    throw new Error('JAMA_CONTACTS_DATABASE_URL is missing user, host, or database after parsing');
  }
  return { config, displayHost: host };
}

export function jamaContactsPoolOptionsFromConfig(contactSync: {
  databaseUrl: string;
  databasePassword?: string;
  pgUser?: string;
  pgHost?: string;
  pgPort: number;
  pgDatabase: string;
}): JamaContactsPoolOptions {
  return {
    databaseUrl: contactSync.databaseUrl,
    ...(contactSync.databasePassword ? { password: contactSync.databasePassword } : {}),
    ...(contactSync.pgUser ? { user: contactSync.pgUser } : {}),
    ...(contactSync.pgHost ? { host: contactSync.pgHost } : {}),
    port: contactSync.pgPort,
    database: contactSync.pgDatabase,
  };
}

export async function describeJamaContactsTarget(options: JamaContactsPoolOptions): Promise<JamaContactsConnectionTarget> {
  const { config, displayHost } = await resolvePoolConfig(options);
  const target: JamaContactsConnectionTarget = {};
  if (config.user) target.user = String(config.user);
  if (displayHost) target.host = displayHost;
  if (config.host && displayHost && String(config.host) !== displayHost) {
    target.connectHost = String(config.host);
  }
  if (config.port) target.port = Number(config.port);
  if (config.database) target.database = String(config.database);
  return target;
}

export async function createJamaContactsPool(options: JamaContactsPoolOptions): Promise<Pool> {
  return new Pool((await resolvePoolConfig(options)).config);
}
