import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import { listBounded } from './data-access';
import { evidenceTimestamp, type OrganisationRole } from './domain-hardening';
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

const identity = (row: IntelligenceEvidence) => JSON.stringify([row.sourceKey, row.externalId]);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const roles = new Set<OrganisationRole>(['DELIVERY_CONTRACTOR', 'OWNER_PROPONENT', 'APPLICANT_HOLDER', 'SUPPLIER', 'OPERATOR', 'UNKNOWN']);
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function archivedEvidence(value: unknown, sourceKey: string): OperationalEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!sourceKey || row.sourceKey !== sourceKey || !text(row.externalId) || !text(row.project) || !text(row.location)) return null;
  const normal: IntelligenceEvidence = {
    sourceKey, externalId: text(row.externalId), project: text(row.project), location: text(row.location),
    company: text(row.company), description: text(row.description), value: text(row.value) || 'Not stated',
    observedAt: text(row.observedAt), sourceObservedAt: text(row.sourceObservedAt) || undefined,
    organisationRole: roles.has(row.organisationRole as OrganisationRole) ? row.organisationRole as OrganisationRole : 'UNKNOWN',
    provenance: text(row.provenance),
  };
  return { ...normal, id: 'archive-' + digest(identity(normal)), stage: 'WATCH', score: 0,
    window: 'Historical evidence; validate current status', equipment: 'Not inferred',
    action: 'Review source activity and current project status', evidenceType: 'EXPLICIT', evidenceOrigin: 'ARCHIVE' };
}

function preferred(a: OperationalEvidence, b: OperationalEvidence): OperationalEvidence {
  const dateDifference = evidenceTimestamp(a) - evidenceTimestamp(b);
  if (dateDifference) return dateDifference > 0 ? a : b;
  if (a.evidenceOrigin !== b.evidenceOrigin) return a.evidenceOrigin === 'LIVE' ? a : b;
  const stamp = (row: OperationalEvidence) => {
    const parsed = Date.parse(row.observedAt);
    return Number.isFinite(parsed) && parsed <= Date.now() ? parsed : 0;
  };
  if (stamp(a) !== stamp(b)) return stamp(a) > stamp(b) ? a : b;
  // Stable tie-breaking makes duplicate/revision ordering irrelevant.
  return JSON.stringify(a).localeCompare(JSON.stringify(b)) >= 0 ? a : b;
}

/** Bounded, read-only view. Immutable archive revisions are never rewritten here. */
export async function loadEvidenceUniverse() {
  const live = await listBounded<IntelligenceEvidence>('opportunities', { pageSize: 500, maxItems: 1500 });
  const merged = new Map<string, OperationalEvidence>();
  let duplicateRecords = 0;
  const add = (row: OperationalEvidence) => {
    const key = identity(row), previous = merged.get(key);
    if (previous) { duplicateRecords++; merged.set(key, preferred(previous, row)); }
    else merged.set(key, row);
  };
  for (const row of live.items) add({ ...row, evidenceOrigin: 'LIVE' });
  let nextToken: string | undefined;
  let archiveRecordsLoaded = 0, archivePagesRead = 0, archiveRequests = 0;
  let invalidArchiveRecords = 0, invalidArchivePages = 0, archiveTruncated = false;
  const seenTokens = new Set<string>();
  do {
    const page = await db.list<{ sourceKey: string; events: unknown }>('evidence_pages', {
      limit: Math.min(5, 20 - archivePagesRead), nextToken,
    });
    archiveRequests++;
    for (let pageIndex = 0; pageIndex < page.items.length; pageIndex++) {
      const stored = page.items[pageIndex];
      archivePagesRead++;
      if (!Array.isArray(stored.events)) { invalidArchivePages++; continue; }
      for (let index = 0; index < stored.events.length; index++) {
        if (archiveRecordsLoaded >= 1500) {
          archiveTruncated = true;
          break;
        }
        archiveRecordsLoaded++;
        const row = archivedEvidence(stored.events[index], stored.sourceKey);
        if (row) add(row); else invalidArchiveRecords++;
      }
      if (archiveTruncated || archiveRecordsLoaded >= 1500) {
        archiveTruncated ||= pageIndex + 1 < page.items.length || Boolean(page.nextToken);
        break;
      }
    }
    nextToken = page.nextToken;
    if (nextToken && seenTokens.has(nextToken)) { archiveTruncated = true; break; }
    if (nextToken) seenTokens.add(nextToken);
    if (archiveRecordsLoaded >= 1500) break;
  } while (nextToken && archivePagesRead < 20 && archiveRequests < 10);
  archiveTruncated ||= Boolean(nextToken);
  const items = [...merged.values()].sort((a, b) => evidenceTimestamp(b) - evidenceTimestamp(a) || identity(a).localeCompare(identity(b)));
  return { items, coverage: {
    loaded: items.length, truncated: live.truncated || archiveTruncated,
    pagesRead: live.pagesRead + archiveRequests, liveLoaded: live.items.length, liveTruncated: live.truncated,
    archiveRecordsLoaded, archiveUnique: items.filter(row => row.evidenceOrigin === 'ARCHIVE').length,
    archivePagesRead, archiveTruncated, duplicateRecords, invalidArchiveRecords, invalidArchivePages,
  } };
}
