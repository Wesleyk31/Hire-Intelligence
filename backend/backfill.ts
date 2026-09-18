import {
  persistArchiveBatch,
  isDatabaseQuotaError,
  prepareArchiveIdentityIndex,
} from './archive-storage';
import { randomUUID } from 'node:crypto';
import { beginPull, finishPull } from './pull-receipts';
import { db } from '@appdeploy/sdk';
import {
  collectBackfillPage,
  prepareBackfillContext,
  normalizeEvidence,
  type BackfillSource,
  type BackfillContext,
  type Evidence,
} from './backfill-fetch';

type Cursor = {
  sourceKey: string;
  cursor: number;
  processed: number;
  completed: boolean;
  lastRun: string;
  lastError: string;
  nextUrl?: string;
  context?: BackfillContext;
  retryCount?: number;
  lastRunMetrics?: BackfillRun;
  automationTotals?: { pages: number; evidence: number; duplicates: number };
};
type Control = {
  nextIndex: number;
  runs: number;
  lastSource: string;
  lastRun: string;
  lastRunMetrics?: BackfillRun;
};

type Checkpoint = {
  cursor: number;
  next_url: string;
  context: BackfillContext;
};
export type BackfillRun = {
  run_id: string;
  source_id: string | null;
  status: 'SUCCESS' | 'FAILED' | 'COMPLETE';
  checkpoint_before: Checkpoint | null;
  checkpoint_after: Checkpoint | null;
  pages_processed: number;
  records_processed: number;
  evidence_processed: number;
  duplicates_skipped: number;
  started_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  source_completed: boolean;
  retry_count: number;
  maintenance?: 'ARCHIVE_IDENTITY_INDEX';
};
const checkpointOf = (cursor: Cursor): Checkpoint => ({
  cursor: cursor.cursor,
  next_url: cursor.nextUrl || '',
  context: cursor.context || {},
});

async function saveCursor(cursor: Cursor) {
  const page = await db.list<Cursor>('backfill_cursors', { limit: 100 });
  const current = page.items.find(
    (item) => item.sourceKey === cursor.sourceKey,
  );
  const [saved] = current
    ? await db.update('backfill_cursors', [
        { id: current.id, record: { ...current, ...cursor } },
      ])
    : await db.add('backfill_cursors', [{ ...cursor }]);
  if (!saved) throw new Error('BACKFILL_CURSOR_SAVE_FAILED');
}

async function saveControl(control: Control) {
  const page = await db.list<Control>('backfill_control', { limit: 1 });
  const [saved] = page.items.length
    ? await db.update('backfill_control', [
        { id: page.items[0].id, record: { ...page.items[0], ...control } },
      ])
    : await db.add('backfill_control', [{ ...control }]);
  if (!saved) throw new Error('BACKFILL_CONTROL_SAVE_FAILED');
}

export async function getBackfillStatus(sources: BackfillSource[]) {
  const cursors = (
    await db.list<Cursor>('backfill_cursors', { limit: 100 })
  ).items.filter((cursor) =>
    sources.some((source) => source.key === cursor.sourceKey),
  );
  const controls = (await db.list<Control>('backfill_control', { limit: 1 }))
    .items;
  const control = controls[0];
  const processed = cursors.reduce((sum, cursor) => sum + cursor.processed, 0);
  const completedSources = cursors.filter((cursor) => cursor.completed).length;
  const start = control?.nextIndex || 0;
  let nextSource = '';
  for (let step = 0; step < sources.length; step++) {
    const source = sources[(start + step) % sources.length];
    const cursor = cursors.find((item) => item.sourceKey === source.key);
    if (!cursor?.completed) {
      nextSource = source.key;
      break;
    }
  }
  const lastErrorCursor = [...cursors]
    .filter((cursor) => cursor.lastError)
    .sort((a, b) => b.lastRun.localeCompare(a.lastRun))[0];
  return {
    processed,
    completedSources,
    totalSources: sources.length,
    nextSource: nextSource || 'COMPLETE',
    lastSource: control?.lastSource || '',
    lastRun: control?.lastRun || '',
    lastError: lastErrorCursor
      ? lastErrorCursor.sourceKey + ': ' + lastErrorCursor.lastError
      : '',
    cursors: cursors.map((cursor) => ({
      sourceKey: cursor.sourceKey,
      cursor: cursor.cursor,
      processed: cursor.processed,
      completed: cursor.completed,
      lastRun: cursor.lastRun,
      lastError: cursor.lastError,
      hasNextPage: Boolean(cursor.nextUrl),
    })),
  };
}

/** A single invocation processes at most one provider page (collectors cap at 100
 * rows), or one bounded legacy-index migration step. External writers must share
 * the GitHub concurrency group; the database cannot supply an atomic lock.
 */
export async function runBackfillBatch(sources: BackfillSource[]) {
  const cursorPage = await db.list<Cursor>('backfill_cursors', { limit: 100 });
  if (cursorPage.nextToken) throw new Error('BACKFILL_CURSOR_REGISTRY_LIMIT');
  const cursors = cursorPage.items;
  const controls = (await db.list<Control>('backfill_control', { limit: 1 }))
    .items;
  const control = controls[0] || {
    nextIndex: 0,
    runs: 0,
    lastSource: '',
    lastRun: '',
  };
  let selectedIndex = -1;
  for (let step = 0; step < sources.length; step++) {
    const index = (control.nextIndex + step) % sources.length;
    if (
      !cursors.find((item) => item.sourceKey === sources[index].key)?.completed
    ) {
      selectedIndex = index;
      break;
    }
  }
  const source = sources[selectedIndex];
  let current: Cursor | undefined = source
    ? cursors.find((item) => item.sourceKey === source.key) || {
        sourceKey: source.key,
        cursor: 0,
        processed: 0,
        completed: false,
        lastRun: '',
        lastError: '',
      }
    : undefined;
  const now = new Date().toISOString();
  const run: BackfillRun = {
    run_id: randomUUID(),
    source_id: source?.key || null,
    status: source ? 'SUCCESS' : 'COMPLETE',
    checkpoint_before: current ? checkpointOf(current) : null,
    checkpoint_after: current ? checkpointOf(current) : null,
    pages_processed: 0,
    records_processed: 0,
    evidence_processed: 0,
    duplicates_skipped: 0,
    started_at: now,
    completed_at: null,
    failure_reason: null,
    source_completed: !source,
    retry_count: current?.retryCount || 0,
  };
  const runTable =
    'backfill_runs:' + (source?.key || 'complete') + ':' + now.slice(0, 7);
  const [runId] = await db.add(runTable, [{ ...run, status: 'RUNNING' }]);
  if (!runId) throw new Error('BACKFILL_RUN_START_UNCERTAIN');
  const saveRun = async () => {
    const [saved] = await db.update(runTable, [
      { id: runId, record: { ...run } },
    ]);
    if (!saved) throw new Error('BACKFILL_RUN_SAVE_FAILED');
  };
  if (!source || !current) {
    run.completed_at = new Date().toISOString();
    await saveRun();
    return { ...(await getBackfillStatus(sources)), run };
  }
  let handle: Awaited<ReturnType<typeof beginPull>> | undefined;
  let events: Evidence[] | undefined, received: number | undefined;
  let acknowledged = 0,
    writeAttempted = false,
    uncertain = false,
    cursorEnd: number | null = null;
  try {
    const index = await prepareArchiveIdentityIndex();
    if (!index.complete) run.maintenance = 'ARCHIVE_IDENTITY_INDEX';
    else {
      handle = await beginPull({
        source,
        mode: 'BACKFILL',
        startedAt: now,
        checkpoint: { start: current.cursor, end: null },
      });
      current = {
        ...current,
        context: await prepareBackfillContext(
          source,
          current.cursor,
          current.nextUrl,
          current.context,
        ),
      };
      // Pin resource identity/date window before collection, without advancing it.
      await saveCursor({ ...current, lastRun: now });
      const page = await collectBackfillPage(
        source,
        current.cursor,
        current.nextUrl,
        current.context,
      );
      if (page.rows.length > 100) throw new Error('BACKFILL_PAGE_ROW_LIMIT');
      if (
        !page.completed &&
        (page.next < current.cursor ||
          (page.next === current.cursor &&
            (!page.nextUrl || page.nextUrl === current.nextUrl)))
      )
        throw new Error('BACKFILL_PAGE_NO_PROGRESS');
      const providerContext = { ...current.context };
      for (const field of [
        'wfsLayer',
        'ckanResource',
        'kmlSnapshot',
      ] as const) {
        const value = page.context?.[field];
        if (value !== undefined)
          Object.assign(providerContext, { [field]: value });
      }
      if (
        JSON.stringify(providerContext) !==
        JSON.stringify(current.context || {})
      ) {
        current = { ...current, context: providerContext };
        await saveCursor({ ...current, lastRun: now });
      }
      received = page.rows.length;
      run.records_processed = received;
      cursorEnd = page.next;
      events = page.rows.map((row) =>
        normalizeEvidence(
          {
            ...source,
            datasetId: source.datasetId || page.context?.ckanResource?.id,
          },
          row,
          now,
        ),
      );
      writeAttempted = events.length > 0;
      const saved = await persistArchiveBatch(
        source.key,
        current.cursor,
        page.next,
        events,
        { nextUrl: current.nextUrl, context: current.context },
      );
      acknowledged = saved.acknowledgedRecords;
      run.evidence_processed = saved.insertedRecords;
      run.duplicates_skipped = saved.duplicatesSkipped;
      const advanced: Cursor = {
        ...current,
        cursor: page.next,
        processed: current.processed + events.length,
        completed: page.completed,
        nextUrl: page.nextUrl || '',
        context: page.context || current.context || {},
        lastRun: now,
        lastError: '',
        retryCount: 0,
      };
      await saveCursor(advanced);
      current = advanced;
      run.pages_processed = 1;
      run.checkpoint_after = checkpointOf(current);
      run.source_completed = current.completed;
    }
  } catch (cause) {
    // A quota failure stops immediately. The durable RUNNING record exposes the
    // unfinished attempt; do not consume more quota trying to hide it as success.
    if (isDatabaseQuotaError(cause)) throw cause;
    run.status = 'FAILED';
    run.failure_reason =
      cause instanceof Error ? cause.message : 'BACKFILL_FAILED';
    const failure = cause as {
      acknowledgedRecords?: number;
      insertedRecords?: number;
      duplicatesSkipped?: number;
      persistenceUncertain?: boolean;
    };
    acknowledged = failure?.acknowledgedRecords ?? acknowledged;
    run.evidence_processed = failure?.insertedRecords ?? run.evidence_processed;
    run.duplicates_skipped =
      failure?.duplicatesSkipped ?? run.duplicates_skipped;
    uncertain = failure?.persistenceUncertain === true;
    console.warn('HIRER_BACKFILL_FAILED', source.key, run.failure_reason);
    // Re-read before annotating an error: an update may have committed even if
    // its response was lost. Never replace a persisted checkpoint with stale data.
    const persisted = (
      await db.list<Cursor>('backfill_cursors', { limit: 100 })
    ).items.find((item) => item.sourceKey === source.key);
    current = {
      ...(persisted || current),
      lastRun: now,
      lastError: run.failure_reason,
      retryCount: run.retry_count + 1,
    };
    run.checkpoint_after = checkpointOf(current);
    run.source_completed = current.completed;
    await saveCursor(current);
  }
  run.completed_at = new Date().toISOString();
  // Preserve the authoritative per-run outcome even if receipt/control updates
  // subsequently fail; those failures still escape to the workflow caller.
  await saveRun();
  if (handle)
    await finishPull(handle, {
      source,
      mode: 'BACKFILL',
      startedAt: now,
      finishedAt: run.completed_at,
      rows: events,
      received,
      acknowledged,
      writeAttempted,
      uncertain,
      failure: run.failure_reason || undefined,
      checkpoint: {
        start: run.checkpoint_before!.cursor,
        end: run.status === 'FAILED' ? null : cursorEnd,
        resource: current.context,
      },
    });
  const totals = current.automationTotals || {
    pages: 0,
    evidence: 0,
    duplicates: 0,
  };
  await saveCursor({
    ...current,
    lastRun: now,
    lastRunMetrics: run,
    automationTotals: {
      pages: totals.pages + run.pages_processed,
      evidence: totals.evidence + run.evidence_processed,
      duplicates: totals.duplicates + run.duplicates_skipped,
    },
  });
  await saveControl({
    ...control,
    nextIndex: (selectedIndex + 1) % sources.length,
    runs: control.runs + 1,
    lastSource: source.key,
    lastRun: now,
    lastRunMetrics: run,
  });
  return { ...(await getBackfillStatus(sources)), run };
}

/** Totals are additive since automation rollout; legacy processed is separately
 * retained because historical records cannot establish unique insertion counts.
 */
export async function getBackfillAutomationMetrics(sources: BackfillSource[]) {
  const page = await db.list<Cursor>('backfill_cursors', { limit: 100 });
  if (page.nextToken) throw new Error('BACKFILL_CURSOR_REGISTRY_LIMIT');
  const cursors = page.items.filter((cursor) =>
    sources.some((source) => source.key === cursor.sourceKey),
  );
  const control = (await db.list<Control>('backfill_control', { limit: 1 }))
    .items[0];
  const migration = (await db.list('archive_identity_migration', { limit: 1 }))
    .items[0];
  const count = (value: number | undefined): number | null =>
    Number.isSafeInteger(value) && value! >= 0 ? value! : null;
  const sourceMetrics = sources.map((source) => {
    const cursor = cursors.find((item) => item.sourceKey === source.key);
    return {
      source_id: source.key,
      checkpoint:
        cursor && count(cursor.cursor) !== null ? checkpointOf(cursor) : null,
      completed:
        typeof cursor?.completed === 'boolean' ? cursor.completed : null,
      records_processed: count(cursor?.processed),
      evidence_processed: count(cursor?.automationTotals?.evidence),
      pages_processed: count(cursor?.automationTotals?.pages),
      duplicates_skipped: count(cursor?.automationTotals?.duplicates),
      last_run: cursor?.lastRunMetrics || null,
    };
  });
  const sumKnown = (values: Array<number | null>) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    last_backfill_run: control?.lastRun || null,
    last_run: control?.lastRunMetrics || null,
    records_processed: sumKnown(
      sourceMetrics.map((row) => row.records_processed),
    ),
    evidence_processed: sumKnown(
      sourceMetrics.map((row) => row.evidence_processed),
    ),
    pages_processed: sumKnown(sourceMetrics.map((row) => row.pages_processed)),
    duplicates_skipped: sumKnown(
      sourceMetrics.map((row) => row.duplicates_skipped),
    ),
    sources_completed: cursors.filter((cursor) => cursor.completed).length,
    sources_remaining:
      sources.length - cursors.filter((cursor) => cursor.completed).length,
    metrics_basis:
      'Records processed include stored legacy counts. Evidence/page/duplicate totals sum observed automation counters since rollout; pre-rollout unique totals are unknown. Null means no stored observation, not zero.',
    metric_coverage: {
      total_sources: sourceMetrics.length,
      sources_with_checkpoints: sourceMetrics.filter(
        (row) => row.checkpoint !== null,
      ).length,
      sources_with_rollout_metrics: sourceMetrics.filter(
        (row) =>
          row.evidence_processed !== null &&
          row.pages_processed !== null &&
          row.duplicates_skipped !== null,
      ).length,
    },
    archive_index: migration || null,
    sources: sourceMetrics,
  };
}
