import { persistArchiveBatch, isDatabaseQuotaError } from './archive-storage';
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
};
type Control = {
  nextIndex: number;
  runs: number;
  lastSource: string;
  lastRun: string;
};

async function saveCursor(cursor: Cursor) {
  const page = await db.list<Cursor>('backfill_cursors', { limit: 100 });
  const current = page.items.find(
    (item) => item.sourceKey === cursor.sourceKey,
  );
  const [saved] = current
    ? await db.update('backfill_cursors', [
        { id: current.id, record: { ...cursor } },
      ])
    : await db.add('backfill_cursors', [{ ...cursor }]);
  if (!saved) throw new Error('BACKFILL_CURSOR_SAVE_FAILED');
}

async function saveControl(control: Control) {
  const page = await db.list<Control>('backfill_control', { limit: 1 });
  const [saved] = page.items.length
    ? await db.update('backfill_control', [
        { id: page.items[0].id, record: { ...control } },
      ])
    : await db.add('backfill_control', [{ ...control }]);
  if (!saved) throw new Error('BACKFILL_CONTROL_SAVE_FAILED');
}

export async function getBackfillStatus(sources: BackfillSource[]) {
  const cursors = (await db.list<Cursor>('backfill_cursors', { limit: 100 }))
    .items;
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

export async function runBackfillBatch(sources: BackfillSource[]) {
  if (!sources.length) return getBackfillStatus(sources);
  const cursors = (await db.list<Cursor>('backfill_cursors', { limit: 100 }))
    .items;
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
    const cursor = cursors.find(
      (item) => item.sourceKey === sources[index].key,
    );
    if (!cursor?.completed) {
      selectedIndex = index;
      break;
    }
  }
  if (selectedIndex < 0) return getBackfillStatus(sources);
  const source = sources[selectedIndex];
  const existing = cursors.find((item) => item.sourceKey === source.key);
  let current: Cursor = existing || {
    sourceKey: source.key,
    cursor: 0,
    processed: 0,
    completed: false,
    lastRun: '',
    lastError: '',
  };
  const now = new Date().toISOString();
  try {
    current = {
      ...current,
      context: await prepareBackfillContext(
        source,
        current.cursor,
        current.nextUrl,
        current.context,
      ),
    };
    // Reserve the provider resource/window before content is fetched or archived.
    await saveCursor({ ...current, lastRun: now });
    const page = await collectBackfillPage(
      source,
      current.cursor,
      current.nextUrl,
      current.context,
    );
    if (
      page.context?.wfsLayer &&
      page.context.wfsLayer !== current.context?.wfsLayer
    ) {
      // Pin the first selected layer before archival; retries must not rediscover another layer.
      current = {
        ...current,
        context: { ...current.context, wfsLayer: page.context.wfsLayer },
      };
      await saveCursor({ ...current, lastRun: now });
    }
    const events = page.rows.map((row) => normalizeEvidence(source, row, now));
    await persistArchiveBatch(source.key, current.cursor, page.next, events, {
      nextUrl: current.nextUrl,
      context: current.context,
    });
    await saveCursor({
      sourceKey: source.key,
      cursor: page.next,
      processed: current.processed + events.length,
      completed: page.completed,
      nextUrl: page.nextUrl || '',
      context: page.context || current.context || {},
      lastRun: now,
      lastError: '',
    });
  } catch (cause) {
    if (isDatabaseQuotaError(cause)) throw cause;
    const message = cause instanceof Error ? cause.message : 'BACKFILL_FAILED';
    console.warn('HIRER_BACKFILL_FAILED', source.key, message);
    await saveCursor({ ...current, lastRun: now, lastError: message });
  }
  await saveControl({
    nextIndex: (selectedIndex + 1) % sources.length,
    runs: control.runs + 1,
    lastSource: source.key,
    lastRun: now,
  });
  return getBackfillStatus(sources);
}
