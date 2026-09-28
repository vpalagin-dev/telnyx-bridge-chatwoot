import type { TelnyxClient, TelnyxSendInput } from './client.js';

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type Fetcher = (url: string, init?: RequestInit) => Promise<FetchResponse>;

export class HttpTelnyxClient implements TelnyxClient {
  readonly #apiKey: string;
  readonly #fetcher: Fetcher;

  constructor(options: { apiKey: string; fetcher?: Fetcher }) {
    this.#apiKey = options.apiKey;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async sendSms(input: TelnyxSendInput): Promise<{ id: string }> {
    const response = await this.#fetcher('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, type: 'SMS', use_profile_webhooks: true }),
    });
    if (!response.ok) throw new Error(`Telnyx request failed with status ${response.status}`);
    const body = (await response.json()) as { data?: { id?: string } };
    if (!body.data?.id) throw new Error('Telnyx response did not include a message ID');
    return { id: body.data.id };
  }
}
