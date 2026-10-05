import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { OutboxJob, PostgresStore } from './postgres-store.js';

export type RedisJob = Pick<OutboxJob, 'jobId'> | string;
export type RedisJobHandler = (jobId: string) => Promise<void> | void;

export type RecoveryLoop = {
  stop(): Promise<void>;
};

export type RecoveryOptions = {
  dispatcherId?: string;
  batchSize?: number;
  leaseDurationMs?: number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

/**
 * Redis is only a notification layer. PostgreSQL outbox state is updated by
 * the recovery helper after Redis acknowledges a publish.
 */
export class RedisDispatch {
  readonly #prefix: string;
  readonly #publisher: RedisClientType;
  readonly #subscriber: RedisClientType;
  readonly #seenJobIds = new Set<string>();
  #consuming = false;
  #subscribed = false;

  constructor(redisUrl: string, prefix = process.env.BRIDGE_REDIS_PREFIX ?? 'telnyx-bridge:') {
    if (!redisUrl) throw new Error('REDIS_URL is required');
    if (!prefix) throw new Error('BRIDGE_REDIS_PREFIX must not be empty');
    this.#prefix = prefix;
    this.#publisher = createClient({ url: redisUrl });
    this.#subscriber = this.#publisher.duplicate();
  }

  async publish(job: RedisJob): Promise<void> {
    const jobId = typeof job === 'string' ? job : job.jobId;
    if (!jobId) throw new Error('Redis dispatch jobId is required');
    await this.#connectPublisher();
    await this.#publisher.publish(this.#channel(jobId), jobId);
  }

  async consume(handler: RedisJobHandler): Promise<void> {
    if (this.#consuming) throw new Error('Redis dispatch consumer is already running');
    this.#consuming = true;
    await this.#subscriber.connect();
    await this.#subscriber.pSubscribe(`${this.#prefix}*`, (message, channel) => {
      const jobId = this.#jobIdFromChannel(channel, message);
      if (this.#seenJobIds.has(jobId)) return;
      this.#seenJobIds.add(jobId);
      void Promise.resolve(handler(jobId)).catch(() => {
        // A failed handler must be eligible for a later notification/recovery.
        this.#seenJobIds.delete(jobId);
      });
    });
    this.#subscribed = true;
  }

  async close(): Promise<void> {
    if (this.#subscribed && this.#subscriber.isReady) {
      await this.#subscriber.pUnsubscribe(`${this.#prefix}*`);
    }
    if (this.#subscriber.isOpen) await this.#subscriber.quit();
    if (this.#publisher.isOpen) await this.#publisher.quit();
    this.#consuming = false;
    this.#subscribed = false;
  }

  #channel(jobId: string): string {
    return `${this.#prefix}${jobId}`;
  }

  #jobIdFromChannel(channel: string, message: string): string {
    if (channel.startsWith(this.#prefix)) return channel.slice(this.#prefix.length);
    return message;
  }

  async #connectPublisher(): Promise<void> {
    if (!this.#publisher.isOpen) await this.#publisher.connect();
  }
}

export async function republishUndispatched(
  store: PostgresStore,
  dispatch: RedisDispatch,
  dispatcherId = `redis-recovery-${randomUUID()}`,
  limit = 100,
  leaseDurationMs = 30_000,
): Promise<number> {
  const jobs = await store.claimOutboxBatch(limit, dispatcherId, leaseDurationMs);
  let published = 0;
  for (const job of jobs) {
    await dispatch.publish(job);
    await store.markOutboxDispatched(job.jobId, dispatcherId);
    published += 1;
  }
  return published;
}

export function startOutboxRecoveryLoop(
  store: PostgresStore,
  dispatch: RedisDispatch,
  options: RecoveryOptions = {},
): RecoveryLoop {
  const dispatcherId = options.dispatcherId ?? `redis-recovery-${randomUUID()}`;
  const batchSize = options.batchSize ?? 100;
  const leaseDurationMs = options.leaseDurationMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 5_000;
  let stopped = false;
  let running: Promise<void> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = republishUndispatched(store, dispatch, dispatcherId, batchSize, leaseDurationMs)
      .then(() => undefined)
      .catch((error) => options.onError?.(error))
      .finally(() => {
        running = undefined;
      });
    await running;
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
