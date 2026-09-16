import { beforeEach, expect, it, vi } from 'vitest';
const doubles = vi.hoisted(() => ({
  list: vi.fn(async (_table: string, _options?: unknown) => ({ items: [] as any[], nextToken: undefined })),
  add: vi.fn(async (_table: string, _rows: any[]) => ['saved-id']),
  update: vi.fn(async () => [true]),
  backfill: vi.fn(async () => ({ processed: 0 })),
}));
vi.mock('@appdeploy/sdk', () => ({
  db: doubles, router: (routes: unknown) => routes,
  requireAuth: () => 'SDK_AUTH_REQUIRED',
  json: (data: unknown, statusCode = 200) => ({ body: JSON.stringify(data), statusCode }),
  error: (error: string, statusCode = 500) => ({ body: JSON.stringify({ error }), statusCode }),
}));
vi.mock('../../backend/backfill', () => ({ getBackfillStatus: async () => ({ processed: 0 }), runBackfillBatch: doubles.backfill }));
import { handler } from '../../backend/index';
import { saveReportHistory, listReportHistory, saveDemoRequest } from '../../backend/operations';
const routes = handler as unknown as Record<string, any[]>;
beforeEach(() => {
  vi.clearAllMocks();
  doubles.list.mockImplementation(async table => ({ items: table === 'ingestion_meta' ? [{ version: 28 }] : [], nextToken: undefined }));
});

it('registers SDK authentication on every operational route', () => {
  for (const path of ['GET /api/dashboard', 'GET /api/pilot/outcomes', 'POST /api/pilot/outcomes', 'GET /api/reports/history', 'POST /api/reports/history']) expect(routes[path][0]).toBe('SDK_AUTH_REQUIRED');
});
it('does not run ingestion while reading a dashboard', async () => {
  const response = await routes['GET /api/dashboard'][1]({ user: { userId: 'qa-a' } });
  expect(response.statusCode).toBe(200);
  expect(doubles.backfill).not.toHaveBeenCalled();
  expect(doubles.list).toHaveBeenCalledWith('pilot_outcomes:qa-a', expect.anything());
});
it('persists report history only under the authenticated owner', async () => {
  const user = { userId: 'qa-a', scope: '' };
  const result = await saveReportHistory(user, { ownerUserId: 'qa-b', headline: 'Private A', projectCount: 2 });
  expect(result?.ownerUserId).toBe('qa-a');
  expect(doubles.add).toHaveBeenCalledWith('report_history:qa-a', [expect.objectContaining({ ownerUserId: 'qa-a' })]);
  await listReportHistory({ userId: 'qa-b', scope: '' });
  expect(doubles.list).toHaveBeenCalledWith('report_history:qa-b', expect.anything());
});
it('rejects invalid demo data without storing it', async () => {
  const result = await saveDemoRequest({ name: 'QA', company: 'QA company', email: 'invalid' });
  expect(result.ok).toBe(false);
  expect(doubles.add).not.toHaveBeenCalled();
});
