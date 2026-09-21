import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import { evidenceTimestamp, type OrganisationRole } from './domain-hardening';
import { evidenceHoldReasons } from './evidence-eligibility';
import type { IntelligenceEvidence } from './intelligence';

export type OperationalEvidence = IntelligenceEvidence & {
  id: string;
  stage?: 'WATCH' | 'RISING' | 'PREPARE';
  score?: number;
  window?: string;
  equipment?: string;
  action?: string;
  evidenceType?: 'EXPLICIT';
  evidenceOrigin: 'LIVE' | 'ARCHIVE';
};

const identity = (row: IntelligenceEvidence) =>
  JSON.stringify([row.sourceKey, row.externalId]);
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const roles = new Set<OrganisationRole>([
  'DELIVERY_CONTRACTOR',
  'OWNER_PROPONENT',
  'APPLICANT_HOLDER',
  'SUPPLIER',
  'OPERATOR',
  'UNKNOWN',
]);
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

function archivedEvidence(
  value: unknown,
  sourceKey: string,
): OperationalEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !sourceKey ||
    row.sourceKey !== sourceKey ||
    !text(row.externalId) ||
    !text(row.project) ||
    !text(row.location)
  )
    return null;
  const normal: IntelligenceEvidence = {
    sourceKey,
    externalId: text(row.externalId),
    project: text(row.project),
    location: text(row.location),
    company: text(row.company),
    description: text(row.description),
    value: text(row.value) || 'Not stated',
    observedAt: text(row.observedAt),
    sourceObservedAt: text(row.sourceObservedAt) || undefined,
    organisationRole: roles.has(row.organisationRole as OrganisationRole)
      ? (row.organisationRole as OrganisationRole)
      : 'UNKNOWN',
    provenance: text(row.provenance),
    qualityFlags: [
      ...new Set([
        ...(Array.isArray(row.qualityFlags)
          ? row.qualityFlags.map(text).filter(Boolean)
          : []),
        ...evidenceHoldReasons(row).filter(
          (reason) =>
            reason === 'MALFORMED_QUALITY_FLAGS' ||
            reason === 'MALFORMED_PROMOTION_RESTRICTION',
        ),
      ]),
    ],
    ...(typeof row.contextOnly === 'boolean'
      ? { contextOnly: row.contextOnly }
      : {}),
    ...(typeof row.promotionEligible === 'boolean'
      ? { promotionEligible: row.promotionEligible }
      : {}),
  };
  return {
    ...normal,
    id: 'archive-' + digest(identity(normal)),
    stage: 'WATCH',
    score: 0,
    window: 'Historical evidence; validate current status',
    equipment: 'Not inferred',
    action: 'Review source activity and current project status',
    evidenceType: 'EXPLICIT',
    evidenceOrigin: 'ARCHIVE',
  };
}

function preferredVersion(
  a: OperationalEvidence,
  b: OperationalEvidence,
): OperationalEvidence {
  const dateDifference = evidenceTimestamp(a) - evidenceTimestamp(b);
  if (dateDifference) return dateDifference > 0 ? a : b;
  if (a.evidenceOrigin !== b.evidenceOrigin)
    return a.evidenceOrigin === 'LIVE' ? a : b;
  const stamp = (row: OperationalEvidence) => {
    const parsed = Date.parse(row.observedAt);
    return Number.isFinite(parsed) && parsed <= Date.now() ? parsed : 0;
  };
  if (stamp(a) !== stamp(b)) return stamp(a) > stamp(b) ? a : b;
  // Stable tie-breaking makes duplicate/revision ordering irrelevant.
  return JSON.stringify(a).localeCompare(JSON.stringify(b)) >= 0 ? a : b;
}

function preferred(
  a: OperationalEvidence,
  b: OperationalEvidence,
): OperationalEvidence {
  const selected = preferredVersion(a, b);
  // A newer or live copy is not evidence that a prior review hold was resolved.
  // Keep all known restrictions within this bounded window until explicit reconciliation.
  const reasons = [
    ...new Set([...evidenceHoldReasons(a), ...evidenceHoldReasons(b)]),
  ].sort();
  return reasons.length ? { ...selected, qualityFlags: reasons } : selected;
}

const MAX_WINDOW_RECORDS = 1500;
const MAX_ARCHIVE_PAGES = 20;
const MAX_REQUESTS = 10;
const ARCHIVE_BATCH_SIZE = 5;
const MAX_CURSOR_LENGTH = 12000;
const MAX_TOKEN_LENGTH = 8000;
const TOKEN_HISTORY_LENGTH = 32;
const MAX_EVENT_OFFSET = 1_000_000;

type ReadState = { done: boolean; token?: string; history: string[] };
type PendingPage = { id: string; offset: number; fingerprint: string };
type WindowCursor = {
  v: 1;
  kind: 'operational-evidence';
  live: ReadState;
  archive: ReadState & { pending: PendingPage[] };
};
type ArchivePage = { sourceKey?: unknown; events?: unknown };
type QueuedPage = { id: string; offset: number; record: ArchivePage };

const plainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validString = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
const onlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const fingerprint = (page: ArchivePage) =>
  digest(JSON.stringify({ sourceKey: page.sourceKey, events: page.events }));

function decodeWindowCursor(value: string | undefined): WindowCursor {
  if (value === undefined)
    return {
      v: 1,
      kind: 'operational-evidence',
      live: { done: false, history: [] },
      archive: { done: false, history: [], pending: [] },
    };
  try {
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > MAX_CURSOR_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error();
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (
      !plainObject(parsed) ||
      !onlyKeys(parsed, ['v', 'kind', 'live', 'archive']) ||
      parsed.v !== 1 ||
      parsed.kind !== 'operational-evidence'
    )
      throw new Error();
    const readState = (input: unknown, archive = false): ReadState => {
      if (
        !plainObject(input) ||
        !onlyKeys(input, [
          'done',
          'token',
          'history',
          ...(archive ? ['pending'] : []),
        ]) ||
        typeof input.done !== 'boolean' ||
        !Array.isArray(input.history) ||
        input.history.length > TOKEN_HISTORY_LENGTH ||
        input.history.some(
          (item) => typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item),
        ) ||
        new Set(input.history).size !== input.history.length
      )
        throw new Error();
      const token = input.token;
      if (token !== undefined && !validString(token, MAX_TOKEN_LENGTH))
        throw new Error();
      if (input.done ? token !== undefined : token === undefined)
        throw new Error();
      if (
        token !== undefined &&
        input.history[input.history.length - 1] !== digest(token)
      )
        throw new Error();
      return {
        done: input.done,
        token,
        history: [...input.history] as string[],
      };
    };
    const current = readState(parsed.live),
      archived = readState(parsed.archive, true);
    const rawPending = (parsed.archive as Record<string, unknown>).pending;
    if (!Array.isArray(rawPending) || rawPending.length > ARCHIVE_BATCH_SIZE)
      throw new Error();
    const pending: PendingPage[] = rawPending.map(
      (item: unknown, index: number) => {
        if (
          !plainObject(item) ||
          !onlyKeys(item, ['id', 'offset', 'fingerprint']) ||
          !validString(item.id, 200) ||
          !Number.isSafeInteger(item.offset) ||
          (item.offset as number) < 0 ||
          (item.offset as number) > MAX_EVENT_OFFSET ||
          (index > 0 && item.offset !== 0) ||
          typeof item.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(item.fingerprint)
        )
          throw new Error();
        return {
          id: item.id,
          offset: item.offset as number,
          fingerprint: item.fingerprint,
        };
      },
    );
    if (new Set(pending.map((page) => page.id)).size !== pending.length)
      throw new Error();
    return {
      v: 1,
      kind: 'operational-evidence',
      live: current,
      archive: { ...archived, pending },
    };
  } catch {
    throw new Error('INVALID_EVIDENCE_WINDOW_CURSOR');
  }
}

function encodeWindowCursor(cursor: WindowCursor) {
  const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  if (encoded.length > MAX_CURSOR_LENGTH)
    throw new Error('EVIDENCE_WINDOW_CURSOR_TOO_LARGE');
  return encoded;
}

/** Recent token hashes stay bounded across requests; immediate and short cycles fail visibly. */
function advance(state: ReadState, nextToken: unknown) {
  if (nextToken === undefined || nextToken === null || nextToken === '') {
    state.done = true;
    state.token = undefined;
    state.history = [];
    return;
  }
  if (typeof nextToken === 'string' && nextToken.length > MAX_TOKEN_LENGTH)
    throw new Error('EVIDENCE_WINDOW_CURSOR_TOO_LARGE');
  if (!validString(nextToken, MAX_TOKEN_LENGTH))
    throw new Error('EVIDENCE_WINDOW_READ_INVALID');
  const hash = digest(nextToken);
  if (state.history.includes(hash))
    throw new Error('EVIDENCE_WINDOW_PAGINATION_STALLED');
  state.token = nextToken;
  state.done = false;
  state.history = [...state.history, hash].slice(-TOKEN_HISTORY_LENGTH);
}

function validateBatch<T>(items: T[], limit: number): T[] {
  if (!Array.isArray(items) || items.length > limit)
    throw new Error('EVIDENCE_WINDOW_READ_INVALID');
  return items;
}

/**
 * One bounded, read-only operational window. Archive resumes use saved database IDs,
 * never a scan from the beginning. Immutable revisions are not rewritten.
 * Counts, ranking inputs and deduplication apply to this window only. Continuation
 * tokens are positions in a changing store, not a frozen all-time export.
 */
export async function loadEvidenceUniverse(
  cursor?: string,
  maxRecords = MAX_WINDOW_RECORDS,
) {
  if (
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > MAX_WINDOW_RECORDS
  )
    throw new Error('INVALID_EVIDENCE_WINDOW_LIMIT');
  const state = decodeWindowCursor(cursor);
  const merged = new Map<string, OperationalEvidence>();
  let duplicateRecords = 0;
  const add = (row: OperationalEvidence) => {
    const key = identity(row),
      previous = merged.get(key);
    if (previous) {
      duplicateRecords++;
      merged.set(key, preferred(previous, row));
    } else merged.set(key, row);
  };

  let liveLoaded = 0,
    liveRequests = 0;
  while (
    !state.live.done &&
    liveLoaded < maxRecords &&
    liveRequests < MAX_REQUESTS
  ) {
    const limit = Math.min(500, maxRecords - liveLoaded);
    const page = await db.list<IntelligenceEvidence>('opportunities', {
      limit,
      nextToken: state.live.token,
    });
    liveRequests++;
    const rows = validateBatch(page.items, limit);
    advance(state.live, page.nextToken);
    liveLoaded += rows.length;
    for (const row of rows) add({ ...row, evidenceOrigin: 'LIVE' });
  }

  let archiveRecordsLoaded = 0,
    archivePagesRead = 0,
    archiveRequests = 0;
  let invalidArchiveRecords = 0,
    invalidArchivePages = 0;
  let queue: QueuedPage[] = [];
  if (state.archive.pending.length) {
    // db.get returns data in request order without IDs; preserve the requested IDs.
    const pending = state.archive.pending;
    const records = await db.get<ArchivePage>(
      'evidence_pages',
      pending.map((page) => page.id),
    );
    archiveRequests++;
    if (!Array.isArray(records) || records.length !== pending.length)
      throw new Error('EVIDENCE_WINDOW_CHANGED_RESTART');
    queue = pending.map((page, index) => {
      const record = records[index];
      if (
        !record ||
        !plainObject(record) ||
        fingerprint(record) !== page.fingerprint ||
        (page.offset > 0 &&
          (!Array.isArray(record.events) ||
            page.offset >= record.events.length))
      ) {
        throw new Error('EVIDENCE_WINDOW_CHANGED_RESTART');
      }
      return { id: page.id, offset: page.offset, record };
    });
  }
  state.archive.pending = [];

  while (
    archiveRecordsLoaded < maxRecords &&
    archivePagesRead < MAX_ARCHIVE_PAGES
  ) {
    if (!queue.length) {
      if (state.archive.done || archiveRequests >= MAX_REQUESTS) break;
      const limit = Math.min(
        ARCHIVE_BATCH_SIZE,
        MAX_ARCHIVE_PAGES - archivePagesRead,
      );
      const page = await db.list<ArchivePage>('evidence_pages', {
        limit,
        nextToken: state.archive.token,
      });
      archiveRequests++;
      const rows = validateBatch(page.items, limit);
      advance(state.archive, page.nextToken);
      const ids = new Set<string>();
      queue = rows.map((record) => {
        if (
          !plainObject(record) ||
          !validString(record.id, 200) ||
          ids.has(record.id)
        )
          throw new Error('EVIDENCE_WINDOW_READ_INVALID');
        ids.add(record.id);
        return { id: record.id, offset: 0, record };
      });
      if (!queue.length) continue;
    }
    const current = queue[0];
    archivePagesRead++;
    if (!Array.isArray(current.record.events)) {
      invalidArchivePages++;
      queue.shift();
      continue;
    }
    const events = current.record.events;
    const end = Math.min(
      events.length,
      current.offset + maxRecords - archiveRecordsLoaded,
    );
    for (let index = current.offset; index < end; index++) {
      archiveRecordsLoaded++;
      const row = archivedEvidence(
        events[index],
        text(current.record.sourceKey),
      );
      if (row) add(row);
      else invalidArchiveRecords++;
    }
    current.offset = end;
    if (current.offset >= events.length) queue.shift();
  }
  state.archive.pending = queue.map(({ id, offset, record }) => {
    if (offset > MAX_EVENT_OFFSET)
      throw new Error('EVIDENCE_WINDOW_CURSOR_TOO_LARGE');
    return { id, offset, fingerprint: fingerprint(record) };
  });
  const liveTruncated = !state.live.done;
  const archiveTruncated =
    !state.archive.done || state.archive.pending.length > 0;
  const nextCursor =
    liveTruncated || archiveTruncated ? encodeWindowCursor(state) : undefined;
  const items = [...merged.values()].sort(
    (a, b) =>
      evidenceTimestamp(b) - evidenceTimestamp(a) ||
      identity(a).localeCompare(identity(b)),
  );
  return {
    items,
    nextCursor,
    coverage: {
      loaded: items.length,
      truncated: liveTruncated || archiveTruncated,
      pagesRead: liveRequests + archiveRequests,
      liveLoaded,
      liveTruncated,
      archiveRecordsLoaded,
      archiveUnique: items.filter((row) => row.evidenceOrigin === 'ARCHIVE')
        .length,
      archivePagesRead,
      archiveTruncated,
      duplicateRecords,
      invalidArchiveRecords,
      invalidArchivePages,
      windowOnly: true as const,
      snapshot: false as const,
      deduplicationScope: 'WINDOW' as const,
      disclosure:
        'Counts, rankings and duplicate suppression apply only to this evidence window. The same identity may appear in another window. Concurrent ingestion can change pagination; this is not a frozen all-time dataset.',
    },
  };
}
