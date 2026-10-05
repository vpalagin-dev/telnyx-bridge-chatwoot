import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock('redis', () => redisMock);

import { RedisDispatch } from '../../src/persistence/redis-dispatch.js';

describe('RedisDispatch close failure handling', () => {
  beforeEach(() => {
    redisMock.createClient.mockReset();
  });

  it('attempts both client quits after unsubscribe fails and resets state', async () => {
    const subscriptions: Array<(message: string, channel: string) => void> = [];
    const publisher = {
      isOpen: true,
      duplicate: vi.fn(),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    const subscriber = {
      isOpen: true,
      isReady: true,
      on: vi.fn(),
      pSubscribe: vi.fn(async (_pattern: string, callback: (message: string, channel: string) => void) => {
        subscriptions.push(callback);
      }),
      pUnsubscribe: vi.fn().mockRejectedValue(new Error('unsubscribe failed')),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    publisher.duplicate.mockReturnValue(subscriber);
    redisMock.createClient.mockReturnValue(publisher);

    const dispatch = new RedisDispatch('redis://test', 'test:');
    const handled: string[] = [];
    await dispatch.consume((jobId) => {
      handled.push(jobId);
    });
    subscriptions[0]!('job-1', 'test:job-1');
    await vi.waitFor(() => expect(handled).toEqual(['job-1']));

    await expect(dispatch.close()).rejects.toThrow('unsubscribe failed');
    expect(subscriber.pUnsubscribe).toHaveBeenCalledWith('test:*');
    expect(subscriber.quit).toHaveBeenCalledOnce();
    expect(publisher.quit).toHaveBeenCalledOnce();

    await dispatch.consume((jobId) => {
      handled.push(jobId);
    });
    subscriptions[1]!('job-1', 'test:job-1');
    await vi.waitFor(() => expect(handled).toEqual(['job-1', 'job-1']));
  });
});
