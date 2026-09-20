import { db, json, error, type RouterRoutes } from '@appdeploy/sdk';
import type { SourceDef } from './index';
import {
  requireAutomation,
  automationIdentity,
  assertAutomationJob,
} from './automation-auth';
import {
  AUTOMATION_VERSION,
  executeAutomationRun,
  recordAutomationReport,
  readAutomationJobs,
  readAutomationSchema,
  validateWatchdogReport,
  type AutomationJob,
} from './automation-state';
import {
  initialSourceRecord,
  readSourceRegistry,
  checkSourceHealth,
  isSourceCollectionAllowed,
  recordSourceOutcome,
} from './source-automation';
import {
  discoverSourceCandidates,
  validateSourceCandidate,
  readSourceCandidates,
} from './source-admission';
import {
  runSourceDiscovery,
  getSourceDiscoveryStatus,
} from './source-discovery';
import { runBackfillBatch, getBackfillAutomationMetrics } from './backfill';
import { runRefreshSlice } from './refresh-scheduler';
import { isDatabaseQuotaError } from './archive-storage';
import { probeSource, probeCandidate } from './automation-probes';
import {
  buildProjectIntelligence,
  type IntelligenceEvidence,
} from './intelligence';

type Dependencies = {
  sources: SourceDef[];
  liveSources: SourceDef[];
  backfillSources: SourceDef[];
  collect: (source: SourceDef) => Promise<{
    recordsFetched: number;
    opportunities: Array<{ sourceObservedAt?: string }>;
  }>;
  runSource: (source: SourceDef) => Promise<{
    status: string;
    sourceKey: string;
    recordsFetched: number;
    message: string;
    durationMs?: number;
  }>;
};
const reportJobs = [
  'source-health',
  'deployment-qa',
  'e2e',
  'workflow-watchdog',
];
const runJobs = [
  'live-refresh',
  'historical-backfill',
  'source-health',
  'source-validation',
];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_REQUEST');
  return value as Record<string, unknown>;
}
export function validateAutomationReport(
  job: string,
  status: string,
  details: Record<string, unknown>,
) {
  if (
    !reportJobs.includes(job) ||
    !['SUCCESS', 'FAILED'].includes(status) ||
    Buffer.byteLength(JSON.stringify(details)) > 120 * 1024
  )
    throw new Error('INVALID_REPORT');
  if (status === 'FAILED') return details;
  if (job === 'deployment-qa') {
    const checks = object(details.checks);
    if (['static', 'api', 'browser'].some((key) => checks[key] !== 'success'))
      throw new Error('QA_CHECKS_NOT_PASSED');
  }
  if (job === 'e2e' && object(details.checks).browser !== 'success')
    throw new Error('E2E_CHECK_NOT_PASSED');
  if (job === 'source-health') {
    const rows = details.outcomes;
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      rows.length !== details.checked ||
      new Set(rows.map((row) => object(row).source_id)).size !== rows.length ||
      details.failed !== 0 ||
      rows.some((row) => object(row).status !== 'SUCCESS')
    )
      throw new Error('SOURCE_HEALTH_CHECKS_NOT_PASSED');
  }
  return details;
}
export function createAutomationRoutes(deps: Dependencies): RouterRoutes {
  const configured = [
    ...new Map(deps.sources.map((source) => [source.key, source])).values(),
  ];
  async function registry(
    backfillMetrics?: Awaited<ReturnType<typeof getBackfillAutomationMetrics>>,
  ) {
    const stored = await readSourceRegistry(configured);
    const metrics =
      backfillMetrics ??
      (await getBackfillAutomationMetrics(deps.backfillSources));
    return configured.map((source) => {
      const backfill = metrics.sources.find(
        (row) => row.source_id === source.key,
      );
      return {
        ...(stored.find((row) => row.source_id === source.key) ||
          initialSourceRecord(source)),
        observed: stored.some((row) => row.source_id === source.key),
        backfill_checkpoint: backfill?.checkpoint ?? null,
        backfill_complete: backfill?.completed ?? null,
        records_processed: backfill?.records_processed ?? null,
        evidence_processed: backfill?.evidence_processed ?? null,
        backfill_metrics_basis: metrics.metrics_basis,
      };
    });
  }
  async function allowed(sources: SourceDef[]) {
    const rows: SourceDef[] = [];
    for (const source of sources)
      if (await isSourceCollectionAllowed(source)) rows.push(source);
    return rows;
  }
  return {
    'GET /api/automation/registry': [
      requireAutomation,
      async () => json({ sources: await registry() }),
    ],
    'GET /api/automation/health': [
      requireAutomation,
      async () => {
        const backfill = await getBackfillAutomationMetrics(
          deps.backfillSources,
        );
        const sources = await registry(backfill);
        const candidates = await readSourceCandidates(),
          discovery = await getSourceDiscoveryStatus();
        const observed = [
          ...sources.filter((source) => source.observed),
          ...candidates,
        ];
        return json({
          schemaVersion: 1,
          automationVersion: AUTOMATION_VERSION,
          migration: await readAutomationSchema(),
          jobs: await readAutomationJobs(),
          sources,
          source_counts: Object.fromEntries(
            [
              'ACTIVE',
              'DEGRADED',
              'DISABLED',
              'CANDIDATE',
              'VALIDATING',
              'VERIFIED',
              'REVIEW_REQUIRED',
              'REJECTED',
            ].map((status) => [
              status,
              observed.filter((s) => s.status === status).length,
            ]),
          ),
          source_count_basis: 'PERSISTED_REGISTRY_ONLY',
          unobserved_sources: sources.filter((source) => !source.observed)
            .length,
          backfill,
          candidates,
          discovery,
        });
      },
    ],
    'GET /api/automation/smoke': [
      requireAutomation,
      async () => {
        const opportunities = await db.list<Record<string, unknown>>(
          'opportunities',
          { limit: 20 },
        );
        const archive = await db.list<{ events?: Record<string, unknown>[] }>(
          'evidence_pages',
          { limit: 1 },
        );
        const archiveEvents = archive.items
          .flatMap((page) => (Array.isArray(page.events) ? page.events : []))
          .slice(0, 20);
        const evidenceReferences = [
          ...opportunities.items,
          ...archiveEvents,
        ].map((row) => ({
          sourceKey: row.sourceKey,
          externalId: row.externalId,
          provenance: row.provenance,
          sourceUrl: row.sourceUrl,
        }));
        const sampled = [...opportunities.items, ...archiveEvents].map(
          (row) => ({
            ...row,
            value: typeof row.value === 'string' ? row.value : '',
          }),
        );
        const projects = await buildProjectIntelligence(
          sampled as IntelligenceEvidence[],
          deps.sources,
        );
        const errors = archive.items.some((page) => !Array.isArray(page.events))
          ? ['INVALID_ARCHIVE_PAGE']
          : [];
        return json({
          opportunities: projects,
          evidenceReferences,
          sources: await registry(),
          errors,
          dataStatus:
            projects.length || evidenceReferences.length
              ? 'AVAILABLE'
              : 'EMPTY',
          coverage: {
            bounded: true,
            opportunity_limit: 20,
            archive_page_limit: 1,
            archive_record_limit: 20,
            total_evidence: 'NOT_VERIFIED',
            runtime_error_history: 'NOT_VERIFIED',
          },
        });
      },
    ],
    'POST /api/automation/run': [
      requireAutomation,
      async (ctx) => {
        const body = object(ctx.body);
        const identity = automationIdentity(ctx);
        assertAutomationJob(identity, body);
        if (typeof body.job !== 'string' || !runJobs.includes(body.job))
          return error('Unknown automation operation', 400);
        const job = body.job as AutomationJob;
        const sourceKey =
          typeof body.sourceKey === 'string' ? body.sourceKey : '';
        if (
          job === 'source-health' &&
          !configured.some((source) => source.key === sourceKey)
        )
          return error('Unknown configured source', 400);
        if (job !== 'source-health' && sourceKey)
          return error('Source override not permitted', 400);
        const result = await executeAutomationRun(
          identity,
          job,
          sourceKey,
          async () => {
            if (job === 'source-health') {
              const source = configured.find((row) => row.key === sourceKey)!;
              const row = await checkSourceHealth(source, (s) =>
                probeSource(s, deps.collect),
              );
              return {
                status:
                  row.failure_reason ||
                  row.collection_blocked ||
                  row.status !== 'ACTIVE'
                    ? 'FAILED'
                    : 'SUCCESS',
                source_id: sourceKey,
                source_status: row.status,
                checks: row.checks,
                failure_reason: row.failure_reason,
              };
            }
            if (job === 'live-refresh') {
              const sources = await allowed(deps.liveSources);
              if (!sources.length)
                return {
                  status: 'FAILED',
                  failure_reason: 'NO_COLLECTABLE_SOURCES',
                };
              const result = await runRefreshSlice(sources, async (source) => {
                let state: Awaited<ReturnType<Dependencies['runSource']>>;
                try {
                  state = await deps.runSource(source);
                } catch (cause) {
                  if (isDatabaseQuotaError(cause)) throw cause;
                  state = {
                    sourceKey: source.key,
                    status: 'FAILED',
                    message:
                      cause instanceof Error ? cause.message : 'SOURCE_FAILED',
                    recordsFetched: 0,
                  };
                }
                await recordSourceOutcome(source, {
                  ok: state.status === 'SUCCESS',
                  failureReason:
                    state.status === 'SUCCESS' ? undefined : state.message,
                  responseLatencyMs: state.durationMs,
                  recordCount: state.recordsFetched,
                });
                return state;
              });
              return {
                ...result,
                status: result.states.every(
                  (state) => state.status === 'SUCCESS',
                )
                  ? 'SUCCESS'
                  : 'FAILED',
              };
            }
            if (job === 'historical-backfill') {
              const sources = await allowed(deps.backfillSources);
              if (!sources.length)
                return {
                  status: 'FAILED',
                  failure_reason: 'NO_COLLECTABLE_SOURCES',
                };
              const result = await runBackfillBatch(sources);
              const blocked = deps.backfillSources
                .filter(
                  (source) =>
                    !sources.some((allowed) => allowed.key === source.key),
                )
                .map((source) => source.key);
              return {
                status:
                  result.run.status === 'COMPLETE' && blocked.length
                    ? 'DEGRADED'
                    : result.run.status,
                run: result.run,
                scope: 'CURRENTLY_COLLECTABLE_SOURCES',
                held_sources: blocked,
                metrics_basis: 'ACKNOWLEDGED_RUNS_SINCE_AUTOMATION_ROLLOUT',
              };
            }
            const discovery = await runSourceDiscovery();
            const candidates = await discoverSourceCandidates();
            const outcomes = [];
            for (const candidate of candidates) {
              const checked = await validateSourceCandidate(
                candidate.source_id,
                probeCandidate,
              );
              outcomes.push({
                source_id: checked.source_id,
                status: checked.status,
                checks: checked.checks,
                review: checked.legal_review_status,
                failure_reason: checked.failure_reason,
              });
            }
            return {
              status:
                discovery.status === 'FAILED' ||
                outcomes.some(
                  (row) =>
                    !row.checks ||
                    row.checks.accessibility !== 'PASS' ||
                    Object.values(row.checks).includes('FAIL'),
                )
                  ? 'FAILED'
                  : 'SUCCESS',
              discovery,
              candidates: outcomes,
              activation: 'REVIEW_REQUIRED',
            };
          },
        );
        return json(
          result,
          ['SUCCESS', 'COMPLETE'].includes(result.status) ? 200 : 503,
        );
      },
    ],
    'POST /api/automation/report': [
      requireAutomation,
      async (ctx) => {
        const body = object(ctx.body);
        const identity = automationIdentity(ctx);
        assertAutomationJob(identity, body);
        const job = String(body.job),
          status = String(body.status);
        let details = object(body.details);
        try {
          details = validateAutomationReport(job, status, details);
        } catch (cause) {
          return error(
            cause instanceof Error ? cause.message : 'INVALID_REPORT',
            400,
          );
        }
        if (job === 'workflow-watchdog') {
          const observations = validateWatchdogReport(details);
          if (
            status === 'SUCCESS' &&
            observations.some((row) => row.status !== 'HEALTHY')
          )
            return error('WATCHDOG_OBSERVATIONS_NOT_HEALTHY', 400);
          details = { ...details, normalized_observations: observations };
        }
        if (job === 'source-health' && status === 'SUCCESS') {
          const expected = (await registry())
            .filter((row) => ['ACTIVE', 'DEGRADED'].includes(row.status))
            .map((row) => row.source_id);
          const checked = (
            details.outcomes as Array<{ source_id: string }>
          ).map((row) => row.source_id);
          if (
            expected.length !== checked.length ||
            expected.some((key) => !checked.includes(key))
          )
            return error('SOURCE_HEALTH_COVERAGE_INCOMPLETE', 400);
        }
        await recordAutomationReport(
          identity,
          job as AutomationJob,
          status as 'SUCCESS' | 'FAILED',
          details,
        );
        return json({ status: 'SUCCESS', reported_status: status });
      },
    ],
  };
}
