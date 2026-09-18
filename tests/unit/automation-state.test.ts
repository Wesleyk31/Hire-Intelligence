import { beforeEach, describe, expect, it, vi } from 'vitest';
const memory = vi.hoisted(
  () => new Map<string, Array<Record<string, unknown> & { id: string }>>(),
);
const faults = vi.hoisted(() => ({
  rejectJobWrite: false,
  rejectReportCompletion: false,
  loseReportCompletion: false,
}));
vi.mock('@appdeploy/sdk', () => ({
  db: {
    list: vi.fn(async (table: string) => ({
      items: structuredClone(memory.get(table) || []),
    })),
    add: vi.fn(async (table: string, rows: Record<string, unknown>[]) => {
      if (table.startsWith('automation_job:') && faults.rejectJobWrite) {
        faults.rejectJobWrite = false;
        return rows.map(() => null);
      }
      const data = memory.get(table) || [],
        ids = rows.map((row, i) => `${data.length + i}`);
      memory.set(table, [
        ...data,
        ...rows.map((row, i) => ({ ...structuredClone(row), id: ids[i] })),
      ]);
      return ids;
    }),
    update: vi.fn(
      async (
        table: string,
        rows: Array<{ id: string; record: Record<string, unknown> }>,
      ) => {
        if (table.startsWith('automation_job:') && faults.rejectJobWrite) {
          faults.rejectJobWrite = false;
          return rows.map(() => false);
        }
        const reportCompletion =
          table.startsWith('automation_report:') &&
          rows.some((row) => row.record.phase === 'COMPLETED');
        if (reportCompletion && faults.rejectReportCompletion) {
          faults.rejectReportCompletion = false;
          return rows.map(() => false);
        }
        const data = memory.get(table) || [];
        for (const row of rows) {
          const i = data.findIndex((d) => d.id === row.id);
          if (i < 0) return [false];
          data[i] = { ...structuredClone(row.record), id: row.id };
        }
        if (reportCompletion && faults.loseReportCompletion) {
          faults.loseReportCompletion = false;
          throw new Error('REPORT_RESPONSE_LOST_AFTER_COMMIT');
        }
        return rows.map(() => true);
      },
    ),
  },
}));
import {
  executeAutomationRun,
  ensureAutomationSchema,
  classifyWorkflow,
  recordAutomationReport,
  readAutomationJobs,
  JOB_POLICIES,
  validateWatchdogReport,
} from '../../backend/automation-state';
import { assertAutomationJob } from '../../backend/automation-auth';
const identity = {
  workflow: 'historical-backfill.yml',
  runId: '123',
  runAttempt: '1',
  commitSha: 'a'.repeat(40),
};
beforeEach(() => {
  memory.clear();
  faults.rejectJobWrite = false;
  faults.rejectReportCompletion = false;
  faults.loseReportCompletion = false;
});
describe('persistent automation receipts and safety', () => {
  it('uses additive idempotent migrations without altering legacy checkpoints', async () => {
    memory.set('backfill_cursors', [{ id: 'legacy', cursor: 400 }]);
    await ensureAutomationSchema();
    await ensureAutomationSchema();
    expect(memory.get('backfill_cursors')).toEqual([
      { id: 'legacy', cursor: 400 },
    ]);
    expect(memory.get('automation_schema')).toHaveLength(1);
  });
  it('does not repeat a completed workflow delivery', async () => {
    const run = vi.fn(async () => ({ status: 'SUCCESS', pages: 1 }));
    await executeAutomationRun(identity, 'historical-backfill', '', run);
    const replay = await executeAutomationRun(
      identity,
      'historical-backfill',
      '',
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(replay.status).toBe('SUCCESS');
    expect(replay.replayed).toBe(true);
  });
  it('records failed semantic result and does not manufacture a successful timestamp', async () => {
    await executeAutomationRun(
      identity,
      'historical-backfill',
      '',
      async () => ({ status: 'FAILED', failure_reason: 'HTTP_500' }),
    );
    const jobs = await readAutomationJobs();
    const job = jobs.find((j) => j.job === 'historical-backfill')!;
    expect(job.status).toBe('FAILED');
    expect(job.last_success_at).toBeNull();
    expect(job.failure_count).toBe(1);
  });
  it('failed QA report is persisted as failure', async () => {
    await recordAutomationReport(
      { ...identity, workflow: 'deployment-qa.yml' },
      'deployment-qa',
      'FAILED',
      { checks: { api: 'failure' } },
    );
    expect(
      (await readAutomationJobs()).find((j) => j.job === 'deployment-qa')
        ?.health,
    ).toBe('FAILED');
  });
  it('blocks unfinished runs instead of replaying potentially ambiguous writes', async () => {
    await executeAutomationRun(
      identity,
      'historical-backfill',
      '',
      async () => ({ status: 'SUCCESS' }),
    );
    const table = [...memory.keys()].find((k) =>
      k.startsWith('automation_run:'),
    )!;
    memory.set(table, [{ ...memory.get(table)![0], status: 'RUNNING' }]);
    await expect(
      executeAutomationRun(identity, 'historical-backfill', '', async () => ({
        status: 'SUCCESS',
      })),
    ).rejects.toThrow('AUTOMATION_RUN_INCOMPLETE');
  });

  it('preserves the newer workflow attempt when an older attempt reports late', async () => {
    await recordAutomationReport(
      { ...identity, runAttempt: '2' },
      'deployment-qa',
      'FAILED',
      { reason: 'Latest attempt failed' },
    );
    const newer = structuredClone(memory.get('automation_job:deployment-qa'));
    await recordAutomationReport(identity, 'deployment-qa', 'SUCCESS', {
      reason: 'Older attempt succeeded',
    });
    expect(memory.get('automation_job:deployment-qa')).toEqual(newer);
    expect(
      (await readAutomationJobs()).find((job) => job.job === 'deployment-qa'),
    ).toMatchObject({
      status: 'FAILED',
      failure_count: 1,
      last_success_at: null,
    });
  });

  it('preserves a newer run when an older run has a greater retry-attempt number', async () => {
    await recordAutomationReport(
      { ...identity, runId: '124' },
      'deployment-qa',
      'SUCCESS',
      {},
    );
    const newer = structuredClone(memory.get('automation_job:deployment-qa'));
    await recordAutomationReport(
      { ...identity, runAttempt: '9' },
      'deployment-qa',
      'FAILED',
      {},
    );
    expect(memory.get('automation_job:deployment-qa')).toEqual(newer);
  });

  it('retries a rejected report completion without incrementing the job failure count twice', async () => {
    faults.rejectReportCompletion = true;
    await expect(
      recordAutomationReport(identity, 'deployment-qa', 'FAILED', {
        check: 'API',
      }),
    ).rejects.toThrow('AUTOMATION_PERSISTENCE_FAILED');
    const pendingTable = [...memory.keys()].find((table) =>
      table.startsWith('automation_report:'),
    )!;
    const first = structuredClone(memory.get('automation_job:deployment-qa'));
    expect(memory.get(pendingTable)?.[0].phase).toBe('PENDING');
    await recordAutomationReport(identity, 'deployment-qa', 'FAILED', {
      check: 'API',
    });
    expect(memory.get(pendingTable)?.[0].phase).toBe('COMPLETED');
    expect(memory.get('automation_job:deployment-qa')).toEqual(first);
    expect(
      (await readAutomationJobs()).find((job) => job.job === 'deployment-qa')
        ?.failure_count,
    ).toBe(1);
  });

  it('repairs a pending report after the job summary write was rejected', async () => {
    faults.rejectJobWrite = true;
    await expect(
      recordAutomationReport(identity, 'deployment-qa', 'FAILED', {}),
    ).rejects.toThrow('AUTOMATION_PERSISTENCE_FAILED');
    const table = [...memory.keys()].find((key) =>
      key.startsWith('automation_report:'),
    )!;
    const startedAt = memory.get(table)?.[0].recorded_at;
    expect(memory.get('automation_job:deployment-qa')).toBeUndefined();
    await recordAutomationReport(identity, 'deployment-qa', 'FAILED', {});
    expect(memory.get(table)?.[0]).toMatchObject({
      phase: 'COMPLETED',
      recorded_at: startedAt,
    });
    expect(
      (await readAutomationJobs()).find((job) => job.job === 'deployment-qa'),
    ).toMatchObject({
      status: 'FAILED',
      last_run: startedAt,
      failure_count: 1,
    });
  });

  it('replays an acknowledged report whose final response was lost without changing failure accounting', async () => {
    faults.loseReportCompletion = true;
    await expect(
      recordAutomationReport(identity, 'deployment-qa', 'FAILED', {}),
    ).rejects.toThrow('REPORT_RESPONSE_LOST_AFTER_COMMIT');
    const persisted = structuredClone(
      memory.get('automation_job:deployment-qa'),
    );
    await recordAutomationReport(identity, 'deployment-qa', 'FAILED', {});
    expect(memory.get('automation_job:deployment-qa')).toEqual(persisted);
    expect(
      (await readAutomationJobs()).find((job) => job.job === 'deployment-qa')
        ?.failure_count,
    ).toBe(1);
  });

  it('repairs job health from the saved operation outcome without repeating ingestion', async () => {
    let ingestions = 0;
    const ingest = async () => {
      ingestions++;
      return { status: 'SUCCESS' as const, evidence_processed: 7 };
    };
    faults.rejectJobWrite = true;
    await expect(
      executeAutomationRun(identity, 'historical-backfill', '', ingest),
    ).rejects.toThrow('AUTOMATION_PERSISTENCE_FAILED');
    expect(memory.get('automation_job:historical-backfill')).toBeUndefined();
    const result = await executeAutomationRun(
      identity,
      'historical-backfill',
      '',
      ingest,
    );
    expect(result).toMatchObject({
      status: 'SUCCESS',
      evidence_processed: 7,
      replayed: true,
    });
    expect(ingestions).toBe(1);
    expect(
      (await readAutomationJobs()).find(
        (job) => job.job === 'historical-backfill',
      ),
    ).toMatchObject({
      status: 'SUCCESS',
      failure_count: 0,
      details: { evidence_processed: 7 },
    });
  });

  it('rejects a conflicting repeat report without rewriting the first result', async () => {
    await recordAutomationReport(identity, 'deployment-qa', 'FAILED', {});
    await expect(
      recordAutomationReport(identity, 'deployment-qa', 'SUCCESS', {}),
    ).rejects.toThrow('AUTOMATION_REPORT_CONFLICT');
    expect(
      (await readAutomationJobs()).find((job) => job.job === 'deployment-qa'),
    ).toMatchObject({ status: 'FAILED', failure_count: 1 });
  });

  it('authorizes each job using the workflow identity selected by its scheduling policy', () => {
    for (const [job, policy] of Object.entries(JOB_POLICIES)) {
      const principal = { ...identity, workflow: policy.workflow };
      expect(() =>
        assertAutomationJob(principal, { ...identity, job }),
      ).not.toThrow();
    }
  });
});
describe('watchdog truth from actual timestamps', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  it('marks missing scheduled jobs stale', () =>
    expect(classifyWorkflow(undefined, 15, now)).toBe('STALE'));
  it('does not count recent failures as healthy', () =>
    expect(
      classifyWorkflow(
        {
          last_run: '2026-09-18T11:55:00Z',
          last_success_at: '2026-09-18T11:40:00Z',
          status: 'FAILED',
        },
        15,
        now,
      ),
    ).toBe('FAILED'));
  it('marks old successes stale', () =>
    expect(
      classifyWorkflow(
        {
          last_run: '2026-09-17T11:55:00Z',
          last_success_at: '2026-09-17T11:55:00Z',
          status: 'SUCCESS',
        },
        15,
        now,
      ),
    ).toBe('STALE'));
  it('accepts a timely successful job', () =>
    expect(
      classifyWorkflow(
        {
          last_run: '2026-09-18T11:55:00Z',
          last_success_at: '2026-09-18T11:55:00Z',
          status: 'SUCCESS',
        },
        15,
        now,
      ),
    ).toBe('HEALTHY'));
  it('rejects a future success timestamp despite a timely last-run timestamp', () =>
    expect(
      classifyWorkflow(
        {
          last_run: '2026-09-18T11:55:00Z',
          last_success_at: '2026-09-18T13:00:00Z',
          status: 'SUCCESS',
        },
        15,
        now,
      ),
    ).toBe('STALE'));
  it('does not hide a future successful timestamp received from the external watchdog', () => {
    const recent = new Date().toISOString(),
      future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const states = validateWatchdogReport({
      observations: [
        {
          workflow: 'live-source-refresh.yml',
          lastRun: { created_at: recent, conclusion: 'success' },
          lastSuccessAt: future,
          failureCount: 0,
        },
      ],
    });
    expect(states.find((state) => state.job === 'live-refresh')).toMatchObject({
      status: 'STALE',
      last_success_at: future,
    });
  });
});
