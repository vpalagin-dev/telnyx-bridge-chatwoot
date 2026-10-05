import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Receipt } from '../../src/persistence/postgres-store.js';
import { processReceipt, startWorker, type ReceiptProcessorDeps, type WorkerReceiptStore } from '../../src/worker/process-receipt.js';

const payload = {
  data: {
    id: 'evt-worker-1',
    event_type: 'message.received',
    payload: {
      id: 'msg-worker-1',
      direction: 'inbound',
      type: 'SMS',
      from: { phone_number: '+14155552671' },
      to: [{ phone_number: '+15551234567' }],
      text: 'hello',
    },
  },
};

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    receiptId: 'receipt-1', provider: 'telnyx', providerEventId: 'evt-worker-1', rawPayload: payload,
    status: 'processing', attempts: 0, nextAttemptAt: new Date(), lockedBy: 'worker-1', lockedAt: new Date(),
    lastError: null, receivedAt: new Date(), processedAt: null, resultCode: null, ...overrides,
  };
}

function processorDeps(overrides: Partial<ReceiptProcessorDeps> = {}): ReceiptProcessorDeps {
  return {
    processInbound: async () => ({ outcome: 'created', telnyxEventId: 'evt-worker-1', telnyxMessageId: 'msg-worker-1', chatwootConversationId: 1, chatwootMessageId: 2 }),
    ...overrides,
  } as ReceiptProcessorDeps;
}

describe('worker receipt processing', () => {
  it('processes an eligible inbound SMS exactly once', async () => {
    let calls = 0;
    const result = await processReceipt(receipt(), processorDeps({ processInbound: async () => { calls += 1; return { outcome: 'created', telnyxEventId: 'evt-worker-1', telnyxMessageId: 'msg-worker-1', chatwootConversationId: 1, chatwootMessageId: 2 }; } }));
    expect(result).toMatchObject({ status: 'completed', outcome: 'created' });
    expect(calls).toBe(1);
  });

  it('completes duplicate inbound receipts without repeating downstream work', async () => {
    let calls = 0;
    const result = await processReceipt(receipt(), processorDeps({ processInbound: async () => { calls += 1; return { outcome: 'duplicate', telnyxEventId: 'evt-worker-1' }; } }));
    expect(result).toMatchObject({ status: 'completed', outcome: 'duplicate' });
    expect(calls).toBe(1);
  });

  it('does not process non-inbound or non-SMS receipts', async () => {
    let calls = 0;
    const invalid = { ...payload, data: { ...payload.data, event_type: 'message.sent', payload: { ...payload.data.payload, direction: 'outbound' } } };
    const result = await processReceipt(receipt({ rawPayload: invalid }), processorDeps({ processInbound: async () => { calls += 1; return { outcome: 'ignored', telnyxEventId: 'evt-worker-1' }; } }));
    expect(result).toEqual({ status: 'completed', outcome: 'ignored' });
    expect(calls).toBe(0);
  });

  it('returns review for an inbound pipeline that already has ambiguous state', async () => {
    const deps = processorDeps({
      operationalStore: { getEventStatus: async () => 'unknown_needs_review' } as never,
      processInbound: async () => { throw new Error('downstream failure'); },
    });
    await expect(processReceipt(receipt(), deps)).resolves.toMatchObject({ status: 'needs_review' });
  });

  it('awaits the operational status before classifying a failed inbound pipeline', async () => {
    let statusResolved = false;
    const deps = processorDeps({
      operationalStore: { getEventStatus: async () => { await Promise.resolve(); statusResolved = true; return 'unknown_needs_review'; } } as never,
      processInbound: async () => { throw new Error('downstream failure'); },
    });
    const result = await processReceipt(receipt(), deps);
    expect(statusResolved).toBe(true);
    expect(result).toMatchObject({ status: 'needs_review', reason: 'inbound side effect outcome is ambiguous' });
  });

  it('classifies explicitly retryable failures and applies bounded exponential delay', async () => {
    const error = Object.assign(new Error('temporary outage'), { retryable: true });
    const result = await processReceipt(receipt({ attempts: 1 }), processorDeps({ processInbound: async () => { throw error; } }), { now: () => 1_000, maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 500 });
    expect(result).toMatchObject({ status: 'retryable', nextAttemptAt: new Date(1_200) });
  });

  it('moves a retryable receipt to review after the attempt limit', async () => {
    const error = Object.assign(new Error('temporary outage'), { retryable: true });
    const result = await processReceipt(receipt({ attempts: 4 }), processorDeps({ processInbound: async () => { throw error; } }), { maxAttempts: 5 });
    expect(result).toMatchObject({ status: 'needs_review' });
  });
});

type FakeStore = WorkerReceiptStore & { receipt: Receipt; completed: number; retries: number; reviews: number };
function fakeStore(initial: Receipt): FakeStore {
  return {
    receipt: initial, completed: 0, retries: 0, reviews: 0,
    async claimReceipt(id, workerId) { return id === this.receipt.receiptId && workerId === this.receipt.lockedBy ? this.receipt : null; },
    async completeReceipt() { this.completed += 1; },
    async retryReceipt() { this.retries += 1; },
    async markReviewRequired() { this.reviews += 1; },
  };
}

describe('runWorker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('claims and completes a receipt, then stops gracefully', async () => {
    const store = fakeStore(receipt());
    let stopped = false;
    const worker = startWorker({ workerId: 'worker-1', pollIntervalMs: 1, maxAttempts: 3 }, {
      store, receiptIds: async () => ['receipt-1'], processor: processorDeps(),
      wait: async () => { stopped = true; },
    });
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(stopped).toBe(true);
    expect(store.completed).toBe(1);
  });

  it('awaits Redis notification processing and propagates transition failures', async () => {
    const store = fakeStore(receipt());
    store.completeReceipt = async () => { throw new Error('durable transition failed'); };
    let handler: ((jobId: string) => Promise<void>) | undefined;
    const dispatch = {
      consume: vi.fn(async (callback: (jobId: string) => Promise<void>) => { handler = callback; }),
      close: vi.fn(async () => undefined),
    };
    const worker = startWorker({ workerId: 'worker-1' }, { store, dispatch, processor: processorDeps() });
    await vi.waitFor(() => expect(handler).toBeDefined());
    await expect(handler!('receipt-1')).rejects.toThrow('durable transition failed');
    await worker.stop();
  });
});
