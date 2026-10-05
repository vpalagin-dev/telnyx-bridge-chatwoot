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
  #lastRedisError: unknown;

  constructor(redisUrl: string, prefix = process.env.BRIDGE_REDIS_PREFIX ?? 'telnyx-bridge:') {
    if (!redisUrl) throw new Error('REDIS_URL is required');
    if (!prefix) throw new Error('BRIDGE_REDIS_PREFIX must not be empty');
    if (!/^[A-Za-z0-9:_-]+$/.test(prefix)) {
      throw new Error('BRIDGE_REDIS_PREFIX contains unsafe channel characters');
    }
    this.#prefix = prefix;
    const options = {
      url: redisUrl,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries: number) =>
          retries >= 3 ? new Error('Redis reconnect limit exceeded') : Math.min(100 * 2 ** retries, 1_000),
      },
    };
    this.#publisher = createClient(options);
    this.#subscriber = this.#publisher.duplicate();
    const recordRedisError = (error: unknown): void => {
      this.#lastRedisError = error;
    };
    this.#publisher.on('error', recordRedisError);
    this.#subscriber.on('error', recordRedisError);
  }

  get lastRedisError(): unknown {
    return this.#lastRedisError;
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
    try {
      if (!this.#subscriber.isOpen) await this.#subscriber.connect();
      await this.#subscriber.pSubscribe(`${this.#prefix}*`, (message, channel) => {
        const jobId = this.#jobIdFromChannel(channel, message);
        if (this.#seenJobIds.has(jobId)) return;
        this.#seenJobIds.add(jobId);
        void Promise.resolve()
          .then(() => handler(jobId))
          .catch(() => {
            // A failed handler must be eligible for a later notification/recovery.
            this.#seenJobIds.delete(jobId);
          });
      });
      this.#subscribed = true;
    } catch (error) {
      this.#consuming = false;
      this.#subscribed = false;
      this.#seenJobIds.clear();
      if (this.#subscriber.isOpen) await this.#subscriber.quit().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.#subscribed && this.#subscriber.isReady) {
        await this.#subscriber.pUnsubscribe(`${this.#prefix}*`);
      }
      if (this.#subscriber.isOpen) await this.#subscriber.quit();
      if (this.#publisher.isOpen) await this.#publisher.quit();
    } finally {
      this.#consuming = false;
      this.#subscribed = false;
      this.#seenJobIds.clear();
    }
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
    await store.markOutboxDispatched(job.jobId, dispatcherId, leaseDurationMs);
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
  assertPositiveFinite('batchSize', batchSize);
  assertPositiveFinite('leaseDurationMs', leaseDurationMs);
  assertPositiveFinite('intervalMs', intervalMs);
  let stopped = false;
  let running: Promise<void> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = republishUndispatched(store, dispatch, dispatcherId, batchSize, leaseDurationMs)
      .then(() => undefined)
      .catch((error) => {
        try {
          options.onError?.(error);
        } catch {
          // Error reporting must not create an unhandled rejection in the loop.
        }
      })
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

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}
