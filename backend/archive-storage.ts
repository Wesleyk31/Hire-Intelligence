import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import type { Evidence, BackfillContext } from './backfill-fetch';

const MAX_PAGE_BYTES = 224 * 1024;
const MAX_BATCH_BYTES = 1024 * 1024;
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
// Retrieval time is not a factual revision. Changed source evidence is retained.
const fingerprint = ({ observedAt: _retrieved, ...evidence }: Evidence) =>
  hash(evidence);
type Saved<T> = T & { id: string };

async function singleton<T>(table: string): Promise<Saved<T> | undefined> {
  const page = await db.list<T>(table, { limit: 2 });
  if (page.items.length > 1 || page.nextToken)
    throw new Error('ARCHIVE_CONCURRENT_WRITERS_REVIEW_REQUIRED');
  return page.items[0] as Saved<T> | undefined;
}
async function save(
  table: string,
  record: Record<string, unknown>,
  id?: string,
): Promise<string> {
  if (bytes(record) > MAX_PAGE_BYTES)
    throw new Error('ARCHIVE_INDEX_ITEM_TOO_LARGE');
  if (id) {
    const [ok] = await db.update(table, [{ id, record: { ...record } }]);
    if (!ok) throw new Error('ARCHIVE_JOURNAL_SAVE_FAILED');
    return id;
  }
  const [created] = await db.add(table, [{ ...record }]);
  if (!created) throw new Error('ARCHIVE_JOURNAL_SAVE_FAILED');
  return created;
}

type Shard = { branch?: boolean; keys: string[] };
/** Sixteen initial shards/source; full shards split by the next hex digit.
 * Each lookup reads one bounded record per level, never a growing-table scan.
 * All writers MUST be externally serialized: the SDK has no CAS/transactions.
 */
class IdentityIndex {
  private cache = new Map<string, Saved<Shard> | undefined>();
  private dirty = new Set<string>();
  private table(source: string, prefix: string) {
    return 'archive_identities:' + hash(source).slice(0, 24) + ':' + prefix;
  }
  private async leaf(source: string, key: string, depth = 1): Promise<string> {
    if (depth > 8) throw new Error('ARCHIVE_IDENTITY_SHARD_LIMIT');
    const table = this.table(source, key.slice(0, depth));
    if (!this.cache.has(table))
      this.cache.set(table, await singleton<Shard>(table));
    return this.cache.get(table)?.branch
      ? this.leaf(source, key, depth + 1)
      : table;
  }
  async has(source: string, key: string) {
    return (
      this.cache.get(await this.leaf(source, key))?.keys.includes(key) || false
    );
  }
  async add(source: string, key: string) {
    const table = await this.leaf(source, key);
    const row = this.cache.get(table) || { id: '', keys: [] };
    if (!row.keys.includes(key)) {
      row.keys.push(key);
      this.cache.set(table, row);
      this.dirty.add(table);
    }
  }
  async flush() {
    for (const table of this.dirty) {
      const row = this.cache.get(table)!;
      if (bytes({ keys: row.keys }) <= 192 * 1024) {
        row.id = await save(table, { keys: row.keys }, row.id || undefined);
      } else {
        const prefix = table.split(':').at(-1)!;
        if (prefix.length >= 8) throw new Error('ARCHIVE_IDENTITY_SHARD_LIMIT');
        // Children are durable before the parent changes. Replay merges children
        // from a failed split instead of replacing their acknowledged identities.
        for (const digit of '0123456789abcdef') {
          const keys = row.keys.filter((key) => key[prefix.length] === digit);
          if (!keys.length) continue;
          const childTable = table + digit;
          const child = await singleton<Shard>(childTable);
          if (child?.branch)
            throw new Error('ARCHIVE_SHARD_RECONCILIATION_REQUIRED');
          await save(
            childTable,
            { keys: [...new Set([...(child?.keys || []), ...keys])] },
            child?.id,
          );
        }
        row.id = await save(
          table,
          { branch: true, keys: [] },
          row.id || undefined,
        );
        row.branch = true;
        row.keys = [];
      }
    }
    this.dirty.clear();
  }
}

type Migration = {
  complete: boolean;
  nextToken?: string;
  eventOffset: number;
  pagesIndexed: number;
  invalidRecords: number;
};
/** Additive rollout: index at most one legacy page/500 rows per run before new
 * appends. Existing evidence and source checkpoints are never rewritten.
 */
export async function prepareArchiveIdentityIndex() {
  const table = 'archive_identity_migration';
  const saved = await singleton<Migration>(table);
  if (saved?.complete) return saved;
  const state: Migration = saved || {
    complete: false,
    eventOffset: 0,
    pagesIndexed: 0,
    invalidRecords: 0,
  };
  const page = await db.list<{ sourceKey: string; events: Evidence[] }>(
    'evidence_pages',
    { limit: 1, nextToken: state.nextToken },
  );
  const record = page.items[0];
  const events = Array.isArray(record?.events) ? record.events : [];
  const index = new IdentityIndex();
  if (record && !Array.isArray(record.events)) state.invalidRecords++;
  for (const event of events.slice(
    state.eventOffset,
    state.eventOffset + 500,
  )) {
    if (!event || event.sourceKey !== record.sourceKey || !event.externalId) {
      state.invalidRecords++;
      continue;
    }
    await index.add(event.sourceKey, fingerprint(event));
  }
  await index.flush();
  if (state.eventOffset + 500 < events.length) state.eventOffset += 500;
  else {
    state.eventOffset = 0;
    state.nextToken = page.nextToken;
    state.pagesIndexed += record ? 1 : 0;
    state.complete = !page.nextToken;
  }
  await save(table, state, saved?.id);
  return state;
}

type Part = {
  indexes: number[];
  contentHash: string;
  state: 'PENDING' | 'WRITING' | 'ACKNOWLEDGED';
  pageId?: string;
};
type Journal = {
  sourceKey: string;
  batchKey: string;
  eventHashes: string[];
  duplicates: number;
  parts: Part[];
  createdAt: string;
};
const journalTable = (batchKey: string) => 'archive_batch:' + batchKey;
export async function persistArchiveBatch(
  sourceKey: string,
  start: number,
  end: number,
  events: Evidence[],
  checkpoint: { nextUrl?: string; context?: BackfillContext },
) {
  if (!events.length)
    return { acknowledgedRecords: 0, insertedRecords: 0, duplicatesSkipped: 0 };
  if (events.length > 500) throw new Error('EVIDENCE_BATCH_ROW_LIMIT');
  const batchKey = hash({ sourceKey, start, checkpoint }),
    createdAt = new Date().toISOString();
  const record = (chunk: Evidence[], part: number) => ({
    sourceKey,
    cursorStart: start,
    cursorEnd: end,
    count: chunk.length,
    createdAt,
    batchKey,
    part,
    contentHash: hash(chunk.map(fingerprint)),
    events: chunk,
  });
  for (const event of events) {
    if (event.sourceKey !== sourceKey || !event.externalId)
      throw new Error('EVIDENCE_IDENTITY_INVALID');
    if (bytes(record([event], 0)) > MAX_PAGE_BYTES)
      throw new Error('EVIDENCE_RECORD_TOO_LARGE');
  }
  if (bytes(events) > MAX_BATCH_BYTES)
    throw new Error('EVIDENCE_BATCH_TOO_LARGE');
  if (!(await prepareArchiveIdentityIndex()).complete)
    throw new Error('ARCHIVE_IDENTITY_INDEX_PENDING');
  const eventHashes = events.map(fingerprint),
    table = journalTable(batchKey);
  const previous = await singleton<Journal>(table),
    identities = new IdentityIndex();
  let journal: Journal;
  if (previous) {
    if (JSON.stringify(previous.eventHashes) !== JSON.stringify(eventHashes))
      throw new Error('EVIDENCE_BATCH_CHANGED_REVIEW_REQUIRED');
    journal = previous;
  } else {
    journal = {
      sourceKey,
      batchKey,
      eventHashes,
      duplicates: 0,
      parts: [],
      createdAt,
    };
    let indexes: number[] = [];
    for (let i = 0; i < events.length; i++) {
      if (await identities.has(sourceKey, eventHashes[i])) {
        journal.duplicates++;
        continue;
      }
      // In-memory additions also suppress duplicates within this provider page.
      // Persist the index only after the archive has acknowledged every part.
      await identities.add(sourceKey, eventHashes[i]);
      if (
        indexes.length &&
        bytes(
          record(
            [...indexes, i].map((at) => events[at]),
            journal.parts.length,
          ),
        ) > MAX_PAGE_BYTES
      ) {
        journal.parts.push({
          indexes,
          contentHash: hash(indexes.map((at) => eventHashes[at])),
          state: 'PENDING',
        });
        indexes = [];
      }
      indexes.push(i);
    }
    if (indexes.length)
      journal.parts.push({
        indexes,
        contentHash: hash(indexes.map((at) => eventHashes[at])),
        state: 'PENDING',
      });
  }
  const journalId = previous?.id || (await save(table, journal));
  let insertedRecords = 0;
  let pendingAcknowledgement = false;
  const acknowledgedBefore = journal.parts
    .filter((part) => part.state === 'ACKNOWLEDGED')
    .reduce((sum, part) => sum + part.indexes.length, 0);
  try {
    for (let part = 0; part < journal.parts.length; part++) {
      const planned = journal.parts[part];
      if (planned.state === 'WRITING')
        throw new Error(
          'EVIDENCE_RECONCILIATION_REQUIRED:' + batchKey + ':' + part,
        );
      if (planned.state === 'ACKNOWLEDGED') continue;
      planned.state = 'WRITING';
      await save(table, journal, journalId);
      const [pageId] = await db.add('evidence_pages', [
        record(
          planned.indexes.map((at) => events[at]),
          part,
        ),
      ]);
      if (!pageId) {
        // A documented per-item rejection is distinct from a lost response.
        planned.state = 'PENDING';
        await save(table, journal, journalId);
        throw new Error('EVIDENCE_PAGE_SAVE_FAILED');
      }
      insertedRecords += planned.indexes.length;
      pendingAcknowledgement = true;
      planned.pageId = pageId;
      planned.state = 'ACKNOWLEDGED';
      await save(table, journal, journalId);
      pendingAcknowledgement = false;
    }
    for (const key of eventHashes) await identities.add(sourceKey, key);
    await identities.flush();
  } catch (cause) {
    if (cause instanceof Error)
      Object.assign(cause, {
        acknowledgedRecords: acknowledgedBefore + insertedRecords,
        insertedRecords,
        duplicatesSkipped: journal.duplicates + acknowledgedBefore,
        persistenceUncertain:
          pendingAcknowledgement ||
          journal.parts.some((part) => part.state === 'WRITING'),
      });
    throw cause;
  }
  return {
    acknowledgedRecords: events.length,
    insertedRecords,
    duplicatesSkipped: events.length - insertedRecords,
  };
}

/** Explicit recovery: supply the actual persisted page ID for a WRITING part.
 * Missing/uncertain append outcomes are never guessed safe to repeat.
 */
export async function reconcileArchivePage(
  batchKey: string,
  part: number,
  pageId: string,
) {
  const table = journalTable(batchKey),
    journal = await singleton<Journal>(table),
    planned = journal?.parts[part];
  if (!journal || !planned || planned.state !== 'WRITING')
    throw new Error('EVIDENCE_RECONCILIATION_NOT_PENDING');
  const [page] = await db.get<{
    batchKey: string;
    part: number;
    sourceKey: string;
    contentHash: string;
    events: Evidence[];
  }>('evidence_pages', [pageId]);
  if (
    !page ||
    page.batchKey !== batchKey ||
    page.part !== part ||
    page.sourceKey !== journal.sourceKey ||
    page.contentHash !== planned.contentHash ||
    !Array.isArray(page.events) ||
    hash(page.events.map(fingerprint)) !== planned.contentHash
  )
    throw new Error('EVIDENCE_RECONCILIATION_MISMATCH');
  planned.state = 'ACKNOWLEDGED';
  planned.pageId = pageId;
  await save(table, journal, journal.id);
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
