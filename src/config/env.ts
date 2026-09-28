import { z } from 'zod';

const e164 = /^\+[1-9]\d{7,14}$/;

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);

function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/bridge.sqlite'),
  CHATWOOT_URL: z.string().url(),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
  CHATWOOT_INBOX_ID: z.coerce.number().int().positive(),
  CHATWOOT_API_TOKEN: z.string().min(1),
  CHATWOOT_WEBHOOK_SECRET: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  TELNYX_API_KEY: z.string().min(1),
  TELNYX_PUBLIC_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  TELNYX_SENDER_NUMBER: z.string().regex(e164, 'must be an E.164 phone number'),
  OUTBOUND_MODE: z.preprocess(blankToUndefined, z.enum(['fake', 'live']).default('fake')),
  TEST_RECIPIENT_NUMBER: z.preprocess(
    blankToUndefined,
    z.string().regex(e164, 'must be an E.164 phone number').optional(),
  ),
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
}).superRefine((env, context) => {
  if (env.OUTBOUND_MODE === 'live' && !env.TEST_RECIPIENT_NUMBER) {
    context.addIssue({
      code: 'custom',
      path: ['TEST_RECIPIENT_NUMBER'],
      message: 'is required when OUTBOUND_MODE=live',
    });
  }

  const requiresWebhookAuthentication = env.NODE_ENV === 'production' || !loopbackHosts.has(env.HOST);
  if (!requiresWebhookAuthentication) return;

  if (!env.CHATWOOT_WEBHOOK_SECRET) {
    context.addIssue({
      code: 'custom',
      path: ['CHATWOOT_WEBHOOK_SECRET'],
      message: 'is required for production or non-loopback webhook mode',
    });
  }
  if (!env.TELNYX_PUBLIC_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['TELNYX_PUBLIC_KEY'],
      message: 'is required for production or non-loopback webhook mode',
    });
  }
});

export type BridgeConfig = {
  environment: 'development' | 'test' | 'production';
  server: { host: string; port: number };
  databasePath: string;
  chatwoot: {
    url: string;
    accountId: number;
    inboxId: number;
    apiToken: string;
    webhookSecret?: string;
  };
  telnyx: {
    apiKey: string;
    publicKey?: string;
    senderNumber: string;
  };
  outbound:
    | { mode: 'fake'; testRecipientNumber?: string }
    | { mode: 'live'; testRecipientNumber: string };
  webhookToleranceSeconds: number;
};

export class ConfigError extends Error {
  constructor(fields: string[]) {
    super(`Invalid environment configuration: ${fields.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv | Record<string, string | undefined>): BridgeConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || 'environment'))];
    throw new ConfigError(fields);
  }

  const env = result.data;
  return {
    environment: env.NODE_ENV,
    server: { host: env.HOST, port: env.PORT },
    databasePath: env.DATABASE_PATH,
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
    outbound: env.OUTBOUND_MODE === 'live'
      ? { mode: 'live', testRecipientNumber: env.TEST_RECIPIENT_NUMBER! }
      : {
          mode: 'fake',
          ...(env.TEST_RECIPIENT_NUMBER ? { testRecipientNumber: env.TEST_RECIPIENT_NUMBER } : {}),
        },
    webhookToleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
  };
}
