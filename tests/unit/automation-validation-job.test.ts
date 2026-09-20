import { beforeEach, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => new Map<string, any[]>());
const faults = vi.hoisted(() => ({ rejectDecisionWrite: false }));
vi.mock('@appdeploy/sdk', () => ({
  db: {
    list: async (table: string) => ({
      items: structuredClone(memory.get(table) || []),
    }),
    add: async (table: string, rows: any[]) => {
      const data = memory.get(table) || [];
      const ids = rows.map((_, index) => String(data.length + index + 1));
      memory.set(table, [
        ...data,
        ...rows.map((row, index) => ({
          ...structuredClone(row),
          id: ids[index],
        })),
      ]);
      return ids;
    },
    update: async (table: string, rows: any[]) =>
      rows.map(({ id, record }) => {
        if (
          faults.rejectDecisionWrite &&
          table.startsWith('automation_source:') &&
          record.status === 'REVIEW_REQUIRED'
        )
          return false;
        const data = memory.get(table) || [];
        const index = data.findIndex((row) => row.id === id);
        if (index < 0) return false;
        data[index] = { ...structuredClone(record), id };
        return true;
      }),
  },
  json: (body: unknown, statusCode = 200) => ({ body, statusCode }),
  error: (body: unknown, statusCode = 400) => ({ body, statusCode }),
}));
vi.mock('../../backend/automation-auth', () => ({
  requireAutomation: vi.fn(),
  assertAutomationJob: vi.fn(),
  automationIdentity: () => ({
    workflow: 'source-validation.yml',
    runId: '42',
    runAttempt: '1',
    commitSha: 'a'.repeat(40),
  }),
}));
vi.mock('../../backend/source-discovery', () => ({
  runSourceDiscovery: vi.fn(),
  getSourceDiscoveryStatus: vi.fn(),
}));
vi.mock('../../backend/automation-probes', () => ({
  probeCandidate: vi.fn(),
  probeSource: vi.fn(),
}));
import { createAutomationRoutes } from '../../backend/automation-api';
import {
  discoverSourceCandidates,
  activateVerifiedCandidate,
} from '../../backend/source-admission';
import { runSourceDiscovery } from '../../backend/source-discovery';
import { probeCandidate } from '../../backend/automation-probes';

const logan = 'logan-development-applications';
const observed = {
  recordCount: 20,
  schemaVersion: 'publisher-declared-schema',
  lastRecordTimestamp: null,
  checks: {
    accessibility: 'PASS',
    response_type: 'PASS',
    schema: 'PASS',
    parser: 'FAIL',
    authentication: 'PASS',
    pagination: 'PASS',
    freshness: 'NOT_VERIFIED',
  },
  requiredFields: 'PASS',
  rateLimits: 'NOT_VERIFIED',
  reproducibility: 'NOT_VERIFIED',
} as const;
const routes = createAutomationRoutes({
  sources: [],
  liveSources: [],
  backfillSources: [],
  collect: vi.fn(),
  runSource: vi.fn(),
});
const run = () =>
  routes['POST /api/automation/run'].at(-1)!({
    body: { job: 'source-validation' },
  } as never);
beforeEach(() => {
  memory.clear();
  faults.rejectDecisionWrite = false;
  vi.clearAllMocks();
  vi.mocked(runSourceDiscovery).mockResolvedValue({
    status: 'SUCCESS',
  } as never);
  vi.mocked(probeCandidate).mockImplementation(async (contract) => ({
    ...observed,
    checks: {
      ...observed.checks,
      parser: contract.key === logan ? 'FAIL' : 'PASS',
    },
  }));
});

it('returns successful execution for a safely held Logan-shaped quality rejection without admitting either candidate', async () => {
  const result = await run();
  expect(result).toMatchObject({
    statusCode: 200,
    body: {
      status: 'SUCCESS',
      status_basis: 'VALIDATION_EXECUTION_AND_PERSISTED_DECISIONS',
      activation: 'REVIEW_REQUIRED',
      validation_summary: {
        candidates: 2,
        completed: 2,
        failed: 0,
        not_run: 0,
        held: 2,
        activated: 0,
      },
      candidates: [
        {
          source_id: logan,
          status: 'REVIEW_REQUIRED',
          validation_execution: 'COMPLETED',
          collection_blocked: true,
          checks: { parser: 'FAIL' },
        },
        { status: 'REVIEW_REQUIRED', collection_blocked: true },
      ],
    },
  });
  const saved = memory.get('automation_source:' + logan)![0];
  expect(saved.collection_hold_reason).toContain(
    'TECHNICAL_CHECK_NOT_PASSED:parser',
  );
  expect(saved.checks.parser).toBe('FAIL');
  expect(memory.get('automation_job:source-validation')![0]).toMatchObject({
    status: 'SUCCESS',
    details: { validation_summary: { held: 2, activated: 0 } },
  });
  await expect(activateVerifiedCandidate(logan)).rejects.toThrow(
    'SOURCE_ADMISSION_NOT_VERIFIED',
  );
});
it('returns FAILED/503 when a current probe throws a provider failure', async () => {
  vi.mocked(probeCandidate).mockRejectedValue(new Error('HTTP_503'));
  expect(await run()).toMatchObject({
    statusCode: 503,
    body: {
      status: 'FAILED',
      validation_summary: { failed: 2 },
      candidates: [
        {
          validation_execution: 'FAILED',
          failure_reason: 'HTTP_503',
          collection_blocked: true,
        },
        { validation_execution: 'FAILED' },
      ],
    },
  });
});
it.each(['accessibility', 'response_type', 'authentication'] as const)(
  'keeps an observed %s failure operationally failed',
  async (check) => {
    vi.mocked(probeCandidate).mockResolvedValue({
      ...observed,
      checks: { ...observed.checks, [check]: 'FAIL' },
    });
    expect(await run()).toMatchObject({
      statusCode: 503,
      body: { status: 'FAILED', validation_summary: { failed: 2 } },
    });
  },
);
it('keeps failed discovery operationally failed even when candidate decisions complete', async () => {
  vi.mocked(runSourceDiscovery).mockResolvedValue({
    status: 'FAILED',
  } as never);
  expect(await run()).toMatchObject({
    statusCode: 503,
    body: {
      status: 'FAILED',
      discovery: { status: 'FAILED' },
      validation_summary: { completed: 2 },
    },
  });
});
it('keeps failed decision persistence operationally failed', async () => {
  faults.rejectDecisionWrite = true;
  const result = await run();
  expect(result).toMatchObject({ statusCode: 503, body: { status: 'FAILED' } });
  expect(result.body.failure_reason).toContain('SOURCE_REGISTRY_WRITE_FAILED');
});
it.each(['disabled', 'changed-contract'])(
  'does not count a %s candidate with stale passing checks as a current completed validation',
  async (mode) => {
    await discoverSourceCandidates();
    const saved = memory.get('automation_source:' + logan)![0];
    saved.checks = { ...observed.checks, parser: 'PASS' };
    if (mode === 'disabled') saved.status = 'DISABLED';
    else saved.endpoint = 'https://unexpected.test/changed';
    expect(await run()).toMatchObject({
      statusCode: 503,
      body: {
        status: 'FAILED',
        validation_summary: { completed: 1, not_run: 1 },
        candidates: [
          {
            source_id: logan,
            validation_execution: 'NOT_RUN',
            collection_blocked: true,
          },
          { validation_execution: 'COMPLETED' },
        ],
      },
    });
  },
);
