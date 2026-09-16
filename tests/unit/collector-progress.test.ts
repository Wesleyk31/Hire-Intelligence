import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, archiveWrites: 0, failArchive: false }));
vi.mock('@appdeploy/sdk', () => ({ db: {
  list: async (table: string) => ({ items: structuredClone(memory.tables[table] || []) }),
  add: async (table: string, rows: any[]) => {
    if (table === 'evidence_pages') { memory.archiveWrites++; if (memory.failArchive) return rows.map(() => null); }
    return rows.map(row => { const id = table + ':' + (memory.tables[table] || []).length; (memory.tables[table] ||= []).push({ ...structuredClone(row), id }); return id; });
  },
  update: async (table: string, updates: any[]) => updates.map(({ id, record }) => { const index = (memory.tables[table] || []).findIndex(row => row.id === id); if (index < 0) return false; memory.tables[table][index] = { ...structuredClone(record), id }; return true; }),
} }));
import { collectBackfillPage } from '../../backend/backfill-fetch';
import { runBackfillBatch } from '../../backend/backfill';
import { normalizeLoganApplications } from '../../backend/source-pilots';

const source = (method: string, key = 'synthetic-source') => ({ key, method, endpoint: 'https://example.test/source', territory: 'WA', provenance: 'Synthetic test fixture' });
const respond = (body: unknown) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body)));
beforeEach(() => { memory.tables = {}; memory.archiveWrites = 0; memory.failArchive = false; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('explicit continuation metadata', () => {
  it('continues a short ArcGIS page carrying exceededTransferLimit', async () => {
    respond({ features: [{ attributes: { OBJECTID: 1, name: 'Synthetic bridge' } }], exceededTransferLimit: true });
    expect(await collectBackfillPage(source('ARCGIS'), 0)).toMatchObject({ next: 1, completed: false });
  });
  it.each(['CKAN_DATASTORE', 'OPENDATASOFT', 'CKAN_PACKAGE'])('continues %s until its declared total is reached', async method => {
    const row = { id: 'one', name: 'Synthetic bridge' };
    respond(method === 'OPENDATASOFT' ? { results: [row], total_count: 250 } : { success: true, result: { records: [row], total: 250 } });
    const context = method === 'CKAN_PACKAGE' ? { ckanResource: { id: 'pinned', datastore_active: true } } : undefined;
    expect(await collectBackfillPage(source(method), 0, undefined, context)).toMatchObject({ next: 1, completed: false });
    expect(await collectBackfillPage(source(method), 249, undefined, context)).toMatchObject({ next: 250, completed: true });
  });
  it.each(['ARCGIS', 'CKAN_DATASTORE', 'OPENDATASOFT'])('rejects a zero-progress %s response that still declares more data', async method => {
    respond(method === 'ARCGIS' ? { features: [], exceededTransferLimit: true } : method === 'OPENDATASOFT' ? { results: [], total_count: 250 } : { success: true, result: { records: [], total: 250 } });
    await expect(collectBackfillPage(source(method), 0)).rejects.toThrow(/NO_PROGRESS/);
  });
  it.each(['CKAN_DATASTORE', 'OPENDATASOFT'])('rejects an invalid %s total instead of claiming completion', async method => {
    respond(method === 'OPENDATASOFT' ? { results: [], total_count: 'invalid' } : { success: true, result: { records: [], total: -1 } });
    await expect(collectBackfillPage(source(method), 0)).rejects.toThrow(/TOTAL_INVALID/);
  });
});

describe('WFS progress before archival', () => {
  const wfs = source('WFS_DIRECT', 'nsw-current-mining-titles');
  const feature = (id: number, extra = {}) => ({ properties: { tas_id: id, name: 'Synthetic title ' + id, ...extra } });
  it('rejects a repeated page after loading its persisted checkpoint without writing it again', async () => {
    respond({ features: [feature(64)], numberMatched: 2 });
    const first = await runBackfillBatch([wfs]);
    expect(first.lastError).toBe('');
    expect(memory.tables.backfill_cursors[0].cursor).toBe(1);
    expect(memory.archiveWrites).toBe(1);
    const second = await runBackfillBatch([wfs]);
    expect(second.lastError).toMatch(/WFS_(PAGE_REPEATED|SORT_BOUNDARY)/);
    expect(memory.archiveWrites).toBe(1);
    expect(memory.tables.backfill_cursors[0]).toMatchObject({ cursor: 1, completed: false, processed: 1 });
  });
  it('accepts increasing pages and advances by raw features when multipart source identities repeat', async () => {
    const sa = source('WFS_DIRECT', 'sa-mining-projects');
    vi.stubGlobal('fetch', async (input: string) => {
      const offset = Number(new URL(input).searchParams.get('startIndex'));
      const features = offset === 0 ? [{ properties: { SITE_NO: 55, OBJECTID: 1, name: 'Synthetic mine' } }, { properties: { SITE_NO: 55, OBJECTID: 2, name: 'Synthetic mine' } }] : [{ properties: { SITE_NO: 56, OBJECTID: 3, name: 'Synthetic second mine' } }];
      return new Response(JSON.stringify({ features, numberMatched: 3 }));
    });
    const first = await collectBackfillPage(sa, 0);
    expect(first).toMatchObject({ next: 2, completed: false });
    expect(first.rows).toHaveLength(1);
    const second = await collectBackfillPage(sa, first.next, undefined, first.context);
    expect(second).toMatchObject({ next: 3, completed: true });
    expect(second.rows[0].externalId).toBe('sa-mining-projects:56');
  });
  it('rejects backward sort boundaries even when the repeated content has changed', async () => {
    respond({ features: [feature(10), feature(20)], numberMatched: 4 });
    const first = await collectBackfillPage(wfs, 0);
    respond({ features: [feature(10, { name: 'Changed after collection' }), feature(30)], numberMatched: 4 });
    await expect(collectBackfillPage(wfs, 2, undefined, first.context)).rejects.toThrow('WFS_SORT_BOUNDARY');
  });
  it('binds the checkpoint to its selected layer and offset', async () => {
    respond({ features: [feature(10)], numberMatched: 3 });
    const first = await collectBackfillPage(wfs, 0);
    await expect(collectBackfillPage(wfs, 2, undefined, first.context)).rejects.toThrow('WFS_CHECKPOINT_OFFSET');
    const other = source('WFS_DIRECT', 'nsw-mining-title-applications');
    await expect(collectBackfillPage(other, 1, undefined, first.context)).rejects.toThrow('WFS_CHECKPOINT_SOURCE');
  });
  it('requires an explicit review/restart for a legacy positive cursor with no WFS checkpoint', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(collectBackfillPage(wfs, 100)).rejects.toThrow('WFS_CHECKPOINT_REQUIRED_RESTART');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the same generic layer pinned if its first archive write fails', async () => {
    const generic = source('WFS');
    let selected = 'layer:first'; const requestedLayers: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get('request') === 'GetCapabilities') return new Response(`<WFS_Capabilities><FeatureType><Name>${selected}</Name></FeatureType></WFS_Capabilities>`);
      requestedLayers.push(url.searchParams.get('typeName') || url.searchParams.get('typeNames') || '');
      return new Response(JSON.stringify({ features: [{ id: 'feature-one', properties: { name: 'Synthetic mine' } }], numberMatched: 1 }));
    });
    memory.failArchive = true; await runBackfillBatch([generic]);
    selected = 'layer:second'; memory.failArchive = false; await runBackfillBatch([generic]);
    expect(requestedLayers).toEqual(['layer:first', 'layer:first']);
    expect(memory.tables.backfill_cursors[0].completed).toBe(true);
  });
});

it('retains every Logan parcel locality deterministically when application rows merge', () => {
  const a = { OBJECTID: 1, Application_System_ID: 3553768, Application_Number: 'MCUC/127/2026', Application_Amendment: null, Application_Description: 'Warehouse', Application_Status: 'Pending Confirmation Notice', Application_Lodgement_Date: 1789084800000, Application_Applicant: 'Synthetic Applicant', Application_Property_Key: 1, Application_Property_Lot_Plan: 'LOT/1', Application_Property_Suburb: 'SLACKS CREEK', PDonline_Link: 'https://devet.loganhub.com.au/#/applications/MCUC-127-2026', fme_rejection_code: null };
  const b = { ...a, OBJECTID: 2, Application_Property_Key: 2, Application_Property_Suburb: 'SPRINGWOOD' };
  const context = { retrievedAt: '2026-09-16T00:00:00Z' };
  const forward = normalizeLoganApplications([a, b], context), reverse = normalizeLoganApplications([b, a], context);
  expect(forward.evidence[0].location).toBe('SLACKS CREEK; SPRINGWOOD');
  expect(reverse.evidence[0].location).toBe(forward.evidence[0].location);
  expect((forward.evidence[0] as any).localities).toEqual(['SLACKS CREEK', 'SPRINGWOOD']);
  expect(forward.evidence[0].qualityFlags).toContain('MULTIPLE_PARCEL_LOCALITIES');
  expect(forward.evidence[0].promotionEligible).toBe(false);
});

describe('collector boundary cases', () => {
  it('uses an ArcGIS total even when the provider caps a page below the requested size', async () => {
    respond({ features: [{ attributes: { OBJECTID: 1 } }], total: '3' });
    expect(await collectBackfillPage(source('ARCGIS'), 0)).toMatchObject({ next: 1, completed: false });
  });
  it('honours an explicit ArcGIS final page even when it fills the requested size', async () => {
    respond({ features: Array.from({ length: 100 }, (_, index) => ({ attributes: { OBJECTID: index + 1 } })), exceededTransferLimit: false });
    expect(await collectBackfillPage(source('ARCGIS'), 0)).toMatchObject({ next: 100, completed: true });
  });
  it('rejects contradictory ArcGIS continuation metadata', async () => {
    respond({ features: [{ attributes: { OBJECTID: 1 } }], total: 3, exceededTransferLimit: false });
    await expect(collectBackfillPage(source('ARCGIS'), 0)).rejects.toThrow('ARCGIS_TOTAL_CONTRADICTION');
  });
  it.each(['CKAN_DATASTORE', 'OPENDATASOFT', 'CKAN_PACKAGE'])('retains the short-page fallback when %s has no total', async method => {
    respond(method === 'OPENDATASOFT' ? { results: [{ id: 'one' }] } : { success: true, result: { records: [{ id: 'one' }] } });
    const context = method === 'CKAN_PACKAGE' ? { ckanResource: { id: 'pinned', datastore_active: true } } : undefined;
    expect(await collectBackfillPage(source(method), 0, undefined, context)).toMatchObject({ next: 1, completed: true });
  });
  it('binds subsequent WFS requests to the same endpoint and filter', async () => {
    const wfs = source('WFS_DIRECT', 'nsw-current-mining-titles');
    respond({ features: [{ properties: { tas_id: 1 } }], numberMatched: 2 });
    const first = await collectBackfillPage(wfs, 0);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(collectBackfillPage({ ...wfs, endpoint: wfs.endpoint + '?CQL_FILTER=changed' }, 1, undefined, first.context)).rejects.toThrow('WFS_CHECKPOINT_REQUEST');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not let generated WFS feature IDs disguise a repeated raw page', async () => {
    const wfs = source('WFS_DIRECT', 'sa-mining-projects');
    respond({ features: [{ id: 'generated.first', properties: { SITE_NO: 1, OBJECTID: 12 } }], numberMatched: 2 });
    const first = await collectBackfillPage(wfs, 0);
    respond({ features: [{ id: 'generated.second', properties: { OBJECTID: 12, SITE_NO: 1 } }], numberMatched: 2 });
    await expect(collectBackfillPage(wfs, 1, undefined, first.context)).rejects.toThrow('WFS_PAGE_REPEATED');
  });
  it('rejects a provider that ignores ascending WFS sort order within its first page', async () => {
    respond({ features: [{ properties: { tas_id: 20 } }, { properties: { tas_id: 10 } }], numberMatched: 2 });
    await expect(collectBackfillPage(source('WFS_DIRECT', 'nsw-current-mining-titles'), 0)).rejects.toThrow('WFS_SORT_BOUNDARY');
  });
  it('keeps multipart evidence at an equal domain sort boundary while advancing raw offsets', async () => {
    const wfs = source('WFS_DIRECT', 'nsw-current-mining-titles');
    respond({ features: [{ properties: { tas_id: 12, OBJECTID: 1 } }], numberMatched: 2 });
    const first = await collectBackfillPage(wfs, 0);
    respond({ features: [{ properties: { tas_id: 12, OBJECTID: 2 } }], numberMatched: 2 });
    const second = await collectBackfillPage(wfs, 1, undefined, first.context);
    expect(second).toMatchObject({ next: 2, completed: true });
    expect(second.rows[0].externalId).toBe(first.rows[0].externalId);
  });
});
