import { expect, it, vi } from 'vitest';
import { boundedDashboardResponse } from '../../backend/dashboard-response';

it('returns a small dashboard without rereading evidence', async () => {
  const build = vi.fn(async () => ({
    projects: [],
    universe: { nextCursor: 'next' },
  }));
  const result = await boundedDashboardResponse(build);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).universe.nextCursor).toBe('next');
  expect(build.mock.calls).toEqual([[250]]);
});

it('rebuilds an oversized response from the same starting position with a smaller window', async () => {
  const build = vi.fn(async (limit: number) => ({
    projects: limit === 250 ? ['"'.repeat(3 * 1024 * 1024)] : ['small'],
    universe: { nextCursor: 'cursor-after-' + limit },
  }));
  const result = await boundedDashboardResponse(build);
  expect(build.mock.calls).toEqual([[250], [100]]);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).universe.nextCursor).toBe('cursor-after-100');
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
    5 * 1024 * 1024,
  );
});

it('fails visibly when even one record exceeds the budget instead of returning an oversized payload', async () => {
  const build = vi.fn(async () => ({ content: '💡'.repeat(2 * 1024 * 1024) }));
  const result = await boundedDashboardResponse(build);
  expect(build.mock.calls).toEqual([[250], [100], [25], [1]]);
  expect(result.statusCode).toBe(503);
  expect(result.body).toContain('too large');
});

it('does not retry a failed database read', async () => {
  const failure = new Error('AppDatabaseQuotaExceeded');
  const build = vi.fn(async () => {
    throw failure;
  });
  await expect(boundedDashboardResponse(build)).rejects.toBe(failure);
  expect(build).toHaveBeenCalledTimes(1);
});
