import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import { isDatabaseQuotaError } from './archive-storage';
import type { AutomationIdentity } from './automation-auth';

export const AUTOMATION_VERSION = 'production-automation-v1';
export const JOB_POLICIES = {
  'live-refresh': { workflow: 'live-source-refresh.yml', expectedMinutes: 15 },
  'source-health': { workflow: 'source-health.yml', expectedMinutes: 60 },
  'historical-backfill': {
    workflow: 'historical-backfill.yml',
    expectedMinutes: 15,
  },
  'source-validation': {
    workflow: 'source-validation.yml',
    expectedMinutes: 1440,
  },
  'deployment-qa': { workflow: 'deployment-qa.yml', expectedMinutes: 360 },
  e2e: { workflow: 'deployment-qa.yml', expectedMinutes: 360 },
  'workflow-watchdog': {
    workflow: 'workflow-watchdog.yml',
    expectedMinutes: 30,
  },
} as const;
export type AutomationJob = keyof typeof JOB_POLICIES;
export type AutomationResult = {
  status: 'SUCCESS' | 'FAILED' | 'DEGRADED' | 'COMPLETE';
  [key: string]: unknown;
};
type JobRecord = {
  job: AutomationJob;
  last_run: string;
  last_success_at: string | null;
  status: string;
  failure_count: number;
  run_id: string;
  run_attempt: string;
  commit_sha: string;
  details: Record<string, unknown>;
};
type RunRecord = {
  schemaVersion: 1;
  job: AutomationJob;
  runId: string;
  runAttempt: string;
  commitSha: string;
  sourceKey: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  result: AutomationResult | null;
};

async function singleton<T>(table: string) {
  const page = await db.list<T>(table, { limit: 2 });
  if (page.nextToken || page.items.length > 1)
    throw new Error('AUTOMATION_SINGLETON_CONFLICT:' + table);
  return page.items[0];
}
async function save(table: string, record: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > 180 * 1024)
    throw new Error('AUTOMATION_RECORD_TOO_LARGE');
  const old = await singleton<Record<string, unknown>>(table);
  const [ok] = old
    ? await db.update(table, [{ id: old.id, record }])
    : await db.add(table, [record]);
  if (!ok) throw new Error('AUTOMATION_PERSISTENCE_FAILED:' + table);
}

/** Additive managed-KV schema migration; existing records/cursors are never reset or reseeded. */
export async function ensureAutomationSchema() {
  const old = await singleton<{ version: number }>('automation_schema');
  if (old && old.version !== 1)
    throw new Error('AUTOMATION_SCHEMA_VERSION_UNSUPPORTED');
  if (!old)
    await save('automation_schema', {
      version: 1,
      applied_at: new Date().toISOString(),
      migration: '001-additive-automation',
      legacy_data_preserved: true,
    });
}
export async function readAutomationSchema() {
  return (
    (await singleton<{ version: number; applied_at: string }>(
      'automation_schema',
    )) || null
  );
}
export function classifyWorkflow(
  state:
    | {
        last_run: string | null;
        last_success_at: string | null;
        status: string;
      }
    | undefined,
  expectedMinutes: number,
  now = Date.now(),
): 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'STALE' {
  const at = Date.parse(state?.last_run || '');
  if (
    !state ||
    !Number.isFinite(at) ||
    at > now + 60000 ||
    now - at > (expectedMinutes * 2 + 10) * 60000
  )
    return 'STALE';
  if (
    ['FAILED', 'failure', 'timed_out', 'action_required'].includes(state.status)
  )
    return 'FAILED';
  if (!['SUCCESS', 'COMPLETE', 'success'].includes(state.status))
    return 'DEGRADED';
  const success = Date.parse(state.last_success_at || '');
  return Number.isFinite(success) &&
    success <= now + 60000 &&
    now - success <= (expectedMinutes * 2 + 10) * 60000
    ? 'HEALTHY'
    : 'STALE';
}
async function writeJob(
  identity: AutomationIdentity,
  job: AutomationJob,
  status: string,
  details: Record<string, unknown>,
  at: string,
) {
  const table = 'automation_job:' + job;
  const old = await singleton<JobRecord>(table);
  const success = ['SUCCESS', 'COMPLETE'].includes(status);
  // A late duplicate report must not overwrite a later run.
  if (
    old &&
    (BigInt(old.run_id) > BigInt(identity.runId) ||
      (old.run_id === identity.runId &&
        Number(old.run_attempt) > Number(identity.runAttempt)))
  )
    return;
  if (
    old?.run_id === identity.runId &&
    old.run_attempt === identity.runAttempt
  ) {
    if (old.status !== status) throw new Error('AUTOMATION_REPORT_CONFLICT');
    return;
  }
  await save(table, {
    job,
    last_run: at,
    last_success_at: success ? at : old?.last_success_at || null,
    status,
    failure_count: success ? 0 : (old?.failure_count || 0) + 1,
    run_id: identity.runId,
    run_attempt: identity.runAttempt,
    commit_sha: identity.commitSha,
    details,
  });
}

/** Shared GitHub concurrency serializes writers. A RUNNING receipt is never replayed automatically. */
export async function executeAutomationRun(
  identity: AutomationIdentity,
  job: AutomationJob,
  sourceKey: string,
  operation: () => Promise<AutomationResult>,
) {
  await ensureAutomationSchema();
  const key = createHash('sha256')
    .update(
      JSON.stringify([job, identity.runId, identity.runAttempt, sourceKey]),
    )
    .digest('hex');
  const table = 'automation_run:' + key;
  const existing = await singleton<RunRecord>(table);
  if (existing) {
    if (existing.status === 'RUNNING' || !existing.result)
      throw new Error('AUTOMATION_RUN_INCOMPLETE_REVIEW_REQUIRED');
    if (job !== 'source-health')
      await writeJob(
        identity,
        job,
        existing.result.status,
        existing.result,
        existing.completedAt!,
      );
    return { ...existing.result, replayed: true };
  }
  const startedAt = new Date().toISOString();
  const record: RunRecord = {
    schemaVersion: 1,
    job,
    ...identity,
    sourceKey,
    status: 'RUNNING',
    startedAt,
    completedAt: null,
    result: null,
  };
  await save(table, record);
  let result: AutomationResult;
  try {
    result = await operation();
  } catch (cause) {
    if (isDatabaseQuotaError(cause)) throw cause;
    result = {
      status: 'FAILED',
      failure_reason:
        cause instanceof Error
          ? cause.message.slice(0, 2000)
          : 'AUTOMATION_OPERATION_FAILED',
    };
  }
  if (!['SUCCESS', 'COMPLETE', 'FAILED', 'DEGRADED'].includes(result.status))
    throw new Error('AUTOMATION_INVALID_RESULT');
  const completedAt = new Date().toISOString();
  await save(table, { ...record, status: result.status, completedAt, result });
  // Health checks span one HTTP operation per source; only the aggregate report completes that job.
  if (job !== 'source-health')
    await writeJob(identity, job, result.status, result, completedAt);
  return { ...result, replayed: false };
}

export async function recordAutomationReport(
  identity: AutomationIdentity,
  job: AutomationJob,
  status: 'SUCCESS' | 'FAILED',
  details: Record<string, unknown>,
) {
  await ensureAutomationSchema();
  const key = createHash('sha256')
    .update(
      JSON.stringify(['report', job, identity.runId, identity.runAttempt]),
    )
    .digest('hex');
  const table = 'automation_report:' + key;
  const existing = await singleton<{
    status: string;
    phase: string;
    recorded_at: string;
  }>(table);
  if (existing) {
    if (existing.status !== status)
      throw new Error('AUTOMATION_REPORT_CONFLICT');
    if (existing.phase === 'COMPLETED') return;
  }
  const at = existing?.recorded_at || new Date().toISOString();
  if (!existing)
    await save(table, {
      ...identity,
      job,
      status,
      details,
      recorded_at: at,
      phase: 'PENDING',
    });
  await writeJob(identity, job, status, details, at);
  await save(table, {
    ...identity,
    job,
    status,
    details,
    recorded_at: at,
    phase: 'COMPLETED',
  });
}
export async function readAutomationJobs() {
  const result = [];
  for (const job of Object.keys(JOB_POLICIES) as AutomationJob[]) {
    const record = await singleton<JobRecord>('automation_job:' + job);
    result.push({
      job,
      workflow: JOB_POLICIES[job].workflow,
      expected_frequency_minutes: JOB_POLICIES[job].expectedMinutes,
      last_run: record?.last_run || null,
      last_success_at: record?.last_success_at || null,
      status: record?.status || 'NOT_RUN',
      failure_count: record?.failure_count ?? null,
      health: classifyWorkflow(record, JOB_POLICIES[job].expectedMinutes),
      commit_sha: record?.commit_sha || null,
      run_id: record?.run_id || null,
      details: record?.details || null,
    });
  }
  return result;
}

/** Normalize the external watchdog's actual GitHub observations against server-owned cadence. */
export function validateWatchdogReport(details: Record<string, unknown>) {
  if (!Array.isArray(details.observations) || details.observations.length > 10)
    throw new Error('INVALID_WATCHDOG_OBSERVATIONS');
  const observations = details.observations as Array<Record<string, unknown>>;
  const at = Date.now();
  return Object.entries(JOB_POLICIES)
    .filter(([job]) => job !== 'workflow-watchdog')
    .map(([job, policy]) => {
      const found = observations.find(
        (row) => row.workflow === policy.workflow,
      );
      const last = found?.lastRun as {
        created_at?: string;
        updated_at?: string;
        conclusion?: string;
        status?: string;
      } | null;
      const lastRun = last?.created_at || null;
      const lastSuccess =
        typeof found?.lastSuccessAt === 'string' ? found.lastSuccessAt : null;
      const state = {
        last_run: lastRun,
        last_success_at: lastSuccess,
        status: last?.conclusion || last?.status || 'NOT_RUN',
      };
      const count = found?.failureCount;
      return {
        job,
        workflow: policy.workflow,
        expected_frequency_minutes: policy.expectedMinutes,
        last_run: lastRun,
        last_success_at: lastSuccess,
        status: found?.error
          ? 'FAILED'
          : classifyWorkflow(state, policy.expectedMinutes, at),
        failure_count:
          Number.isSafeInteger(count) && Number(count) >= 0
            ? Number(count)
            : null,
      };
    });
}
