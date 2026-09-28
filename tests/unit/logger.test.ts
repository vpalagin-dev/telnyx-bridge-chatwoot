import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/observability/logger.js';

describe('createLogger', () => {
  it('does not emit plaintext secrets, full phones, or message bodies', () => {
    let output = '';
    const stream = new Writable({ write(chunk, _encoding, callback) { output += chunk.toString(); callback(); } });
    const logger = createLogger(stream);
    const values = {
      apiKey: 'telnyx-plaintext-secret', token: 'chatwoot-plaintext-token',
      webhookSecret: 'webhook-plaintext-secret', phone: '+14155552671', body: 'private sms body',
    };

    logger.info({ nested: values }, 'processed webhook');

    for (const value of Object.values(values)) expect(output).not.toContain(value);
    expect(output).toContain('[REDACTED]');
  });
});
