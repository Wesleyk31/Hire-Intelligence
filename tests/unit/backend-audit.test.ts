import { beforeEach, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({
  list: vi.fn(async (_table: string, _options?: any) => ({ items: [] as any[], nextToken: undefined as string | undefined })),
  add: vi.fn(async (_table: string, rows: any[]) => rows.map((_, index) => `saved-${index}`)),
  update: vi.fn(async (_table: string, rows: any[]) => rows.map(() => true)),
}));
vi.mock('@appdeploy/sdk', () => ({ db: store, router: (routes: unknown) => routes, requireAuth: () => 'SDK_AUTH_REQUIRED', json: (body: unknown, statusCode = 200) => ({ statusCode, body: JSON.stringify(body) }), error: (error: string, statusCode = 500) => ({ statusCode, body: JSON.stringify({ error }) }) }));
vi.mock('../../backend/backfill', () => ({ getBackfillStatus: async () => ({ processed: 0 }), runBackfillBatch: vi.fn() }));
import { handler, SOURCES } from '../../backend/index';
import { buildProjectIntelligence, buildCalibrationMetrics } from '../../backend/intelligence';
import { buildCommercialIntelligence } from '../../backend/commercial-intelligence';
import { listReportHistory, saveDemoRequest } from '../../backend/operations';
const routes = handler as unknown as Record<string, any[]>;
const user = { userId: 'qa-a', scope: '' };
const record = (id: string, project = 'Bridge Street Upgrade', location = 'Perth WA') => ({
  id, sourceKey: SOURCES[0].key, externalId: id, project, location, stage: 'WATCH', score: 40, company: '', description: '', value: 'Not stated',
  observedAt: new Date().toISOString(), sourceObservedAt: new Date().toISOString(), provenance: 'QA fixture',
});
beforeEach(() => { vi.clearAllMocks(); store.list.mockImplementation(async () => ({ items: [], nextToken: undefined })); });

it('public regional counts represent unique projects and recognise Australian state names', async () => {
  store.list.mockImplementation(async table => ({ items: table === 'opportunities' ? [record('a'), record('b'), record('c', 'Albany Works', 'Albany Western Australia')] : [], nextToken: undefined }));
  const response = await routes['GET /api/public/summary'][0]({});
  const result = JSON.parse(response.body);
  expect(result.metrics.active).toBe(2);
  expect(result.regionalCounts.WA).toBe(2);
  expect(response.body).not.toContain('Bridge Street');
});

it('retains all canonical projects in the bounded evidence window beyond 500', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => record(String(index), 'Permit'));
  const projects = await buildProjectIntelligence(rows, []);
  expect(projects).toHaveLength(501);
});

it('does not advertise old stored source successes as currently healthy', async () => {
  store.list.mockImplementation(async table => ({ items: table === 'source_states' ? [{ id: 'state', sourceKey: SOURCES[0].key, status: 'SUCCESS', lastRun: '2020-01-01T00:00:00Z', recordsFetched: 40 }] : [], nextToken: undefined }));
  const response = await routes['GET /api/dashboard'][1]({ user });
  const result = JSON.parse(response.body);
  expect(result.sources.active).toBe(0);
  expect(result.sources.states[0].status).toBe('DEGRADED');
  expect(result.sources.states[0].message).toMatch(/stale|overdue/i);
});

it('repeated outcomes for one project cannot satisfy a 20-project calibration sample', async () => {
  const projects = await buildProjectIntelligence([record('one')], []);
  const outcomes = Array.from({ length: 20 }, () => ({ projectId: projects[0].id, project: projects[0].name, result: 'WON' as const, recordedAt: new Date().toISOString(), qa: false }));
  expect(buildCalibrationMetrics(projects, outcomes).matchedReviewed).toBe(1);
  const calibration = buildCommercialIntelligence(projects, outcomes, []).calibration;
  expect(calibration.linkedRealOutcomes).toBe(1);
  expect(calibration.sufficientSample).toBe(false);
});

it('an explicit missing project ID cannot fall back to an unrelated same-name project', async () => {
  const projects = await buildProjectIntelligence([record('one')], []);
  const outcomes = [{ projectId: 'deleted-project', project: projects[0].name, result: 'WON' as const, recordedAt: new Date().toISOString(), qa: false }];
  expect(buildCalibrationMetrics(projects, outcomes).matchedReviewed).toBe(0);
  expect(buildCommercialIntelligence(projects, outcomes, []).calibration.linkedRealOutcomes).toBe(0);
});

it('ambiguous legacy names cannot select one of two different locations', async () => {
  const projects = await buildProjectIntelligence([record('one'), record('two', 'Bridge Street Upgrade', 'Albany WA')], []);
  const outcomes = [{ project: 'Bridge Street Upgrade', result: 'WON' as const, recordedAt: new Date().toISOString(), qa: false }];
  expect(buildCalibrationMetrics(projects, outcomes).matchedReviewed).toBe(0);
  expect(buildCommercialIntelligence(projects, outcomes, []).calibration.linkedRealOutcomes).toBe(0);
});

it('rejects oversized public demo input before storage', async () => {
  const result = await saveDemoRequest({ name: 'N'.repeat(10000), company: 'QA Company', email: 'qa@example.test' });
  expect(result.ok).toBe(false);
  expect(store.add).not.toHaveBeenCalled();
});

it('rejects invalid report metadata at the API boundary', async () => {
  const response = await routes['POST /api/reports/history'][1]({ user, body: { headline: 'QA report', projectCount: -1, opportunityCount: 'NaN', generatedAt: 'not a date' } });
  expect(response.statusCode).toBe(400);
  expect(store.add).not.toHaveBeenCalled();
});

it('sorts report history across stored pages and discloses the bounded window', async () => {
  store.list.mockImplementation(async (_table, options) => options?.nextToken
    ? { items: [{ id: 'newest', ownerUserId: user.userId, generatedAt: '2026-09-16', headline: 'Newest' }], nextToken: undefined }
    : { items: [{ id: 'old', ownerUserId: user.userId, generatedAt: '2020-01-01', headline: 'Old' }], nextToken: 'page-two' });
  const result = await listReportHistory(user) as any;
  expect(result.reports[0].id).toBe('newest');
  expect(result.loaded).toBe(2);
  expect(result.truncated).toBe(false);
});
it('dates commercial events from matching source evidence rather than a fresh collection or unrelated record', async () => {
  const rows = [
    { ...record('old'), description: 'Scheduled shutdown', sourceObservedAt: '2020-01-01T00:00:00.000Z' },
    { ...record('new'), description: 'Permit approval', sourceObservedAt: '2026-09-01T00:00:00.000Z' },
  ];
  const projects = await buildProjectIntelligence(rows, []);
  const events = buildCommercialIntelligence(projects, [], []).events;
  expect(events.find(event => event.type === 'SHUTDOWN')?.detectedAt).toBe('2020-01-01T00:00:00.000Z');
});

it('does not manufacture an activity date for undated commercial events', async () => {
  const projects = await buildProjectIntelligence([{ ...record('undated'), description: 'Scheduled shutdown', sourceObservedAt: '' }], []);
  expect(buildCommercialIntelligence(projects, [], []).events.find(event => event.type === 'SHUTDOWN')?.detectedAt).toBe('');
});
