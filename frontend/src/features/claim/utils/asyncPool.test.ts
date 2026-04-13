import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from './asyncPool';

describe('runWithConcurrency', () => {
  it('limits active workers to the requested concurrency', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const visited: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (item) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 20));
      visited.push(item);
      activeCount -= 1;
    });

    expect(maxActiveCount).toBe(3);
    expect(visited.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('falls back to serial execution when concurrency is invalid', async () => {
    const order: number[] = [];

    await runWithConcurrency([1, 2, 3], 0, async (item) => {
      order.push(item);
    });

    expect(order).toEqual([1, 2, 3]);
  });
});
