import { afterEach, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { collect, runSource, SOURCES, type SourceDef } from '../../backend/index';
import { db } from '@appdeploy/sdk';
import { runBackfillBatch } from '../../backend/backfill';
import { collectBackfillPage } from '../../backend/backfill-fetch';

const source = (key: string) => SOURCES.find(item => item.key === key)!;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const workbook = (sheets: Record<string, unknown[][]>) => {
  const book = utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) utils.book_append_sheet(book, utils.aoa_to_sheet(rows), name);
  return new Response(write(book, { type: 'buffer', bookType: 'xlsx' }), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('reads AEMO generator data rather than the background field dictionary in both paths', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => workbook({
    'Background Information': [['Site Name', 'Site Name of the generation project'], ['Unit Name', 'Name of each unit']],
    'Generator Information': [['Public data'], [], [], ['Site Name', 'Site Owner', 'Region', 'Gen Info Unit ID', 'Commitment Status', 'Survey Latest Update Date'], ['QA Solar', 'QA Owner', 'NSW1', 4201, 'Committed', 46200]],
  })));
  const s = source('aemo-generation-information');
  const live = await collect(s); const backfill = await collectBackfillPage(s, 0);
  expect(live.opportunities).toHaveLength(1);
  expect(live.opportunities[0]).toMatchObject({ project: 'QA Solar', externalId: '4201' });
  expect(live.opportunities[0].sourceObservedAt).toMatch(/^2026-/);
  expect(backfill.rows[0].externalId).toBe('4201');
  expect(backfill.rows).toHaveLength(1);
});

it('uses exact KCI identity and site fields and retains the newest update for a project', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => workbook({ 'Q2 2026 KCI': [
    ['TNSP Name', 'TNSP Connection Enquiry / Application ID', 'KCI datafile compilation date time stamp', 'Site Name', 'Organisation Name', 'AEMO KCI ID'],
    ['QA Network', 'enquiry-1', 202601011600, 'QA Wind', 'QA Company', 'N00001'],
    ['QA Network', 'enquiry-1', 202607011600, 'QA Wind updated', 'QA Company', 'N00001'],
    ['QA Network', 'enquiry-2', 202607011600, 'QA Storage', 'QA Company', 'N00002'],
  ] })));
  const s = source('aemo-key-connection-information'); const live = await collect(s); const backfill = await collectBackfillPage(s, 0);
  expect(live.opportunities.map(o => o.externalId)).toEqual(['N00001', 'N00002']);
  expect(live.opportunities.map(o => o.project)).toEqual(['QA Wind updated', 'QA Storage']);
  expect(backfill.rows.map(o => o.externalId)).toEqual(['N00001', 'N00001', 'N00002']);
});

it('selects the same latest-created CKAN resource when bulk edits changed older modified dates', async () => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    requests.push(String(url));
    if (String(url).includes('package_show')) return json({ success: true, result: { resources: [
      { id: 'new', name: 'July 2026', created: '2026-08-01', last_modified: '2026-09-15T00:00:00.001', datastore_active: true },
      { id: 'old', name: '2024', created: '2025-01-01', last_modified: '2026-09-15T00:00:00.002', datastore_active: true },
    ] } });
    return json({ success: true, result: { records: [{ _id: 1, 'Contract description/name': 'QA bridge' }], total: 1 } });
  }));
  const s = source('qld-granted-resource-authorities'); await collect(s); await collectBackfillPage(s, 0);
  expect(requests.filter(url => url.includes('datastore_search'))).toHaveLength(2);
  expect(requests.filter(url => url.includes('datastore_search')).every(url => url.includes('resource_id=new'))).toBe(true);
});

it('rejects empty HTTP202 workbook responses rather than reporting successful ingestion', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).includes('package_show')
    ? json({ success: true, result: { resources: [{ id: 'qa', format: 'XLSX', url: 'https://example.test/qa.xlsx', created: '2026-09-01' }] } })
    : new Response(null, { status: 202, headers: { 'content-type': 'text/html' } })));
  await expect(collect(source('qld-granted-resource-authorities'))).rejects.toThrow(/202|WORKBOOK|XLSX/);
  await expect(collectBackfillPage(source('qld-granted-resource-authorities'), 0)).rejects.toThrow(/202|WORKBOOK|XLSX/);
});

it('accepts WFS feature types carrying namespace attributes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => String(url).includes('GetCapabilities')
    ? new Response('<wfs:WFS_Capabilities><FeatureType xmlns:mine="https://example.test"><Name>mine:projects</Name><Title>Major mines</Title></FeatureType></wfs:WFS_Capabilities>')
    : json({ features: [{ id: 'mine.1', properties: { name: 'QA mine' } }] })));
  const s = source('sa-mining-projects');
  expect((await collect(s)).opportunities).toHaveLength(1);
  expect((await collectBackfillPage(s, 0)).rows).toHaveLength(1);
});

it('uses published lowercase ArcGIS object identity instead of row position', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ features: [{ attributes: { objectid: 9821, name: 'QA works' } }] })));
  const s = source('wa-mining-tenements');
  expect((await collect(s)).opportunities[0].externalId).toBe('9821');
  expect((await collectBackfillPage(s, 0)).rows[0].externalId).toBe('9821');
});

it('catalogue-only resources do not count as fetched project records', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ success: true, result: { resources: [{ id: 'metadata', format: 'PDF', name: 'Annual report', url: 'https://example.test/report.pdf' }] } })));
  const result = await collect(source('qld-granted-resource-authorities'));
  expect(result.opportunities).toHaveLength(0);
  expect(result.recordsFetched).toBe(0);
});

it('keeps the request deadline active while waiting for a response body', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(new Error('BODY_ABORTED'))); } }))));
  const pending = collect(source('wa-mining-tenements'));
  const expectation = expect(pending).rejects.toThrow(/ABORT|TIMEOUT/);
  await vi.advanceTimersByTimeAsync(20001);
  await expectation;
});

it('keeps AusTender in the same date window until its published next page is read', async () => {
  const s = source('austender-contract-notices');
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input); requests.push(url);
    return json({ releases: [{ id: url.includes('cursor=page-2') ? 'release-2' : 'release-1', tender: { title: 'QA public works' } }], links: url.includes('cursor=page-2') ? {} : { next: url + '?cursor=page-2' } });
  }));
  const first = await collectBackfillPage(s, 0);
  expect(first.next).toBe(0);
  expect(first.nextUrl).toContain('cursor=page-2');
  const second = await collectBackfillPage(s, first.next, first.nextUrl);
  expect(second.next).toBe(7);
  expect(second.nextUrl).toBeUndefined();
  expect(second.rows[0].externalId).toBe('release-2');
  expect(requests[1]).toBe(first.nextUrl);
});

it('rejects an AusTender pagination link outside the configured provider path', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ releases: [{ id: 'qa' }], links: { next: 'https://example.test/collect' } })));
  await expect(collectBackfillPage(source('austender-contract-notices'), 0)).rejects.toThrow(/OCDS.*URL|OCDS.*LINK/);
});

it('rejects unsupported backfill methods instead of marking an unprocessed source complete', async () => {
  await expect(collectBackfillPage({ ...source('wa-mining-tenements'), method: 'UNSUPPORTED' }, 0)).rejects.toThrow(/UNSUPPORTED/);
});


it('degrades a source when storage only acknowledges part of the fetched records', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ features: [{ attributes: { objectid: 1, name: 'QA bridge' } }, { attributes: { objectid: 2, name: 'QA road' } }] })));
  vi.spyOn(db, 'list').mockResolvedValue({ items: [] });
  vi.spyOn(db, 'add').mockImplementation(async (table: string) => table === 'opportunities' ? ['saved-one', null] : ['saved-state']);
  const state = await runSource(source('wa-mining-tenements'));
  expect(state.recordsFetched).toBe(2);
  expect(state.opportunitiesPromoted).toBe(1);
  expect(state.status).toBe('DEGRADED');
  expect(state.message).toMatch(/persist|stor|saved/i);
});

it('persists the provider next page between separate historical scheduler batches', async () => {
  const tables: Record<string, any[]> = {};
  vi.spyOn(db, 'list').mockImplementation(async (table: string) => ({ items: tables[table] || [] }));
  vi.spyOn(db, 'add').mockImplementation(async (table: string, records: any[]) => records.map(record => { const id = String((tables[table] || []).length + 1); (tables[table] ||= []).push({ ...record, id }); return id; }));
  vi.spyOn(db, 'update').mockImplementation(async (table: string, updates: any[]) => updates.map(update => { const found = tables[table].find(row => row.id === update.id); Object.assign(found, update.record); return true; }));
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => { const url = String(input); return json({ releases: [{ id: url.includes('cursor=second') ? 'two' : 'one' }], links: url.includes('cursor=second') ? {} : { next: url + '?cursor=second' } }); }));
  await runBackfillBatch([source('austender-contract-notices')]);
  expect(tables.backfill_cursors[0].nextUrl).toContain('cursor=second');
  expect(tables.backfill_cursors[0].cursor).toBe(0);
  await runBackfillBatch([source('austender-contract-notices')]);
  expect(tables.backfill_cursors[0]).toMatchObject({ cursor: 7, nextUrl: '', processed: 2 });
  expect(tables.evidence_pages.map(row => row.events[0].externalId)).toEqual(['one', 'two']);
});

it('cancels an oversized streaming response before consuming an unbounded body', async () => {
  vi.useFakeTimers(); const cancelled = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(26 * 1024 * 1024)); init.signal?.addEventListener('abort', () => controller.error(new Error('BODY_ABORTED'))); }, cancel: cancelled,
  }))));
  const expectation = expect(collect(source('wa-mining-tenements'))).rejects.toThrow('SOURCE_BODY_TOO_LARGE');
  await vi.advanceTimersByTimeAsync(20001);
  await expectation;
  expect(cancelled).toHaveBeenCalled();
});

it('rejects an excessive published content length before reading the response body', async () => {
  vi.useFakeTimers(); const cancelled = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
    start(controller) { init.signal?.addEventListener('abort', () => controller.error(new Error('BODY_ABORTED'))); }, cancel: cancelled,
  }), { headers: { 'content-length': String(30 * 1024 * 1024) } })));
  const expectation = expect(collect(source('wa-mining-tenements'))).rejects.toThrow('SOURCE_BODY_TOO_LARGE');
  await vi.advanceTimersByTimeAsync(20001); await expectation;
  expect(cancelled).toHaveBeenCalled();
});

it('excludes future issue dates from the latest Melbourne permit request', async () => {
  const fetcher = vi.fn(async () => json({ results: [{ council_ref: 'qa-ref', permit_number: 'qa-permit', issue_date: '2026-09-09', desc_of_works: 'QA building work' }] }));
  vi.stubGlobal('fetch', fetcher);
  await collect(source('melbourne-building-permits'));
  expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('where')).toContain('issue_date <= now()');
});

it('retains an AusTender anchor when pagination spans multiple scheduler days', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => { const url = String(input); requests.push(url); return json({ releases: [{ id: 'qa' }], links: url.includes('cursor=last') ? {} : { next: url + '?cursor=last' } }); }));
  const s = source('austender-contract-notices');
  const first = await collectBackfillPage(s, 0);
  vi.setSystemTime(new Date('2026-09-23T00:00:00Z'));
  const second = await collectBackfillPage(s, first.next, first.nextUrl, first.context);
  await collectBackfillPage(s, second.next, second.nextUrl, second.context);
  expect(requests[2]).toContain('/2026-09-02T00:00:00Z/2026-09-09T00:00:00Z');
});

it('pins a CKAN resource while consuming its remaining offsets', async () => {
  let packages = 0; const resourceIds: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.includes('package_show')) { packages++; return json({ success: true, result: { resources: [{ id: packages === 1 ? 'original' : 'new-publication', datastore_active: true, created: '2026-09-01' }] } }); }
    resourceIds.push(url.searchParams.get('resource_id') || '');
    const offset = Number(url.searchParams.get('offset')); const length = offset ? 5 : 100;
    return json({ success: true, result: { records: Array.from({ length }, (_, i) => ({ _id: offset + i + 1, title: 'QA work' })), total: 105 } });
  }));
  const s = source('qld-granted-resource-authorities');
  const first = await collectBackfillPage(s, 0);
  const second = await collectBackfillPage(s, first.next, first.nextUrl, first.context);
  expect(resourceIds).toEqual(['original', 'original']);
  expect(second.completed).toBe(true);
});
