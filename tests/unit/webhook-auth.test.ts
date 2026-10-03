import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugTelnyxWebhook } from '../../src/security/webhook-auth.js';

describe('Telnyx webhook diagnostics', () => {
  afterEach(() => {
    delete process.env.TELNYX_WEBHOOK_DEBUG;
    vi.restoreAllMocks();
  });

  it('logs only sanitized auth metadata when explicitly enabled', () => {
    process.env.TELNYX_WEBHOOK_DEBUG = 'true';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const secretBody = '{"message":"do not log this"}';
    const publicKey = 'eu2zvPjhY6odxV34Z/EsRiERvTodkev4Fq0SlK90Izg=';

    debugTelnyxWebhook({
      rawBody: secretBody,
      timestamp: String(Math.floor(Date.now() / 1000)),
      signature: 'c2lnbmF0dXJl',
      publicKey,
      toleranceSeconds: 300,
    }, false);

    const output = String(write.mock.calls[0]?.[0]);
    expect(output).toContain('"event":"telnyx_webhook_auth"');
    expect(output).toContain('"verified":false');
    expect(output).toContain('"publicKeyFormat":"base64_raw_32_bytes"');
    expect(output).toContain('"publicKeyBytes":32');
    expect(output).not.toContain(publicKey);
    expect(output).not.toContain(secretBody);
  });

  it('does not log unless explicitly enabled', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    debugTelnyxWebhook({
      rawBody: '{}',
      timestamp: undefined,
      signature: undefined,
      publicKey: undefined,
      toleranceSeconds: 300,
    }, false);

    expect(write).not.toHaveBeenCalled();
  });
});
