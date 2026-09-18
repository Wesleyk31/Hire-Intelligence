import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@appdeploy/sdk', () => ({
  db: { list: vi.fn(async () => ({ items: [] })) },
  json: (body: unknown, status = 200) => ({ body, statusCode: status }),
  error: (body: unknown, status = 400) => ({ body, statusCode: status }),
}));
vi.mock('../../backend/automation-auth', () => ({
  requireAutomation: vi.fn(),
  automationIdentity: () => ({
    workflow: 'deployment-qa.yml',
    runId: '42',
    runAttempt: '1',
    commitSha: 'a'.repeat(40),
  }),
  assertAutomationJob: vi.fn(),
}));
vi.mock('../../backend/automation-state', () => ({
  AUTOMATION_VERSION: 'production-automation-v1',
  recordAutomationReport: vi.fn(),
  validateWatchdogReport: vi.fn(),
  readAutomationJobs: vi.fn(async () => []),
  readAutomationSchema: vi.fn(async () => null),
}));
import {
  createAutomationRoutes,
  validateAutomationReport,
} from '../../backend/automation-api';
import { recordAutomationReport } from '../../backend/automation-state';
import { requireAutomation } from '../../backend/automation-auth';
import { db } from '@appdeploy/sdk';
const routes = createAutomationRoutes({
  sources: [],
  liveSources: [],
  backfillSources: [],
  collect: vi.fn(),
  runSource: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.list).mockImplementation(async () => ({ items: [] }));
});
it('protects every automation API with verified workflow identity', () => {
  for (const route of Object.values(routes))
    expect(route[0]).toBe(requireAutomation);
});
it.each(['live', 'archive'])(
  'loads actual provenance from %s-only stored evidence',
  async (origin) => {
    const event = {
      id: 'row',
      sourceKey: 'qa-source',
      externalId: 'fixture',
      project: 'Synthetic QA fixture',
      description: 'Proposed concept',
      company: '',
      location: 'WA',
      observedAt: '2026-09-01T00:00:00Z',
      provenance: 'https://example.test/evidence',
      evidenceType: 'EXPLICIT',
    };
    vi.mocked(db.list).mockImplementation(
      async (table: string) =>
        ({
          items:
            table === 'opportunities' && origin === 'live'
              ? [event]
              : table === 'evidence_pages' && origin === 'archive'
                ? [{ id: 'page', events: [event] }]
                : [],
        }) as never,
    );
    const response = await routes['GET /api/automation/smoke'].at(-1)!(
      {} as never,
    );
    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        evidenceReferences: [{ provenance: 'https://example.test/evidence' }],
        dataStatus: 'AVAILABLE',
        errors: [],
      },
    });
  },
);
it('rejects caller-supplied success when a required QA check failed', () => {
  expect(() =>
    validateAutomationReport('deployment-qa', 'SUCCESS', {
      checks: { static: 'success', api: 'failure', browser: 'success' },
    }),
  ).toThrow();
});
it('rejects aggregate source success when checks failed or were omitted', () => {
  expect(() =>
    validateAutomationReport('source-health', 'SUCCESS', {
      checked: 1,
      failed: 1,
      outcomes: [{ source_id: 'a', status: 'FAILED' }],
    }),
  ).toThrow();
  expect(() =>
    validateAutomationReport('source-health', 'SUCCESS', {
      checked: 0,
      failed: 0,
      outcomes: [],
    }),
  ).toThrow();
});
it('acknowledges storing a failed result without turning that result into success', async () => {
  const handler = routes['POST /api/automation/report'].at(-1)!;
  const response = await handler({
    body: {
      job: 'deployment-qa',
      runId: '42',
      runAttempt: '1',
      commitSha: 'a'.repeat(40),
      status: 'FAILED',
      details: { checks: { static: 'failure' } },
    },
  } as never);
  expect(response).toMatchObject({
    statusCode: 200,
    body: { status: 'SUCCESS', reported_status: 'FAILED' },
  });
  expect(recordAutomationReport).toHaveBeenCalledWith(
    expect.anything(),
    'deployment-qa',
    'FAILED',
    expect.anything(),
  );
});
