import { z } from 'zod';

const e164 = /^\+[1-9]\d{7,14}$/;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const blank = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const bool = (fallback: boolean) => z.preprocess((value) => (value === undefined ? fallback : value === 'true' || value === true), z.boolean());

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: z.string().min(1).default('./data/bridge.sqlite'),
    PERSISTENCE_MODE: z.enum(['sqlite', 'postgres_redis']).default('sqlite'),
    DATABASE_URL: z.preprocess(blank, z.string().url().optional()),
    REDIS_URL: z.preprocess(blank, z.string().url().optional()),
    BRIDGE_REDIS_PREFIX: z.string().min(1).default('telnyx-bridge:'),
    RUNTIME_ROLE: z.enum(['web', 'worker']).default('web'),
    CHATWOOT_URL: z.string().url(),
    CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
    CHATWOOT_INBOX_ID: z.coerce.number().int().positive(),
    CHATWOOT_API_TOKEN: z.string().min(1),
    CHATWOOT_WEBHOOK_SECRET: z.preprocess(blank, z.string().min(1).optional()),
    TELNYX_API_KEY: z.string().min(1),
    TELNYX_PUBLIC_KEY: z.preprocess(blank, z.string().min(1).optional()),
    TELNYX_SENDER_NUMBER: z.string().regex(e164),
    OUTBOUND_MODE: z.preprocess(blank, z.enum(['fake', 'live']).default('fake')),
    TEST_RECIPIENT_NUMBER: z.preprocess(blank, z.string().regex(e164).optional()),
    WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
    AI_ENABLED: bool(false),
    AI_PROVIDER_MODE: z.enum(['fake', 'live']).default('fake'),
    AI_LIVE_OPENAI_ENABLED: bool(false),
    OPENAI_API_KEY: z.preprocess(blank, z.string().min(1).optional()),
    OPENAI_MODEL: z.string().min(1).default('gpt-4o-mini'),
    OPENAI_MAX_INPUT_TOKENS: z.coerce.number().int().positive().max(8192).default(2048),
    OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(2048).default(256),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
    AI_DEFAULT_EVENT_ID: z.preprocess(blank, z.string().min(1).optional()),
    AI_KNOWLEDGE_ROOT: z.string().min(1).default('specs/002-jama-ai-assistant-smoke/knowledge'),
    AI_SAFE_FALLBACK_TEXT: z.string().min(1).default("I'm not sure about that. Let me get someone from the JAMA team to help you."),
    AI_ESCALATION_ENABLED: bool(true),
    AI_DEBOUNCE_MS: z.coerce.number().int().min(0).max(300000).default(15000),
    AI_REPLY_LIMIT: z.coerce.number().int().positive().max(1000).default(10),
    AI_REPLY_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(604800000).default(86400000),
    AI_LIVE_SMS_APPROVED: bool(false),
    AI_LIVE_RECIPIENT_ALLOWLIST: z.preprocess(blank, z.string().default('')),
  })
  .superRefine((env, context) => {
    if (env.OUTBOUND_MODE === 'live' && !env.TEST_RECIPIENT_NUMBER) {
      context.addIssue({ code: 'custom', path: ['TEST_RECIPIENT_NUMBER'], message: 'required' });
    }
    if (env.AI_PROVIDER_MODE === 'live' && env.AI_LIVE_OPENAI_ENABLED && !env.OPENAI_API_KEY) {
      context.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'required' });
    }
    if (env.AI_LIVE_SMS_APPROVED && env.OUTBOUND_MODE !== 'live') {
      context.addIssue({ code: 'custom', path: ['AI_LIVE_SMS_APPROVED'], message: 'requires OUTBOUND_MODE=live' });
    }
    if ((env.NODE_ENV === 'production' || !loopbackHosts.has(env.HOST)) && !env.CHATWOOT_WEBHOOK_SECRET) {
      context.addIssue({ code: 'custom', path: ['CHATWOOT_WEBHOOK_SECRET'], message: 'required outside loopback development' });
    }
    if ((env.NODE_ENV === 'production' || !loopbackHosts.has(env.HOST)) && !env.TELNYX_PUBLIC_KEY) {
      context.addIssue({ code: 'custom', path: ['TELNYX_PUBLIC_KEY'], message: 'required outside loopback development' });
    }
    if (env.PERSISTENCE_MODE === 'postgres_redis') {
      if (!env.DATABASE_URL) context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required for postgres_redis persistence' });
      if (!env.REDIS_URL) context.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'required for postgres_redis persistence' });
    }
  });

export type BridgeConfig = {
  environment: 'development' | 'test' | 'production';
  server: { host: string; port: number };
  databasePath: string;
  persistence: {
    mode: 'sqlite' | 'postgres_redis';
    databaseUrl?: string | undefined;
    redisUrl?: string | undefined;
    redisPrefix: string;
  };
  runtimeRole: 'web' | 'worker';
  chatwoot: { url: string; accountId: number; inboxId: number; apiToken: string; webhookSecret?: string };
  telnyx: { apiKey: string; publicKey?: string; senderNumber: string };
  outbound: { mode: 'fake'; testRecipientNumber?: string } | { mode: 'live'; testRecipientNumber: string };
  webhookToleranceSeconds: number;
  ai?: {
    enabled: boolean;
    providerMode: 'fake' | 'live';
    liveOpenAiEnabled: boolean;
    openAiApiKey?: string;
    model: string;
    maxInputTokens: number;
    maxOutputTokens: number;
    timeoutMs: number;
    defaultEventId?: string;
    knowledgeRoot: string;
    safeFallbackText: string;
    escalationEnabled: boolean;
    debounceMs?: number;
    replyLimit?: number;
    replyLimitWindowMs?: number;
  };
  aiOutbound?: { liveSmsApproved: boolean; recipientAllowlist: string[] };
};

export class ConfigError extends Error {
  constructor(fields: string[]) {
    super(`Invalid environment configuration: ${fields.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): BridgeConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) throw new ConfigError([...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'environment'))]);

  const env = parsed.data;
  const allowlist = env.AI_LIVE_RECIPIENT_ALLOWLIST.split(',').map((value) => value.trim()).filter(Boolean);
  if (allowlist.some((value) => !e164.test(value))) throw new ConfigError(['AI_LIVE_RECIPIENT_ALLOWLIST']);

  return {
    environment: env.NODE_ENV,
    server: { host: env.HOST, port: env.PORT },
    databasePath: env.DATABASE_PATH,
    persistence: {
      mode: env.PERSISTENCE_MODE,
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      redisPrefix: env.BRIDGE_REDIS_PREFIX,
    },
    runtimeRole: env.RUNTIME_ROLE,
    chatwoot: {
      url: env.CHATWOOT_URL.replace(/\/$/, ''),
      accountId: env.CHATWOOT_ACCOUNT_ID,
      inboxId: env.CHATWOOT_INBOX_ID,
      apiToken: env.CHATWOOT_API_TOKEN,
      ...(env.CHATWOOT_WEBHOOK_SECRET ? { webhookSecret: env.CHATWOOT_WEBHOOK_SECRET } : {}),
    },
    telnyx: {
      apiKey: env.TELNYX_API_KEY,
      ...(env.TELNYX_PUBLIC_KEY ? { publicKey: env.TELNYX_PUBLIC_KEY } : {}),
      senderNumber: env.TELNYX_SENDER_NUMBER,
    },
    outbound:
      env.OUTBOUND_MODE === 'live'
        ? { mode: 'live', testRecipientNumber: env.TEST_RECIPIENT_NUMBER! }
        : { mode: 'fake', ...(env.TEST_RECIPIENT_NUMBER ? { testRecipientNumber: env.TEST_RECIPIENT_NUMBER } : {}) },
    webhookToleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
    ai: {
      enabled: env.AI_ENABLED,
      providerMode: env.AI_PROVIDER_MODE,
      liveOpenAiEnabled: env.AI_LIVE_OPENAI_ENABLED,
      ...(env.OPENAI_API_KEY ? { openAiApiKey: env.OPENAI_API_KEY } : {}),
      model: env.OPENAI_MODEL,
      maxInputTokens: env.OPENAI_MAX_INPUT_TOKENS,
      maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      ...(env.AI_DEFAULT_EVENT_ID ? { defaultEventId: env.AI_DEFAULT_EVENT_ID } : {}),
      knowledgeRoot: env.AI_KNOWLEDGE_ROOT,
      safeFallbackText: env.AI_SAFE_FALLBACK_TEXT,
      escalationEnabled: env.AI_ESCALATION_ENABLED,
      debounceMs: env.AI_DEBOUNCE_MS,
      replyLimit: env.AI_REPLY_LIMIT,
      replyLimitWindowMs: env.AI_REPLY_LIMIT_WINDOW_MS,
    },
    aiOutbound: { liveSmsApproved: env.AI_LIVE_SMS_APPROVED, recipientAllowlist: allowlist },
  };
}
