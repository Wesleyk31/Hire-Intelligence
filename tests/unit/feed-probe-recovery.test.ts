import { afterEach, expect, it, vi } from 'vitest';
import { utils, write } from 'xlsx';
import { probeSource } from '../../backend/automation-probes';
import { collectBackfillPage } from '../../backend/backfill-fetch';
import type { SourceDef } from '../../backend/index';
import { db } from '@appdeploy/sdk';
import {
  checkSourceHealth,
  recordSourceOutcome,
} from '../../backend/source-automation';

const base = {
  name: 'Fixture',
  owner: 'Authority',
  territory: 'AU',
  sector: 'Energy',
  licence: 'Public',
  provenance: 'https://authority.test/catalogue',
};
const ods: SourceDef = {
  ...base,
  key: 'melbourne-building-permits',
  method: 'OPENDATASOFT',
  endpoint:
    'https://authority.test/api/explore/v2.1/catalog/datasets/building-permits/records?limit=40',
};
const kci: SourceDef = {
  ...base,
  key: 'aemo-key-connection-information',
  method: 'XLSX_PROJECT',
  endpoint: 'https://authority.test/kci.xlsx',
};
const unusedCollect = async () => {
  throw new Error('Unexpected legacy collector');
};
const odsFields = [
  ['permit_number', 'text'],
  ['issue_date', 'date'],
  ['address', 'text'],
  ['desc_of_works', 'text'],
].map(([name, type]) => ({ name, type }));
const kciHeaders = [
  'AEMO KCI ID',
  'Site Name',
  'KCI datafile compilation date time stamp',
  'Organisation Name',
];
const json = (value: unknown) => new Response(JSON.stringify(value));
function stubOds(fields = odsFields) {
  vi.stubGlobal('fetch', async (input: string) => {
    const url = new URL(input);
    if (!url.pathname.endsWith('/records'))
      return json({ dataset_id: 'building-permits', fields });
    const offset = Number(url.searchParams.get('offset') || 0);
    return json({
      total_count: 101,
      results: Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({
        permit_number: 'same-permit',
        address: `Site ${offset + index}`,
        issue_date: '2026-07-01',
      })),
    });
  });
}
function stubKci(headers = kciHeaders, count = 101) {
  vi.stubGlobal('fetch', async () => {
    const book = utils.book_new();
    const rows = Array.from({ length: count }, (_, index) =>
      headers.map(
        (name) =>
          ({
            'AEMO KCI ID': 'N00043',
            'Site Name': 'Fixture project',
            'KCI datafile compilation date time stamp': 202601010000 + index,
            'Organisation Name': index % 2 ? '' : 'Owner',
          })[name] || '',
      ),
    );
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ['Public workbook'],
        [],
        [...headers, '', ''],
        ...rows,
      ]),
      'Q2 2026 KCI',
    );
    return new Response(write(book, { type: 'buffer', bookType: 'xlsx' }));
  });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('validates Melbourne declared schema while retaining all permit evidence across 100-row pages', async () => {
  stubOds();
  const result = await probeSource(ods, unusedCollect);
  expect(result).toMatchObject({
    recordCount: 101,
    checks: { schema: 'PASS', parser: 'PASS', pagination: 'PASS' },
  });
  expect(result.schemaVersion).toMatch(/^[a-f0-9]{64}$/);
  stubOds([...odsFields].reverse());
  expect((await probeSource(ods, unusedCollect)).schemaVersion).toBe(
    result.schemaVersion,
  );
  stubOds([...odsFields, { name: 'new_field', type: 'text' }]);
  expect((await probeSource(ods, unusedCollect)).schemaVersion).not.toBe(
    result.schemaVersion,
  );
});
it('rejects missing or mistyped required ODS declarations instead of reporting recovery', async () => {
  stubOds(odsFields.filter((field) => field.name !== 'permit_number'));
  await expect(probeSource(ods, unusedCollect)).rejects.toThrow(
    'ODS_REQUIRED_FIELDS_MISSING',
  );
  stubOds(
    odsFields.map((field) =>
      field.name === 'issue_date' ? { ...field, type: 'int' } : field,
    ),
  );
  await expect(probeSource(ods, unusedCollect)).rejects.toThrow(
    'ODS_SCHEMA_REQUIRED_FIELD_TYPE_INVALID',
  );
});
it('validates KCI worksheet declarations from the parsed workbook and preserves original IDs, versions, and cursor', async () => {
  stubKci();
  const page = await collectBackfillPage(kci, 0);
  expect(page.rows).toHaveLength(100);
  expect(page.next).toBe(100);
  expect(page.rows[0]).toMatchObject({
    externalId: 'N00043',
    raw: { 'KCI datafile compilation date time stamp': 202601010000 },
  });
  const result = await probeSource(kci, unusedCollect);
  expect(result).toMatchObject({
    recordCount: 101,
    checks: { schema: 'PASS', parser: 'PASS', pagination: 'PASS' },
  });
  expect(result.schemaVersion).toMatch(/^[a-f0-9]{64}$/);
  stubKci([...kciHeaders].reverse(), 1);
  expect((await probeSource(kci, unusedCollect)).schemaVersion).toBe(
    result.schemaVersion,
  );
  stubKci([...kciHeaders, 'New publisher column'], 1);
  expect((await probeSource(kci, unusedCollect)).schemaVersion).not.toBe(
    result.schemaVersion,
  );
});
it('rejects missing or ambiguous KCI worksheet declarations', async () => {
  stubKci(
    kciHeaders.filter(
      (name) => name !== 'KCI datafile compilation date time stamp',
    ),
    1,
  );
  await expect(probeSource(kci, unusedCollect)).rejects.toThrow(
    'KCI_REQUIRED_FIELDS_MISSING',
  );
  stubKci([...kciHeaders, 'Site Name'], 1);
  await expect(probeSource(kci, unusedCollect)).rejects.toThrow(
    'KCI_SCHEMA_FIELDS_INVALID',
  );
});

it('clears pagination holds through actual validated probes while retaining an established schema-change hold', async () => {
  const tables: Record<string, any[]> = {};
  vi.spyOn(db, 'list').mockImplementation(async (table: string) => ({
    items: structuredClone(tables[table] || []),
  }));
  vi.spyOn(db, 'add').mockImplementation(
    async (table: string, records: any[]) =>
      records.map((record) => {
        const id = String((tables[table] || []).length + 1);
        (tables[table] ||= []).push({ ...structuredClone(record), id });
        return id;
      }),
  );
  vi.spyOn(db, 'update').mockImplementation(
    async (table: string, updates: any[]) =>
      updates.map((update) => {
        Object.assign(
          tables[table].find((row) => row.id === update.id),
          structuredClone(update.record),
        );
        return true;
      }),
  );
  for (const source of [ods, kci]) {
    source === ods ? stubOds() : stubKci();
    expect(
      await recordSourceOutcome(source, {
        ok: false,
        failureReason: 'PAGINATION_REPEATED_PAGE',
      }),
    ).toMatchObject({ collection_blocked: true });
    const recovered = await checkSourceHealth(source, () =>
      probeSource(source, unusedCollect),
    );
    expect(recovered).toMatchObject({
      status: 'ACTIVE',
      collection_blocked: false,
      collection_hold_reason: null,
      checks: { parser: 'PASS', schema: 'PASS', pagination: 'PASS' },
    });
    if (source === ods) {
      stubOds([...odsFields, { name: 'changed_schema', type: 'text' }]);
      expect(
        await checkSourceHealth(source, () =>
          probeSource(source, unusedCollect),
        ),
      ).toMatchObject({
        status: 'DEGRADED',
        collection_blocked: true,
        collection_hold_reason: 'SOURCE_SCHEMA_CHANGED',
        schema_version: recovered.schema_version,
      });
    }
  }
});
