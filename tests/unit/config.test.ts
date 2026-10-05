import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3000',
  DATABASE_PATH: ':memory:',
  CHATWOOT_URL: 'http://localhost:3001',
  CHATWOOT_ACCOUNT_ID: '1',
  CHATWOOT_INBOX_ID: '2',
  CHATWOOT_API_TOKEN: 'chatwoot-test-token',
  CHATWOOT_WEBHOOK_SECRET: 'chatwoot-webhook-secret',
  TELNYX_API_KEY: 'telnyx-test-key',
  TELNYX_PUBLIC_KEY: 'test-public-key',
  TELNYX_SENDER_NUMBER: '+15551234567',
};

describe('loadConfig', () => {
  it('defaults outbound delivery to fake mode without requiring a test recipient', () => {
    const config = loadConfig(validEnvironment);

    expect(config.chatwoot.url).toBe('http://localhost:3001');
    expect(config.server.port).toBe(3000);
    expect(config.databasePath).toBe(':memory:');
    expect(config.persistence).toEqual({ mode: 'sqlite', databaseUrl: undefined, redisUrl: undefined, redisPrefix: 'telnyx-bridge:' });
    expect(config.runtimeRole).toBe('web');
    expect(config.outbound).toEqual({ mode: 'fake' });
    expect(config.ai).toMatchObject({ debounceMs: 15000, replyLimit: 10, replyLimitWindowMs: 86400000 });
  });

  it('loads postgres and redis runtime settings for production', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PERSISTENCE_MODE: 'postgres_redis',
      DATABASE_URL: 'postgresql://test-only',
      REDIS_URL: 'redis://test-only',
      BRIDGE_REDIS_PREFIX: 'custom-bridge:',
      RUNTIME_ROLE: 'worker',
    });

    expect(config.persistence).toEqual({
      mode: 'postgres_redis',
      databaseUrl: 'postgresql://test-only',
      redisUrl: 'redis://test-only',
      redisPrefix: 'custom-bridge:',
    });
    expect(config.runtimeRole).toBe('worker');
  });

  it.each(['DATABASE_URL', 'REDIS_URL'])('rejects production postgres_redis mode without %s', (missingField) => {
    const environment = {
      ...validEnvironment,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PERSISTENCE_MODE: 'postgres_redis',
      DATABASE_URL: 'postgresql://test-only',
      REDIS_URL: 'redis://test-only',
    };
    delete environment[missingField as keyof typeof environment];

    expect(() => loadConfig(environment)).toThrowError(new RegExp(missingField));
  });

  it('rejects blank postgres and redis URLs in postgres_redis mode', () => {
    expect(() => loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PERSISTENCE_MODE: 'postgres_redis',
      DATABASE_URL: '',
      REDIS_URL: '',
    })).toThrowError(/DATABASE_URL.*REDIS_URL|REDIS_URL.*DATABASE_URL/);
  });

  it('preserves sqlite configuration without postgres or redis URLs', () => {
    const config = loadConfig({
      ...validEnvironment,
      PERSISTENCE_MODE: 'sqlite',
      DATABASE_URL: '',
      REDIS_URL: '',
      RUNTIME_ROLE: 'web',
    });

    expect(config.persistence).toEqual({ mode: 'sqlite', databaseUrl: undefined, redisUrl: undefined, redisPrefix: 'telnyx-bridge:' });
    expect(config.databasePath).toBe(':memory:');
  });

  it('allows AI live smoke mode without a configured knowledge-base event', () => {
    const config = loadConfig({
      ...validEnvironment,
      AI_ENABLED: 'true',
      AI_PROVIDER_MODE: 'live',
      AI_LIVE_OPENAI_ENABLED: 'true',
      OPENAI_API_KEY: 'openai-test-key',
    });

    expect(config.ai?.defaultEventId).toBeUndefined();
    expect(config.ai?.enabled).toBe(true);
  });

  it('requires an allowlisted test recipient before live outbound can start', () => {
    expect(() => loadConfig({ ...validEnvironment, OUTBOUND_MODE: 'live' })).toThrowError(
      /TEST_RECIPIENT_NUMBER/,
    );
  });

  it('loads live outbound only with an E.164 test recipient', () => {
    const config = loadConfig({
      ...validEnvironment,
      OUTBOUND_MODE: 'live',
      TEST_RECIPIENT_NUMBER: '+14155552671',
    });

    expect(config.outbound).toEqual({ mode: 'live', testRecipientNumber: '+14155552671' });
  });

  it('treats blank optional secrets as unset in local fake mode', () => {
    const config = loadConfig({
      ...validEnvironment,
      CHATWOOT_WEBHOOK_SECRET: '',
      TELNYX_PUBLIC_KEY: '',
      TEST_RECIPIENT_NUMBER: '',
    });

    expect(config.chatwoot.webhookSecret).toBeUndefined();
    expect(config.telnyx.publicKey).toBeUndefined();
    expect(config.outbound).toEqual({ mode: 'fake' });
  });

  it('allows loopback development to start without webhook authentication', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      CHATWOOT_WEBHOOK_SECRET: undefined,
      TELNYX_PUBLIC_KEY: undefined,
    });

    expect(config.environment).toBe('development');
    expect(config.chatwoot.webhookSecret).toBeUndefined();
    expect(config.telnyx.publicKey).toBeUndefined();
  });

  it('fails closed when production is missing only the Chatwoot webhook secret', () => {
    expect(() => loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      CHATWOOT_WEBHOOK_SECRET: undefined,
    })).toThrowError(/CHATWOOT_WEBHOOK_SECRET/);
  });

  it('starts production webhook mode when both signature secrets are present', () => {
    const config = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
    });

    expect(config.environment).toBe('production');
    expect(config.chatwoot.webhookSecret).toBe('chatwoot-webhook-secret');
    expect(config.telnyx.publicKey).toBe('test-public-key');
  });

  it.each([
    ['production mode', { NODE_ENV: 'production' }],
    ['a non-loopback bind', { HOST: '0.0.0.0' }],
  ])('fails closed without webhook authentication in %s', (_name, override) => {
    expect(() => loadConfig({
      ...validEnvironment,
      ...override,
      CHATWOOT_WEBHOOK_SECRET: undefined,
      TELNYX_PUBLIC_KEY: undefined,
    })).toThrowError(/CHATWOOT_WEBHOOK_SECRET.*TELNYX_PUBLIC_KEY|TELNYX_PUBLIC_KEY.*CHATWOOT_WEBHOOK_SECRET/);
  });

  it('rejects missing secrets without including secret values in the error', () => {
    const secret = 'must-not-appear';

    expect(() =>
      loadConfig({
        ...validEnvironment,
        TELNYX_API_KEY: undefined,
        CHATWOOT_API_TOKEN: secret,
      }),
    ).toThrowError(/TELNYX_API_KEY/);

    try {
      loadConfig({
        ...validEnvironment,
        TELNYX_API_KEY: undefined,
        CHATWOOT_API_TOKEN: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
