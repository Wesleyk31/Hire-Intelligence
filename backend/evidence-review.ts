import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';

type Origin = 'LIVE' | 'ARCHIVE';
type Cursor = {
  v: 1;
  origin: Origin;
  token?: string;
  pageId?: string;
  offset?: number;
  fingerprint?: string;
};
type ArchivePage = { sourceKey: string; events: unknown };
const text = (value: unknown, max = 1200) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex');
const encode = (cursor: Cursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decode(value: string | undefined, origin: Origin): Cursor {
  if (!value) return { v: 1, origin };
  try {
    if (value.length > 12000 || !/^[a-zA-Z0-9_-]+$/.test(value))
      throw new Error();
    const input = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as Cursor;
    if (
      input.v !== 1 ||
      input.origin !== origin ||
      (input.token !== undefined &&
        (typeof input.token !== 'string' || input.token.length > 8000)) ||
      (input.pageId !== undefined &&
        (origin !== 'ARCHIVE' ||
          typeof input.pageId !== 'string' ||
          input.pageId.length > 200)) ||
      (input.pageId !== undefined &&
        (typeof input.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.fingerprint))) ||
      (input.offset !== undefined &&
        (!input.pageId ||
          !Number.isSafeInteger(input.offset) ||
          input.offset < 0))
    )
      throw new Error();
    return input;
  } catch {
    throw new Error('INVALID_EVIDENCE_CURSOR');
  }
}

export function inspectEvidenceQuality(
  value: unknown,
  now = Date.now(),
): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['MALFORMED_RECORD'];
  const row = value as Record<string, unknown>,
    issues: string[] = [];
  if (Array.isArray(row.qualityFlags))
    issues.push(
      ...new Set(
        row.qualityFlags
          .filter(
            (flag): flag is string =>
              typeof flag === 'string' && Boolean(flag.trim()),
          )
          .slice(0, 100)
          .map((flag) => flag.trim().slice(0, 200)),
      ),
    );
  if (row.contextOnly === true) issues.push('CONTEXT_ONLY');
  if (row.promotionEligible === false) issues.push('NOT_PROMOTION_ELIGIBLE');
  const source = text(row.sourceKey),
    id = text(row.externalId),
    name = text(row.project);
  if (!source) issues.push('MISSING_SOURCE');
  if (!id) issues.push('MISSING_ID');
  if (!name) issues.push('MISSING_PROJECT');
  if (!text(row.location)) issues.push('MISSING_LOCATION');
  if (!text(row.provenance)) issues.push('MISSING_PROVENANCE');
  // A small integer is a review clue, not proof of an invalid upstream ID.
  if (/^\d{1,3}$/.test(id)) issues.push('POSSIBLE_POSITIONAL_ID');
  if (
    source.startsWith('aemo-') &&
    /^(site name|unit name|background information|glossary|definition|field name)$/i.test(
      name,
    )
  )
    issues.push('AEMO_METADATA_ROW');
  const sourceDate = text(row.sourceObservedAt);
  if (row.sourceObservedAt == null || row.sourceObservedAt === '')
    issues.push('MISSING_SOURCE_DATE');
  else {
    const stamp = Date.parse(sourceDate);
    const parts = sourceDate.slice(0, 10).split('-').map(Number);
    const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const validCalendar =
      parts.length === 3 &&
      calendar.getUTCFullYear() === parts[0] &&
      calendar.getUTCMonth() === parts[1] - 1 &&
      calendar.getUTCDate() === parts[2];
    if (
      typeof row.sourceObservedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(sourceDate) ||
      !validCalendar ||
      !Number.isFinite(stamp)
    )
      issues.push('INVALID_SOURCE_DATE');
    else if (stamp > now + 86400000) issues.push('FUTURE_SOURCE_DATE');
    else if (now - stamp > 730 * 86400000) issues.push('STALE_SOURCE_ACTIVITY');
  }
  return issues;
}

function reviewRow(
  value: unknown,
  origin: Origin,
  storageId: string,
  index?: number,
  expectedSource?: string,
) {
  const row =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const issues = inspectEvidenceQuality(value);
  if (expectedSource && row.sourceKey !== expectedSource)
    issues.push('ARCHIVE_SOURCE_MISMATCH');
  return {
    reviewId:
      origin + ':' + storageId + (index === undefined ? '' : ':' + index),
    origin,
    storageId,
    eventIndex: index,
    sourceKey: text(row.sourceKey, 150),
    externalId: text(row.externalId, 300),
    project: text(row.project, 500),
    location: text(row.location, 250),
    company: text(row.company, 250),
    description: text(row.description),
    sourceObservedAt: text(row.sourceObservedAt, 80),
    observedAt: text(row.observedAt, 80),
    provenance: text(row.provenance, 2000),
    contentHash: createHash('sha256')
      .update(JSON.stringify(value) ?? 'null')
      .digest('hex'),
    issues,
  };
}

/** One bounded database page per action. Review findings never mutate the stored originals. */
export async function getEvidencePage(options: {
  origin: Origin;
  cursor?: string;
  limit?: number;
}) {
  if (options.origin !== 'LIVE' && options.origin !== 'ARCHIVE')
    throw new Error('INVALID_EVIDENCE_ORIGIN');
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error('INVALID_EVIDENCE_LIMIT');
  const cursor = decode(options.cursor, options.origin),
    pageIssues: string[] = [];
  let items: ReturnType<typeof reviewRow>[] = [],
    nextCursor: string | undefined;
  if (options.origin === 'LIVE') {
    const page = await db.list<Record<string, unknown>>('opportunities', {
      limit,
      nextToken: cursor.token,
    });
    if (page.nextToken && page.nextToken === cursor.token)
      throw new Error('EVIDENCE_PAGINATION_STALLED');
    items = page.items.map((row) => reviewRow(row, 'LIVE', row.id));
    if (page.nextToken)
      nextCursor = encode({ v: 1, origin: 'LIVE', token: page.nextToken });
  } else {
    let stored: (ArchivePage & { id: string }) | undefined,
      nextToken = cursor.token;
    if (cursor.pageId) {
      const [record] = await db.get<ArchivePage>('evidence_pages', [
        cursor.pageId,
      ]);
      if (!record || fingerprint(record.events) !== cursor.fingerprint)
        throw new Error('EVIDENCE_PAGE_CHANGED_RESTART');
      stored = { ...record, id: cursor.pageId };
    } else {
      const page = await db.list<ArchivePage>('evidence_pages', {
        limit: 1,
        nextToken: cursor.token,
      });
      if (page.nextToken && page.nextToken === cursor.token)
        throw new Error('EVIDENCE_PAGINATION_STALLED');
      stored = page.items[0];
      nextToken = page.nextToken;
    }
    const offset = cursor.offset ?? 0;
    if (stored) {
      if (!Array.isArray(stored.events))
        pageIssues.push('MALFORMED_ARCHIVE_PAGE');
      else {
        if (offset > stored.events.length)
          throw new Error('EVIDENCE_PAGE_CHANGED_RESTART');
        items = stored.events
          .slice(offset, offset + limit)
          .map((row, i) =>
            reviewRow(
              row,
              'ARCHIVE',
              stored!.id,
              offset + i,
              stored!.sourceKey,
            ),
          );
        if (offset + items.length < stored.events.length)
          nextCursor = encode({
            v: 1,
            origin: 'ARCHIVE',
            pageId: stored.id,
            offset: offset + items.length,
            token: nextToken,
            fingerprint: fingerprint(stored.events),
          });
      }
    }
    if (!nextCursor && nextToken)
      nextCursor = encode({ v: 1, origin: 'ARCHIVE', token: nextToken });
  }
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const item of items) {
    const identity = JSON.stringify([item.sourceKey, item.externalId]);
    if (seen.has(identity)) {
      duplicateRows++;
      item.issues.push('DUPLICATE_ID_IN_PAGE');
    }
    seen.add(identity);
  }
  return {
    origin: options.origin,
    items,
    nextCursor,
    pageIssues,
    summary: {
      rows: items.length,
      needsReview: items.filter((item) => item.issues.length > 0).length,
      duplicateRows,
    },
    disclosure:
      'Stored evidence review page. Findings are advisory; originals are unchanged. Counts apply to this page. Concurrent ingestion can change pagination; this is not a frozen export.',
  };
}
