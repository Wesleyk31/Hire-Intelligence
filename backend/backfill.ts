import { db } from '@appdeploy/sdk';
import { collectBackfillPage, normalizeEvidence, type BackfillSource, type Evidence } from './backfill-fetch';

type Cursor = { sourceKey: string; cursor: number; processed: number; completed: boolean; lastRun: string; lastError: string };
type Control = { nextIndex: number; runs: number; lastSource: string; lastRun: string };
type EvidencePage = { sourceKey: string; cursorStart: number; cursorEnd: number; count: number; createdAt: string; events: Evidence[] };

async function saveCursor(cursor: Cursor) {
  const page = await db.list<Cursor>('backfill_cursors', { limit: 100 });
  const current = page.items.find(item => item.sourceKey === cursor.sourceKey);
  if (current) await db.update('backfill_cursors', [{ id: current.id, record: { ...cursor } }]);
  else await db.add('backfill_cursors', [{ ...cursor }]);
}

async function saveControl(control: Control) {
  const page = await db.list<Control>('backfill_control', { limit: 1 });
  if (page.items.length) await db.update('backfill_control', [{ id: page.items[0].id, record: { ...control } }]);
  else await db.add('backfill_control', [{ ...control }]);
}

async function persistPage(source: BackfillSource, start: number, end: number, events: Evidence[]) {
  if (!events.length) return;
  const record: EvidencePage = { sourceKey: source.key, cursorStart: start, cursorEnd: end, count: events.length, createdAt: new Date().toISOString(), events };
  const [id] = await db.add('evidence_pages', [{ ...record }]);
  if (!id) throw new Error('EVIDENCE_PAGE_SAVE_FAILED');
}

export async function getBackfillStatus(sources: BackfillSource[]) {
  const cursors = (await db.list<Cursor>('backfill_cursors', { limit: 100 })).items;
  const controls = (await db.list<Control>('backfill_control', { limit: 1 })).items;
  const control = controls[0];
  const processed = cursors.reduce((sum, cursor) => sum + cursor.processed, 0);
  const completedSources = cursors.filter(cursor => cursor.completed).length;
  const start = control?.nextIndex || 0;
  let nextSource = '';
  for (let step = 0; step < sources.length; step++) {
    const source = sources[(start + step) % sources.length];
    const cursor = cursors.find(item => item.sourceKey === source.key);
    if (!cursor?.completed) { nextSource = source.key; break; }
  }
  const lastErrorCursor = [...cursors].filter(cursor => cursor.lastError).sort((a, b) => b.lastRun.localeCompare(a.lastRun))[0];
  return { processed, completedSources, totalSources: sources.length, nextSource: nextSource || 'COMPLETE', lastSource: control?.lastSource || '', lastRun: control?.lastRun || '', lastError: lastErrorCursor ? lastErrorCursor.sourceKey + ': ' + lastErrorCursor.lastError : '', cursors: cursors.map(cursor => ({ sourceKey: cursor.sourceKey, cursor: cursor.cursor, processed: cursor.processed, completed: cursor.completed, lastRun: cursor.lastRun, lastError: cursor.lastError })) };
}

export async function runBackfillBatch(sources: BackfillSource[]) {
  if (!sources.length) return getBackfillStatus(sources);
  const cursors = (await db.list<Cursor>('backfill_cursors', { limit: 100 })).items;
  const controls = (await db.list<Control>('backfill_control', { limit: 1 })).items;
  const control = controls[0] || { nextIndex: 0, runs: 0, lastSource: '', lastRun: '' };
  let selectedIndex = -1;
  for (let step = 0; step < sources.length; step++) {
    const index = (control.nextIndex + step) % sources.length;
    const cursor = cursors.find(item => item.sourceKey === sources[index].key);
    if (!cursor?.completed) { selectedIndex = index; break; }
  }
  if (selectedIndex < 0) return getBackfillStatus(sources);
  const source = sources[selectedIndex];
  const existing = cursors.find(item => item.sourceKey === source.key);
  const current: Cursor = existing || { sourceKey: source.key, cursor: 0, processed: 0, completed: false, lastRun: '', lastError: '' };
  const now = new Date().toISOString();
  try {
    const page = await collectBackfillPage(source, current.cursor);
    const events = page.rows.map(row => normalizeEvidence(source, row, now));
    await persistPage(source, current.cursor, page.next, events);
    await saveCursor({ sourceKey: source.key, cursor: page.next, processed: current.processed + events.length, completed: page.completed, lastRun: now, lastError: '' });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'BACKFILL_FAILED';
    console.warn('HIRER_BACKFILL_FAILED', source.key, message);
    await saveCursor({ ...current, lastRun: now, lastError: message });
  }
  await saveControl({ nextIndex: (selectedIndex + 1) % sources.length, runs: control.runs + 1, lastSource: source.key, lastRun: now });
  return getBackfillStatus(sources);
}
