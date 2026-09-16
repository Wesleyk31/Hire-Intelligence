import { beforeEach, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, sequence: 0 }));
vi.mock('@appdeploy/sdk', () => ({
  router: (routes: unknown) => routes, requireAuth: () => 'SDK_AUTH_REQUIRED',
  json: (body: unknown, statusCode = 200) => ({ statusCode, body: JSON.stringify(body) }),
  error: (error: string, statusCode = 500) => ({ statusCode, body: JSON.stringify({ error }) }),
  db: {
    list: async (table: string, options: any = {}) => {
      const rows = memory.tables[table] || [], start = Number(options.nextToken || 0), limit = options.limit || 100;
      return { items: rows.slice(start, start + limit), nextToken: start + limit < rows.length ? String(start + limit) : undefined };
    },
    add: async (table: string, records: any[]) => records.map(record => { const id = `qa-${++memory.sequence}`; (memory.tables[table] ||= []).push({ ...record, id }); return id; }),
    update: async (table: string, updates: any[]) => updates.map(update => { const row = memory.tables[table]?.find(item => item.id === update.id); if (!row) return false; Object.assign(row, update.record); return true; }),
  },
}));
import { handler, SOURCES } from '../../backend/index';
const routes = handler as unknown as Record<string, any[]>;
const call = async (route: string, userId = 'qa-a', body?: unknown) => {
  const steps = routes[route];
  const response = await steps[steps.length - 1]({ user: { userId, scope: '' }, body, query: {}, params: {} });
  return { status: response.statusCode, data: JSON.parse(response.body) };
};
beforeEach(() => {
  memory.sequence = 0;
  memory.tables = { opportunities: [{ id: 'evidence', sourceKey: SOURCES[0].key, externalId: 'audit-only', project: 'QA Bridge Street Upgrade', location: 'Perth WA', company: '', description: 'Road construction', observedAt: new Date().toISOString(), sourceObservedAt: new Date().toISOString(), value: 'Not stated', provenance: 'Synthetic backend integration fixture' }] };
});

it('executes CRM lifecycle, unique funnel, account isolation and QA exclusion through real route handlers', async () => {
  const dashboard = await call('GET /api/dashboard');
  const projectId = dashboard.data.projects[0].id;
  expect((await call('POST /api/pilot/outcomes', 'qa-a', { projectId: 'missing', result: 'WON', wonValue: 10 })).status).toBe(400);
  expect((await call('POST /api/pilot/outcomes', 'qa-a', { projectId, result: 'QUOTED', quoteValue: 0 })).status).toBe(400);
  expect((await call('POST /api/pilot/outcomes', 'qa-a', { projectId, result: 'WON', wonValue: -10 })).status).toBe(400);
  for (const row of [{ result: 'CONTACTED' }, { result: 'QUOTED', quoteValue: 2500 }, { result: 'WON', quoteValue: 2500, wonValue: 2400 }, { result: 'FALSE_POSITIVE', qa: true }]) {
    expect((await call('POST /api/pilot/outcomes', 'qa-a', { projectId, ...row })).status).toBe(201);
  }
  const a = await call('GET /api/dashboard', 'qa-a');
  expect(a.data.pilot).toMatchObject({ contacted: 1, reviewed: 1, quotedValue: 2500, wonValue: 2400, falsePositiveRate: '0%' });
  expect(a.data.commercial.calibration.linkedRealOutcomes).toBe(1);
  expect((await call('GET /api/pilot/outcomes', 'qa-a')).data).toHaveLength(4);
  expect((await call('GET /api/pilot/outcomes', 'qa-b')).data).toEqual([]);
  expect((await call('GET /api/dashboard', 'qa-b')).data.pilot.contacted).toBe(0);
});

it('persists and reloads report metadata under the authenticated owner and server timestamp', async () => {
  const saved = await call('POST /api/reports/history', 'qa-a', { ownerUserId: 'qa-b', headline: 'QA saved report', generatedAt: '2020-01-01', projectCount: 1, opportunityCount: 1 });
  expect(saved.status).toBe(201);
  expect(saved.data.ownerUserId).toBe('qa-a');
  expect(saved.data.generatedAt).not.toBe('2020-01-01');
  const a = await call('GET /api/reports/history', 'qa-a');
  expect(a.data.reports).toHaveLength(1);
  expect(a.data.reports[0].headline).toBe('QA saved report');
  expect((await call('GET /api/reports/history', 'qa-b')).data.reports).toEqual([]);
});

it('public demo validation persists only a valid local request and public summary has no operational records', async () => {
  expect((await call('POST /api/demo-request', '', { name: 'QA', company: 'QA Co', email: 'invalid' })).status).toBe(400);
  expect(memory.tables.demo_requests).toBeUndefined();
  expect((await call('POST /api/demo-request', '', { name: 'QA', company: 'QA Co', email: 'qa@example.test', website: 'bot.test' })).status).toBe(400);
  expect((await call('POST /api/demo-request', '', { name: 'QA', company: 'QA Co', email: 'qa@example.test' })).status).toBe(201);
  expect(memory.tables.demo_requests).toHaveLength(1);
  const publicSummary = await call('GET /api/public/summary', '');
  expect(publicSummary.data.metrics.active).toBe(1);
  expect(JSON.stringify(publicSummary.data)).not.toContain('QA Bridge Street');
  expect(publicSummary.data).not.toHaveProperty('projects');
  expect(publicSummary.data).not.toHaveProperty('pilot');
});