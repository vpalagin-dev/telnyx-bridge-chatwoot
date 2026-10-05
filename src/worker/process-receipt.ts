import { randomUUID } from 'node:crypto';
import type { ChatwootClient } from '../chatwoot/client.js';
import { buildPostInboundAiHook } from '../ai/process-ai.js';
import type { AiTelnyxDispatcher, ChatwootAiHistoryWriter, OpenAiAdapter } from '../ai/types.js';
import type { BridgeConfig } from '../config/env.js';
import type { OperationalStore } from '../persistence/operational-store.js';
import { processTelnyxInbound, type InboundResult } from '../inbound/process-inbound.js';
import type { Receipt, PostgresStore } from '../persistence/postgres-store.js';
import { startOutboxRecoveryLoop, type RedisDispatch, type RecoveryLoop } from '../persistence/redis-dispatch.js';

export type WorkerReceiptStore = Pick<PostgresStore, 'claimReceipt' | 'completeReceipt' | 'retryReceipt' | 'markReviewRequired'> & {
  getOutboxReceipt?: (jobId: string) => Promise<string | null>;
  claimOutboxPublicationBatch?: PostgresStore['claimOutboxPublicationBatch'];
  markOutboxPublished?: PostgresStore['markOutboxPublished'];
  /** @deprecated compatibility with Task 3 stores. */
  claimOutboxBatch?: PostgresStore['claimOutboxBatch'];
  /** @deprecated compatibility with Task 3 stores. */
  markOutboxDispatched?: PostgresStore['markOutboxDispatched'];
};

export type ReceiptProcessorDeps = {
  /** PostgreSQL operational state store; receipt lifecycle remains separate. */
  operationalStore?: OperationalStore;
  chatwoot?: ChatwootClient;
  senderNumber?: string;
  config?: BridgeConfig;
  openai?: OpenAiAdapter;
  history?: ChatwootAiHistoryWriter;
  telnyx?: AiTelnyxDispatcher;
  processInbound?: typeof processTelnyxInbound;
  inboundDependencies?: Parameters<typeof processTelnyxInbound>[1];
};

export type ReceiptResult =
  | { status: 'completed'; outcome: InboundResult['outcome'] | 'ignored'; inbound?: InboundResult }
  | { status: 'retryable'; error: Error; nextAttemptAt: Date }
  | { status: 'needs_review'; reason: string; error?: Error; inbound?: InboundResult };

export type RetryOptions = {
  now?: () => number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const defaultRetry: Required<RetryOptions> = {
  now: Date.now,
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

export async function processReceipt(receipt: Receipt, deps: ReceiptProcessorDeps, options: RetryOptions = {}): Promise<ReceiptResult> {
  const retry = { ...defaultRetry, ...options };
  if (!isEligibleInboundSms(receipt.rawPayload)) return { status: 'completed', outcome: 'ignored' };

  const processInbound = deps.processInbound ?? processTelnyxInbound;
  const inboundDependencies = deps.inboundDependencies ?? (processInbound === processTelnyxInbound
    ? buildInboundDependencies(deps)
    : ({} as Parameters<typeof processTelnyxInbound>[1]));
  try {
    const inbound = await processInbound(receipt.rawPayload, inboundDependencies);
    if (inbound.outcome === 'unknown_needs_review') {
      return { status: 'needs_review', reason: 'inbound pipeline reported ambiguous state', inbound };
    }
    return { status: 'completed', outcome: inbound.outcome, inbound };
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const eventId = readEventId(receipt.rawPayload);
    if (eventId && await deps.operationalStore?.getEventStatus('telnyx', eventId) === 'unknown_needs_review') {
      return { status: 'needs_review', reason: 'inbound side effect outcome is ambiguous', error };
    }
    if (!isRetryableError(error)) return { status: 'needs_review', reason: 'inbound processing failed without a retry-safe classification', error };
    const attempt = receipt.attempts + 1;
    if (attempt >= retry.maxAttempts) return { status: 'needs_review', reason: `retry limit reached after ${attempt} attempts`, error };
    const delay = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** Math.max(0, receipt.attempts));
    return { status: 'retryable', error, nextAttemptAt: new Date(retry.now() + delay) };
  }
}

function buildInboundDependencies(deps: ReceiptProcessorDeps): Parameters<typeof processTelnyxInbound>[1] {
  if (!deps.operationalStore || !deps.chatwoot || !deps.senderNumber) {
    throw new Error('Worker inbound dependencies require persistent operationalStore, chatwoot, and senderNumber');
  }
  const result: Parameters<typeof processTelnyxInbound>[1] = {
    store: deps.operationalStore,
    chatwoot: deps.chatwoot,
    senderNumber: deps.senderNumber,
  };
  if (deps.config && deps.openai && deps.history && deps.telnyx) {
    result.postInbound = buildPostInboundAiHook({ config: deps.config, store: deps.operationalStore, openai: deps.openai, history: deps.history, telnyx: deps.telnyx });
  }
  return result;
}

function isEligibleInboundSms(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return false;
  const event = data as { event_type?: unknown; payload?: unknown };
  if (event.event_type !== 'message.received' || !event.payload || typeof event.payload !== 'object') return false;
  const body = event.payload as { direction?: unknown; type?: unknown };
  return body.direction === 'inbound' && body.type === 'SMS';
}

function readEventId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function isRetryableError(error: Error & { retryable?: boolean; code?: string }): boolean {
  if (error.retryable === true) return true;
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED'].includes(error.code ?? '');
}

export type WorkerOptions = RetryOptions & {
  workerId?: string;
  pollIntervalMs?: number;
};

export type WorkerDependencies = {
  store: WorkerReceiptStore;
  dispatch?: Pick<RedisDispatch, 'consume' | 'close'>;
  processor: ReceiptProcessorDeps;
  /** Optional fallback polling source, normally a PostgreSQL outbox recovery loop supplies notifications. */
  receiptIds?: () => Promise<string[]>;
  wait?: (ms: number) => Promise<void>;
};

export type WorkerHandle = { stop(): Promise<void> };

export function startWorker(options: WorkerOptions, deps: WorkerDependencies): WorkerHandle {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let stopping = false;
  const active = new Set<Promise<void>>();
  let recovery: RecoveryLoop | undefined;

  const handleReceiptId = async (receiptId: string): Promise<void> => {
    const receipt = await deps.store.claimReceipt(receiptId, workerId);
    if (!receipt) return;
    const result = await processReceipt(receipt, deps.processor, options);
    if (result.status === 'completed') await deps.store.completeReceipt(receipt.receiptId, workerId);
    else if (result.status === 'retryable') await deps.store.retryReceipt(receipt.receiptId, workerId, result.error, result.nextAttemptAt);
    else await deps.store.markReviewRequired(receipt.receiptId, workerId, result.reason);
  };

  const enqueue = (receiptId: string): Promise<void> => {
    if (stopping) return Promise.resolve();
    const task = handleReceiptId(receiptId);
    active.add(task);
    void task.then(
      () => active.delete(task),
      () => active.delete(task),
    );
    return task;
  };

  if (deps.dispatch) {
    void deps.dispatch.consume(async (jobId) => {
      const receiptId = deps.store.getOutboxReceipt ? await deps.store.getOutboxReceipt(jobId) : jobId;
      if (receiptId) await enqueue(receiptId);
    }).then(() => {
      if ((deps.store.claimOutboxPublicationBatch ?? deps.store.claimOutboxBatch)
        && (deps.store.markOutboxPublished ?? deps.store.markOutboxDispatched)) {
        recovery = startOutboxRecoveryLoop(deps.store as PostgresStore, deps.dispatch as RedisDispatch, { dispatcherId: workerId });
      }
    });
  }

  if (deps.receiptIds) {
    const poll = async (): Promise<void> => {
      while (!stopping) {
        for (const receiptId of await deps.receiptIds!().catch(() => [])) enqueue(receiptId);
        await wait(pollIntervalMs);
      }
    };
    void poll();
  }

  return {
    async stop(): Promise<void> {
      stopping = true;
      if (recovery) await recovery.stop().catch(() => undefined);
      await Promise.allSettled([...active]);
      await deps.dispatch?.close().catch(() => undefined);
    },
  };
}

export async function runWorker(options: WorkerOptions, deps: WorkerDependencies): Promise<void> {
  const handle = startWorker(options, deps);
  const signals = ['SIGINT', 'SIGTERM'] as const;
  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => { resolveStop = resolve; });
  const onSignal = (): void => { void handle.stop().finally(resolveStop); };
  for (const signal of signals) process.once(signal, onSignal);
  await stopped;
  for (const signal of signals) process.off(signal, onSignal);
}
