import { beforeEach, expect, it, vi } from 'vitest';
const doubles = vi.hoisted(() => ({
  list: vi.fn(async (_table: string, _options?: unknown) => ({
    items: [] as any[],
    nextToken: undefined,
  })),
  add: vi.fn(async (_table: string, _rows: any[]) => ['saved-id']),
  update: vi.fn(async () => [true]),
  backfill: vi.fn(async () => ({ processed: 0 })),
}));
vi.mock('@appdeploy/sdk', () => ({
  db: doubles,
  router: (routes: unknown) => routes,
  requireAuth: () => 'SDK_AUTH_REQUIRED',
  json: (data: unknown, statusCode = 200) => ({
    body: JSON.stringify(data),
    statusCode,
  }),
  error: (error: string, statusCode = 500) => ({
    body: JSON.stringify({ error }),
    statusCode,
  }),
}));
vi.mock('../../backend/backfill', () => ({
  getBackfillStatus: async () => ({ processed: 0 }),
  runBackfillBatch: doubles.backfill,
}));
import { handler } from '../../backend/index';
import {
  saveReportHistory,
  listReportHistory,
  saveDemoRequest,
} from '../../backend/operations';
const routes = handler as unknown as Record<string, any[]>;
beforeEach(() => {
  vi.clearAllMocks();
  doubles.list.mockImplementation(async (table) => ({
    items: table === 'ingestion_meta' ? [{ version: 28 }] : [],
    nextToken: undefined,
  }));
});

it('denies direct operational access even for unrelated platform accounts', async () => {
  for (const path of [
    'GET /api/dashboard',
    'GET /api/sources/contracts',
    'GET /api/sources/:key/health',
    'GET /api/evidence/review',
    'GET /api/sources/pilots/:key',
    'GET /api/sources/:key/diagnostic',
    'GET /api/pilot/outcomes',
    'POST /api/pilot/outcomes',
    'GET /api/reports/history',
    'POST /api/reports/history',
  ])
    expect(
      (await routes[path][0]({ user: { userId: 'unrelated-platform-user' } }))
        .statusCode,
    ).toBe(401);
});
it('does not run ingestion while reading a dashboard', async () => {
  const response = await routes['GET /api/dashboard'][1]({
    user: { userId: 'qa-a' },
  });
  expect(response.statusCode).toBe(200);
  expect(doubles.backfill).not.toHaveBeenCalled();
  expect(doubles.list).toHaveBeenCalledWith(
    'pilot_outcomes:qa-a',
    expect.anything(),
  );
});
it('persists report history only under the authenticated owner', async () => {
  const user = { userId: 'qa-a', scope: '' };
  const result = await saveReportHistory(user, {
    ownerUserId: 'qa-b',
    headline: 'Private A',
    projectCount: 2,
  });
  expect(result?.ownerUserId).toBe('qa-a');
  expect(doubles.add).toHaveBeenCalledWith('report_history:qa-a', [
    expect.objectContaining({ ownerUserId: 'qa-a' }),
  ]);
  await listReportHistory({ userId: 'qa-b', scope: '' });
  expect(doubles.list).toHaveBeenCalledWith(
    'report_history:qa-b',
    expect.anything(),
  );
});
it('rejects invalid demo data without storing it', async () => {
  const result = await saveDemoRequest({
    name: 'QA',
    company: 'QA company',
    email: 'invalid',
  });
  expect(result.ok).toBe(false);
  expect(doubles.add).not.toHaveBeenCalled();
});

it('rejects invalid evidence limits and unknown pilots without storage or network activity', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const review = await routes['GET /api/evidence/review'][1]({
    user: { userId: 'qa-a' },
    query: { limit: '100000' },
  });
  const pilot = await routes['GET /api/sources/pilots/:key'][1]({
    user: { userId: 'qa-a' },
    params: { key: 'unregistered-host' },
  });
  expect(review.statusCode).toBe(400);
  expect(pilot.statusCode).toBe(404);
  expect(doubles.list).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});

it('validates CRM linkage against the selected later evidence window and rejects malformed cursors', async () => {
  const rows = Array.from({ length: 1501 }, (_, i) => ({
    id: 'qa-' + i,
    externalId: 'stable-' + i,
    sourceKey: 'qa-source',
    project: i === 1500 ? 'QA Later Window Bridge' : 'QA First Window Bridge',
    location: 'Perth WA',
    company: '',
    description: 'Bridge approval',
    value: 'Not stated',
    sourceObservedAt: '2026-08-01',
    observedAt: '2026-09-16',
    provenance: 'https://example.test/qa',
  }));
  doubles.list.mockImplementation(async (table, options: any = {}) => {
    if (table !== 'opportunities') return { items: [], nextToken: undefined };
    const start = Number(options.nextToken || 0),
      end = start + (options.limit || 100);
    return {
      items: rows.slice(start, end),
      nextToken: end < rows.length ? String(end) : undefined,
    } as any;
  });
  const first = JSON.parse(
    (
      await routes['GET /api/dashboard'][1]({
        user: { userId: 'qa-a' },
        query: {},
      })
    ).body,
  );
  expect(first.universe.nextCursor).toBeTruthy();
  const later = JSON.parse(
    (
      await routes['GET /api/dashboard'][1]({
        user: { userId: 'qa-a' },
        query: { cursor: first.universe.nextCursor },
      })
    ).body,
  );
  expect(later.projects).toHaveLength(1);
  expect(later.projects[0].name).toBe('QA Later Window Bridge');
  const valid = await routes['POST /api/pilot/outcomes'][1]({
    user: { userId: 'qa-a' },
    body: {
      projectId: later.projects[0].id,
      result: 'CONTACTED',
      qa: 'true',
      evidenceCursor: first.universe.nextCursor,
    },
  });
  expect(valid.statusCode).toBe(201);
  expect(doubles.add).toHaveBeenCalledWith('pilot_outcomes:qa-a', [
    expect.objectContaining({ projectId: later.projects[0].id, qa: true }),
  ]);
  doubles.add.mockClear();
  const bad = await routes['POST /api/pilot/outcomes'][1]({
    user: { userId: 'qa-a' },
    body: {
      projectId: later.projects[0].id,
      result: 'CONTACTED',
      evidenceCursor: 'not-a-valid-cursor',
    },
  });
  expect(bad.statusCode).toBe(400);
  expect(doubles.add).not.toHaveBeenCalled();
});

it('public aggregates exclude held evidence without exposing raw records', async () => {
  const base = {
    sourceKey: 'qa-source',
    externalId: '1',
    project: 'QA Bridge',
    location: 'Perth WA',
    company: '',
    description: 'Contract awarded',
    stage: 'PREPARE',
  };
  doubles.list.mockImplementation(async (table) => ({
    items:
      table === 'opportunities'
        ? [
            { ...base, qualityFlags: ['INVALID_INPUT'] },
            { ...base, externalId: '2', project: 'QA Mine', contextOnly: true },
          ]
        : [],
    nextToken: undefined,
  }));
  const summary = JSON.parse(
    (await routes['GET /api/public/summary'][0]({})).body,
  );
  expect(summary.metrics).toMatchObject({
    active: 0,
    highPriority: 0,
    eventSignals: 0,
  });
  expect(summary.universe).toMatchObject({ loaded: 2, heldEvidence: 2 });
  expect(JSON.stringify(summary)).not.toContain('QA Bridge');
  expect(doubles.add).not.toHaveBeenCalled();
  expect(doubles.update).not.toHaveBeenCalled();
});
