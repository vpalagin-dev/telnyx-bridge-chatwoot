import { describe, expect, it, vi } from 'vitest';
import { HttpChatwootClient } from '../../src/chatwoot/http-client.js';
import { HttpTelnyxClient } from '../../src/telnyx/http-client.js';

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('HttpChatwootClient', () => {
  it('finds or creates contacts and conversations through the configured local Chatwoot API', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ payload: [
        { id: 9, phone_number: '+14155552670', contact_inboxes: [{ inbox_id: 2, source_id: 'source-9' }] },
        { id: 10, phone_number: '+14155552671', contact_inboxes: [{ inbox_id: 2, source_id: 'source-10' }] },
      ] }))
      .mockResolvedValueOnce(response({ payload: [] }))
      .mockResolvedValueOnce(response({ id: 20, status: 'open' }))
      .mockResolvedValueOnce(response({ id: 30 }));
    const client = new HttpChatwootClient({
      baseUrl: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test-token', fetcher,
    });

    await expect(client.findContactByPhone('+14155552671')).resolves.toEqual({ id: 10, sourceId: 'source-10' });
    await expect(client.findConversation(10)).resolves.toBeNull();
    expect(fetcher.mock.calls.some((call) => String(call[0]).includes('/api/v1/accounts/1/contacts/10/conversations'))).toBe(true);
    await expect(client.createConversation(10, 'source-10')).resolves.toEqual({ id: 20, status: 'open' });
    await expect(client.createIncomingMessage(20, 'fixture text')).resolves.toEqual({ id: 30 });

    expect(fetcher.mock.calls[0]?.[0]).toContain('/api/v1/accounts/1/contacts/search');
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: 'POST' });
    expect(String(fetcher.mock.calls[3]?.[1]?.body)).toContain('"message_type":"incoming"');
  });

  it('matches Chatwoot contact inboxes that nest inbox.id instead of inbox_id', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      payload: [{
        id: 10,
        phone_number: '+37360000000',
        contact_inboxes: [{
          source_id: 'd944b765-98a7-4f84-afe2-276647f5de3a',
          inbox: { id: 3 },
        }],
      }],
    }));
    const client = new HttpChatwootClient({
      baseUrl: 'http://localhost:3001', accountId: 1, inboxId: 3, apiToken: 'test-token', fetcher,
    });

    await expect(client.findContactByPhone('+37360000000')).resolves.toEqual({
      id: 10,
      sourceId: 'd944b765-98a7-4f84-afe2-276647f5de3a',
    });
  });

  it('finds the JAMA SMS conversation for the contact, not the first inbox thread', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      payload: [
        { id: 99, inbox_id: 2, status: 'open' },
        { id: 20, inbox_id: 3, status: 'open' },
      ],
    }));
    const client = new HttpChatwootClient({
      baseUrl: 'http://localhost:3001', accountId: 1, inboxId: 3, apiToken: 'test-token', fetcher,
    });

    await expect(client.findConversation(10)).resolves.toEqual({ id: 20, status: 'open' });
    expect(fetcher.mock.calls[0]?.[0]).toContain('/api/v1/accounts/1/contacts/10/conversations');
  });

  it('reads the contact phone from a conversation show response', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      meta: { sender: { phone_number: '+37360000000' } },
    }));
    const client = new HttpChatwootClient({
      baseUrl: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test-token', fetcher,
    });

    await expect(client.getConversationContactPhone(20)).resolves.toBe('+37360000000');
    expect(fetcher.mock.calls[0]?.[0]).toContain('/api/v1/accounts/1/conversations/20');
  });

  it('upsertCrmContact updates CRM fields and ensures the configured SMS inbox binding', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        payload: [{
          id: 7,
          identifier: '90001',
          phone_number: '+14155552671',
          contact_inboxes: [],
        }],
      }))
      .mockResolvedValueOnce(response({ source_id: 'jama-inbox-src', inbox: { id: 2 } }))
      .mockResolvedValueOnce(response({}));
    const client = new HttpChatwootClient({
      baseUrl: 'http://localhost:3001', accountId: 1, inboxId: 2, apiToken: 'test-token', fetcher,
    });

    await expect(client.upsertCrmContact({
      identifier: '90001',
      phone: '+14155552671',
      name: 'Campaign Contact',
    })).resolves.toEqual({ id: 7, sourceId: 'jama-inbox-src' });

    expect(fetcher.mock.calls[1]?.[0]).toContain('/api/v1/accounts/1/contacts/7/contact_inboxes');
    expect(fetcher.mock.calls[2]?.[0]).toContain('/api/v1/accounts/1/contacts/7');
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'PUT' });
  });

  it('attaches the JAMA inbox when a phone match exists without that inbox binding', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        payload: [{
          id: 1,
          phone_number: '+37360000000',
          contact_inboxes: [{ source_id: 'other-inbox', inbox: { id: 1 } }],
        }],
      }))
      .mockResolvedValueOnce(response({
        source_id: 'jama-source',
        inbox: { id: 3 },
      }));
    const client = new HttpChatwootClient({
      baseUrl: 'http://localhost:3001', accountId: 1, inboxId: 3, apiToken: 'test-token', fetcher,
    });

    await expect(client.findContactByPhone('+37360000000')).resolves.toEqual({
      id: 1,
      sourceId: 'jama-source',
    });
    expect(fetcher.mock.calls[1]?.[0]).toContain('/api/v1/accounts/1/contacts/1/contact_inboxes');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ inbox_id: 3 });
  });
});



describe('HttpTelnyxClient', () => {
  it('uses one fixed SMS request with no retry loop', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: { id: 'message-1' } }));
    const client = new HttpTelnyxClient({ apiKey: 'test-key', fetcher });

    await expect(client.sendSms({ from: '+15551234567', to: '+14155552671', text: 'fixture text' }))
      .resolves.toEqual({ id: 'message-1' });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://api.telnyx.com/v2/messages', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ from: '+15551234567', to: '+14155552671', text: 'fixture text', type: 'SMS', use_profile_webhooks: true }),
    }));
  });
});
