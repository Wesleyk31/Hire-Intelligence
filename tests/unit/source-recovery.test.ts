import { afterEach, describe, expect, it, vi } from 'vitest';
import { utils } from 'xlsx';
import { collectBackfillPage, normalizeEvidence } from '../../backend/backfill-fetch';
import { projectWorkbookRows, projectRecordIdentity, sourceWfsRows, sourceWfsPage, wfsPageUrl } from '../../backend/source-helpers';

afterEach(() => vi.unstubAllGlobals());
const feature = (properties: Record<string, unknown>, id = 'generated.fid-one') => ({ id, properties });

describe('recovered WFS stable identity', () => {
  it('ignores changing GeoServer feature IDs and OBJECTIDs for SA domain references', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['sa-mining-projects', { SITE_NO: 1123158, PROJECT_NAME: 'Mine A' }, 'sa-mining-projects:1123158'],
      ['sa-mineral-tenements', { FILE_REFERENCE: 'ELA-01221', APPLICATION_TYPE: 'ELA' }, 'sa-mineral-tenements:ela:ela-01221'],
      ['sa-petroleum-tenements', { FILE_REFERENCE: 'MER-2026/0011', TENEMENT_NO: 'AALA 341' }, 'sa-petroleum-tenements:aala%20341'],
    ];
    for (const [key, props, expected] of cases) {
      const first = sourceWfsRows(key, [feature({ ...props, OBJECTID: 1 })]);
      const second = sourceWfsRows(key, [feature({ ...props, OBJECTID: 999 }, 'different.fid-two')]);
      expect(first[0].externalId).toBe(expected);
      expect(second[0].externalId).toBe(expected);
    }
  });
  it('uses NSW tas_id and occurrence_id before transport IDs', () => {
    expect(sourceWfsRows('nsw-current-mining-titles', [feature({ tas_id: 64, title: 'PL(MP)L1043' })])[0].externalId).toBe('nsw-current-mining-titles:64');
    expect(sourceWfsRows('nsw-mining-title-applications', [feature({ tas_id: 21827, application: 'MLA218' })])[0].externalId).toBe('nsw-mining-title-applications:21827');
    expect(sourceWfsRows('nsw-major-operating-mines', [feature({ occurrence_id: 101625, deposit_name: 'Endeavor' })])[0].externalId).toBe('nsw-major-operating-mines:101625');
  });
  it('rejects missing publisher IDs instead of generating positional or mutable feature IDs', () => {
    expect(() => sourceWfsRows('sa-mining-projects', [feature({ OBJECTID: 1 })])).toThrow('WFS_STABLE_ID_MISSING');
    expect(() => sourceWfsRows('nsw-major-operating-mines', [feature({ deposit_name: 'Mine' })])).toThrow('WFS_STABLE_ID_MISSING');
  });
  it('flags SA power natural identity for review and rejects collisions', () => {
    const props = { STATION_NAME: 'MegaLink BESS', SUBURB: 'Town', TECHNOLOGY: 'Battery' };
    const first = sourceWfsRows('sa-power-generation', [feature(props)])[0];
    const second = sourceWfsRows('sa-power-generation', [feature({ ...props, COLLECTION_DATE: '2026-09-15' }, 'changed')])[0];
    expect(first.externalId).toBe('sa-power-generation:megalink%20bess:town:battery');
    expect(second.externalId).toBe(first.externalId);
    expect(first.qualityFlags).toContain('NATURAL_ID_REVIEW_REQUIRED');
    expect(() => sourceWfsRows('sa-power-generation', [feature(props), feature({ ...props, OWNER_DEVELOPER: 'Conflicting owner' })])).toThrow('WFS_IDENTITY_COLLISION');
  });
  it('pins a known layer and rejects a conflicting configured layer', () => {
    const source = { key: 'sa-mining-projects', endpoint: 'https://services.sarig.sa.gov.au/vector/south_australia_mining_projects/wfs' };
    const url = new URL(wfsPageUrl(source, 3, 3));
    expect(url.searchParams.get('typeNames')).toBe('south_australia_mining_projects:major_mines___minerals');
    expect(url.searchParams.get('sortBy')).toBe('OBJECTID');
    expect(url.searchParams.get('startIndex')).toBe('3');
    expect(() => wfsPageUrl({ ...source, endpoint: source.endpoint + '?typeNames=unrelated:layer' }, 0, 3)).toThrow('WFS_PINNED_LAYER_MISMATCH');
  });
  it('keeps the transport cursor independent of deduplicated rows', async () => {
    const source = { key: 'sa-mining-projects', endpoint: 'https://example.test/wfs' };
    const page = await sourceWfsPage(source, 10, 3, async () => ({
      features: [feature({ SITE_NO: 1, OBJECTID: 1 }), feature({ SITE_NO: 1, OBJECTID: 2 }), feature({ SITE_NO: 2 })], numberMatched: 20,
    }));
    expect(page.rows).toHaveLength(2);
    expect(page.next).toBe(13);
    expect(page.completed).toBe(false);
  });
  it('routes backfill through the same pinned, stable-ID path', async () => {
    const source = { key: 'sa-mining-projects', method: 'WFS', endpoint: 'https://example.test/wfs', territory: 'SA', provenance: 'https://example.test/catalogue' };
    vi.stubGlobal('fetch', async (value: string) => {
      const url = new URL(value);
      if (url.searchParams.get('request') === 'GetCapabilities') return new Response('<WFS_Capabilities><FeatureType><Name>wrong:first</Name></FeatureType></WFS_Capabilities>');
      return new Response(JSON.stringify({ features: [feature({ SITE_NO: 55, PROJECT_NAME: 'Mine A' })], numberMatched: 1 }), { headers: { 'content-type': 'application/json' } });
    });
    const page = await collectBackfillPage(source, 0);
    expect(page.rows[0].externalId).toBe('sa-mining-projects:55');
    expect(page.completed).toBe(true);
  });
});

describe('national major projects workbook', () => {
  const workbook = () => {
    const book = utils.book_new();
    const header = ['Project', 'Company', 'State', 'Status', 'Cost Estimate $Am', 'Estimated Start Commercial Operation'];
    utils.book_append_sheet(book, utils.aoa_to_sheet([header, ['Alpha Mine', 'Owner', 'WA', 'Committed', 78, 2027], ['Alpha Mine', 'Owner', 'WA', 'Committed', '78', '2027'], ['Beta Mine', 'Owner', 'QLD', 'Completed', 100, 2025]]), 'Consolidated');
    utils.book_append_sheet(book, utils.aoa_to_sheet([header, ['Alpha Mine', 'Owner', 'WA', 'Committed', 78, 2027]]), 'Commodity');
    utils.book_append_sheet(book, utils.aoa_to_sheet([header, ['Old Mine', 'Owner', 'WA', 'Completed', 50, 2000]]), 'Completed Stage');
    return book;
  };
  it('selects only Consolidated and merges duplicate rows with numeric/string formatting differences', () => {
    const rows = projectWorkbookRows('au-resources-energy-major-projects', workbook());
    expect(rows.map(row => row.Project)).toEqual(['Alpha Mine', 'Beta Mine']);
    expect(rows[0]['Estimated Start Commercial Operation']).toBe(2027);
    expect(rows[1].Status).toBe('Completed');
  });
  it('uses project and state identity that survives mutable cost/status changes', () => {
    const first = { Project: 'Alpha Mine', State: 'WA', Status: 'Committed', 'Cost Estimate $Am': 78 };
    expect(projectRecordIdentity('au-resources-energy-major-projects', first)).toBe('au-remp:alpha%20mine:wa');
    expect(projectRecordIdentity('au-resources-energy-major-projects', { ...first, Status: 'Completed', 'Cost Estimate $Am': 80 })).toBe('au-remp:alpha%20mine:wa');
  });
  it('fails on missing Consolidated, missing state, or conflicting duplicate project rows', () => {
    const missing = workbook(); missing.SheetNames = ['Commodity'];
    expect(() => projectWorkbookRows('au-resources-energy-major-projects', missing)).toThrow('REMP_CONSOLIDATED_SHEET_MISSING');
    expect(() => projectRecordIdentity('au-resources-energy-major-projects', { Project: 'Alpha' })).toThrow('REMP_IDENTITY_MISSING');
    const conflict = workbook();
    utils.sheet_add_aoa(conflict.Sheets.Consolidated, [['Alpha Mine', 'Other owner', 'WA', 'Committed', 78, 2027]], { origin: -1 });
    expect(() => projectWorkbookRows('au-resources-energy-major-projects', conflict)).toThrow('REMP_IDENTITY_COLLISION');
  });
});

it('preserves recovery review flags when normalizing archived evidence', () => {
  const source = { key: 'sa-power-generation', method: 'WFS_DIRECT', endpoint: 'https://example.test/wfs', territory: 'SA', provenance: 'https://example.test/catalogue' };
  const raw = sourceWfsRows(source.key, [feature({ STATION_NAME: 'MegaLink BESS', SUBURB: 'Town', TECHNOLOGY: 'Battery' })])[0];
  const evidence = normalizeEvidence(source, raw, '2026-09-16T00:00:00Z');
  expect((evidence as any).qualityFlags).toEqual(['NATURAL_ID_REVIEW_REQUIRED']);
  expect((evidence as any).qualityFlags).not.toBe(raw.qualityFlags);
});