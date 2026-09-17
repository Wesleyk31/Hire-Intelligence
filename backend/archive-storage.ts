import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import type { Evidence, BackfillContext } from './backfill-fetch';

const MAX_PAGE_BYTES = 224 * 1024;
const MAX_BATCH_BYTES = 1024 * 1024;
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Append-only: uncertain acknowledgements may replay pages; readers deduplicate identities. */
export async function persistArchiveBatch(
  sourceKey: string,
  start: number,
  end: number,
  events: Evidence[],
  checkpoint: { nextUrl?: string; context?: BackfillContext },
) {
  if (!events.length) return { acknowledgedRecords: 0 };
  const batchKey = hash({ sourceKey, start, end, checkpoint });
  const createdAt = new Date().toISOString();
  const record = (chunk: Evidence[], part: number) => ({
    sourceKey,
    cursorStart: start,
    cursorEnd: end,
    count: chunk.length,
    createdAt,
    batchKey,
    part,
    contentHash: hash(chunk),
    events: chunk,
  });
  // Validate the whole batch before any writes; do not silently drop oversized rows.
  for (const event of events)
    if (bytes(record([event], 0)) > MAX_PAGE_BYTES)
      throw new Error('EVIDENCE_RECORD_TOO_LARGE');
  if (bytes(events) > MAX_BATCH_BYTES)
    throw new Error('EVIDENCE_BATCH_TOO_LARGE');
  const pages: ReturnType<typeof record>[] = [];
  let chunk: Evidence[] = [];
  for (const event of events) {
    const candidate = [...chunk, event];
    if (
      chunk.length &&
      bytes(record(candidate, pages.length)) > MAX_PAGE_BYTES
    ) {
      pages.push(record(chunk, pages.length));
      chunk = [event];
    } else chunk = candidate;
  }
  if (chunk.length) pages.push(record(chunk, pages.length));
  let acknowledgedRecords = 0;
  try {
    for (const page of pages) {
      const [id] = await db.add('evidence_pages', [{ ...page }]);
      if (!id) throw new Error('EVIDENCE_PAGE_SAVE_FAILED');
      acknowledgedRecords += page.count;
    }
  } catch (cause) {
    if (cause instanceof Error) Object.assign(cause, { acknowledgedRecords, persistenceUncertain: true });
    throw cause;
  }
  return { acknowledgedRecords };
}

export function isDatabaseQuotaError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
  };
  return (
    value.status === 429 ||
    value.statusCode === 429 ||
    [value.code, value.message].some(
      (text) =>
        typeof text === 'string' && text.includes('AppDatabaseQuotaExceeded'),
    )
  );
}
