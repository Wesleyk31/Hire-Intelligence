import { beforeEach, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, writes: 0, reads: 0, rejectState: false, rejectIndex: false, rejectIndexFinal: false, partialAdd: false, quota: false, throwAddAfterWrite: false }));
vi.mock('@appdeploy/sdk', () => ({
  router: (routes: unknown) => routes, requireAuth: () => 'AUTH',
  json: (body: unknown, statusCode = 200) => ({ statusCode, body: JSON.stringify(body) }),
  error: (message: string, statusCode = 500) => ({ statusCode, body: JSON.stringify({ error: message }) }),
  db: {
    list: async (table: string, options: any = {}) => {
      memory.reads++;
      const rows = memory.tables[table] || [], start = Number(options.nextToken || 0), end = start + (options.limit || 100);
      return { items: structuredClone(rows.slice(start, end)), nextToken: end < rows.length ? String(end) : undefined };
    },
    get: async (table: string, ids: string[]) => ids.map(id => structuredClone((memory.tables[table] || []).find(row => row.id === id) || null)),
    add: async (table: string, rows: any[]) => {
      memory.writes++;
      if (memory.quota && table === 'opportunities') throw Object.assign(new Error('AppDatabaseQuotaExceeded'), { statusCode: 429 });
      if (memory.throwAddAfterWrite && table === 'opportunities') {
        const id = table + '-' + (memory.tables[table] || []).length;
        (memory.tables[table] ||= []).push({ ...structuredClone(rows[0]), id });
        throw new Error('Network acknowledgement lost');
      }
      if (memory.rejectState && table === 'source_states' || memory.rejectIndex && table === 'opportunity_indexes') return rows.map(() => null);
      return rows.map((row, index) => { if (memory.partialAdd && table === 'opportunities' && index === 1) return null; const id = table + '-' + (memory.tables[table] || []).length; (memory.tables[table] ||= []).push({ ...structuredClone(row), id }); return id; });
    },
    update: async (table: string, updates: any[]) => {
      memory.writes++;
      if (memory.rejectState && table === 'source_states' || memory.rejectIndex && table === 'opportunity_indexes') return updates.map(() => false);
      if (memory.rejectIndexFinal && table === 'opportunity_indexes' && updates.every(item => !item.record.pendingAddIntent)) return updates.map(() => false);
      return updates.map(({ id, record }) => { const at = (memory.tables[table] || []).findIndex(row => row.id === id); if (at < 0) return false; memory.tables[table][at] = { ...structuredClone(record), id }; return true; });
    },
  },
}));
import { runSource, SOURCES } from '../../backend/index';
import { getEvidencePage, inspectEvidenceQuality } from '../../backend/evidence-review';
const row = (index: number, extra = {}) => ({ id: 'row-' + index, sourceKey: 'qa-source', externalId: 'stable-' + index, project: 'QA Bridge ' + index, location: 'Perth WA', company: '', description: 'Bridge approval', observedAt: '2026-09-16T00:00:00Z', sourceObservedAt: '2026-08-01', provenance: 'https://example.test/qa', ...extra });
beforeEach(() => { memory.tables = {}; memory.writes = 0; memory.reads = 0; memory.rejectState = false; memory.rejectIndex = false; memory.rejectIndexFinal = false; memory.partialAdd = false; memory.quota = false; memory.throwAddAfterWrite = false; vi.unstubAllGlobals(); });
const feed = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: [{ attributes: { objectid: 77, name: 'QA bridge', grantdate: '2026-08-01' } }] }))));
it('can page beyond 1500 current records without draining the table in one request', async () => {
  memory.tables.opportunities = Array.from({ length: 1703 }, (_, i) => row(i));
  let cursor: string | undefined, count = 0, pages = 0;
  do { const before = memory.reads; const result = await getEvidencePage({ origin: 'LIVE', cursor, limit: 200 }); expect(memory.reads - before).toBe(1); count += result.items.length; cursor = result.nextCursor; pages++; } while (cursor);
  expect(count).toBe(1703); expect(pages).toBe(9); expect(memory.writes).toBe(0);
});
it('resumes inside a legacy archive page and then reaches the next page without losing rows', async () => {
  memory.tables.evidence_pages = [{ id: 'page-a', sourceKey: 'qa-source', events: Array.from({ length: 251 }, (_, i) => row(i)) }, { id: 'page-b', sourceKey: 'qa-source', events: [row(999)] }];
  let cursor: string | undefined; const ids: string[] = [];
  do { const result = await getEvidencePage({ origin: 'ARCHIVE', cursor, limit: 100 }); ids.push(...result.items.map(item => item.externalId)); cursor = result.nextCursor; } while (cursor);
  expect(ids).toHaveLength(252); expect(new Set(ids).size).toBe(252); expect(ids.at(-1)).toBe('stable-999'); expect(memory.writes).toBe(0);
});
it('rejects a cursor bound to a different source collection before reading', async () => {
  memory.tables.opportunities = [row(1), row(2)];
  const first = await getEvidencePage({ origin: 'LIVE', limit: 1 }); const before = memory.reads;
  await expect(getEvidencePage({ origin: 'ARCHIVE', cursor: first.nextCursor })).rejects.toThrow('INVALID_EVIDENCE_CURSOR');
  expect(memory.reads).toBe(before);
});
it('reports malformed archive pages while allowing subsequent pages to be reviewed', async () => {
  memory.tables.evidence_pages = [{ id: 'bad', sourceKey: 'qa', events: null }, { id: 'good', sourceKey: 'qa-source', events: [row(1)] }];
  const first = await getEvidencePage({ origin: 'ARCHIVE' });
  expect(first.pageIssues).toContain('MALFORMED_ARCHIVE_PAGE'); expect(first.nextCursor).toBeTruthy();
  const second = await getEvidencePage({ origin: 'ARCHIVE', cursor: first.nextCursor }); expect(second.items).toHaveLength(1);
});
it('identifies legacy AEMO metadata, invalid dates and positional IDs without mutating originals', () => {
  const input = row(1, { sourceKey: 'aemo-generation-information', externalId: '0', project: 'Site Name', sourceObservedAt: '2099-01-01' });
  const before = JSON.stringify(input), issues = inspectEvidenceQuality(input);
  expect(issues).toEqual(expect.arrayContaining(['AEMO_METADATA_ROW', 'POSSIBLE_POSITIONAL_ID', 'FUTURE_SOURCE_DATE']));
  expect(JSON.stringify(input)).toBe(before);
});
it('preserves unknown dates as review findings rather than inventing activity', async () => {
  memory.tables.opportunities = [row(1, { sourceObservedAt: undefined })]; const result = await getEvidencePage({ origin: 'LIVE' });
  expect(result.items[0].issues).toContain('MISSING_SOURCE_DATE'); expect(result.items[0].sourceObservedAt).toBe('');
  expect(result.items[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
});
it('does not report source success when source-state persistence fails', async () => {
  memory.rejectState = true; feed(); await expect(runSource(SOURCES[0])).rejects.toThrow('SOURCE_STATE_SAVE_FAILED');
});
it('reports an index acknowledgement failure instead of successful ingestion', async () => {
  memory.rejectIndex = true; feed(); const result = await runSource(SOURCES[0]);
  expect(result.status).toBe('FAILED'); expect(result.message).toContain('OPPORTUNITY_INDEX_SAVE_FAILED');
});
it('propagates database quota failure instead of attempting a state write and concealing it', async () => {
  memory.quota = true; feed(); await expect(runSource(SOURCES[0])).rejects.toThrow('AppDatabaseQuotaExceeded');
  expect(memory.tables.source_states || []).toHaveLength(0);
});
it('records source timing, source-date completeness and duplicate count', async () => {
  feed(); const result = await runSource(SOURCES[0]);
  expect(result).toMatchObject({ status: 'SUCCESS', datedRecords: 1, undatedRecords: 0, duplicateRecords: 0 });
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
});

it('flags numeric serial and impossible calendar activity dates instead of treating them as unknown or valid', () => {
  expect(inspectEvidenceQuality(row(1, { sourceObservedAt: 46200 }))).toContain('INVALID_SOURCE_DATE');
  expect(inspectEvidenceQuality(row(1, { sourceObservedAt: '2026-02-31' }))).toContain('INVALID_SOURCE_DATE');
});

it('retains provider quality flags as findings even on a complete dated record',async()=>{
  const input=row(1,{qualityFlags:['NATURAL_ID_REVIEW_REQUIRED','NATURAL_ID_REVIEW_REQUIRED',42]});
  memory.tables.opportunities=[input];
  const result=await getEvidencePage({origin:'LIVE'});
  expect(result.items[0].issues).toContain('NATURAL_ID_REVIEW_REQUIRED');
  expect(result.items[0].issues.filter(issue=>issue==='NATURAL_ID_REVIEW_REQUIRED')).toHaveLength(1);
  expect(result.summary.needsReview).toBe(1);
});
it('rejects a changed archive page when resuming inside it',async()=>{
  memory.tables.evidence_pages=[{id:'changing',sourceKey:'qa-source',events:[row(1),row(2),row(3)]}];
  const first=await getEvidencePage({origin:'ARCHIVE',limit:1});
  memory.tables.evidence_pages[0].events.shift();
  await expect(getEvidencePage({origin:'ARCHIVE',cursor:first.nextCursor,limit:1})).rejects.toThrow('EVIDENCE_PAGE_CHANGED_RESTART');
});

it('stops a retry after a final index acknowledgement failure instead of duplicating inserted records', async () => {
  memory.tables.opportunity_indexes = [{ id: 'existing-index', sourceKey: SOURCES[0].key, ids: {} }];
  memory.rejectIndexFinal = true; feed();
  const first = await runSource(SOURCES[0]);
  expect(first.status).toBe('FAILED');
  expect(memory.tables.opportunities).toHaveLength(1);
  memory.rejectIndexFinal = false;
  const retry = await runSource(SOURCES[0]);
  expect(retry.status).toBe('FAILED');
  expect(retry.message).toContain('RECONCILIATION_REQUIRED');
  expect(memory.tables.opportunities).toHaveLength(1);
  expect(memory.tables.opportunity_indexes[0].pendingAddIntent.externalIds).toHaveLength(1);
});

it('requires an acknowledged index intent before inserting the first opportunity', async () => {
  memory.rejectIndex = true; feed();
  const result = await runSource(SOURCES[0]);
  expect(result.status).toBe('FAILED');
  expect(memory.tables.opportunities || []).toHaveLength(0);
});

it('retains the insertion intent when only part of an add batch is acknowledged', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: [77, 78].map(objectid => ({ attributes: { objectid, name: 'QA bridge ' + objectid, grantdate: '2026-08-01' } })) }))));
  memory.partialAdd = true;
  const first = await runSource(SOURCES[0]);
  expect(first.status).toBe('FAILED');
  expect(memory.tables.opportunities).toHaveLength(1);
  expect(memory.tables.opportunity_indexes[0].pendingAddIntent.externalIds).toHaveLength(2);
  memory.partialAdd = false;
  const retry = await runSource(SOURCES[0]);
  expect(retry.message).toContain('RECONCILIATION_REQUIRED');
  expect(memory.tables.opportunities).toHaveLength(1);
});

it('requires reconciliation when legacy index discovery reaches its bounded scan limit', async () => {
  memory.tables.opportunities = Array.from({ length: 1001 }, (_, i) => row(i)); feed();
  const result = await runSource(SOURCES[0]);
  expect(result.status).toBe('FAILED');
  expect(result.message).toContain('OPPORTUNITY_INDEX_RECONCILIATION_REQUIRED');
  expect(memory.tables.opportunities).toHaveLength(1001);
  expect(memory.tables.opportunity_indexes || []).toHaveLength(0);
});
it('keeps the intent after an opportunity quota error and blocks a later blind retry', async () => {
  memory.quota = true; feed();
  await expect(runSource(SOURCES[0])).rejects.toThrow('AppDatabaseQuotaExceeded');
  expect(memory.tables.opportunity_indexes[0].pendingAddIntent.externalIds).toHaveLength(1);
  memory.quota = false;
  const retry = await runSource(SOURCES[0]);
  expect(retry.message).toContain('OPPORTUNITY_PENDING_ADDS_RECONCILIATION_REQUIRED');
  expect(memory.tables.opportunities || []).toHaveLength(0);
});

it('clears an acknowledged intent and updates the same physical record on the next refresh', async () => {
  feed();
  expect((await runSource(SOURCES[0])).status).toBe('SUCCESS');
  expect(memory.tables.opportunity_indexes[0]).not.toHaveProperty('pendingAddIntent');
  expect((await runSource(SOURCES[0])).status).toBe('SUCCESS');
  expect(memory.tables.opportunities).toHaveLength(1);
});
it('retains acknowledged updates and discloses uncertainty when a later insert writes then throws', async () => {
  const source = SOURCES[0];
  memory.tables.opportunities = [row(77, { id: 'already-stored', sourceKey: source.key, externalId: '77' })];
  memory.tables.opportunity_indexes = [{ id: 'existing-index', sourceKey: source.key, ids: { '77': 'already-stored' } }];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: [77, 78].map(objectid => ({ attributes: { objectid, name: 'QA bridge ' + objectid, grantdate: '2026-08-01' } })) }))));
  memory.throwAddAfterWrite = true;
  const result = await runSource(source);
  expect(memory.tables.opportunities).toHaveLength(2);
  expect(memory.tables.opportunities.find(item => item.id === 'already-stored').project).toBe('QA bridge 77');
  expect(result).toMatchObject({ status: 'FAILED', recordsFetched: 2, opportunitiesPromoted: 1, persistenceUncertain: true });
  expect(result.message).toContain('Network acknowledgement lost');
  expect(result.message).toContain('reconciliation');
  expect(memory.tables.opportunity_indexes[0].pendingAddIntent.externalIds).toEqual(['78']);
  memory.throwAddAfterWrite = false;
  const retry = await runSource(source);
  expect(retry.message).toContain('OPPORTUNITY_PENDING_ADDS_RECONCILIATION_REQUIRED');
  expect(memory.tables.opportunities).toHaveLength(2);
});
