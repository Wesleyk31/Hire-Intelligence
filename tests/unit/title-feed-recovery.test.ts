import { afterEach, expect, it, vi } from 'vitest';
import { CFB, utils, write } from 'xlsx';
import {
  collectBackfillPage,
  normalizeEvidence,
} from '../../backend/backfill-fetch';
import { collect, SOURCES } from '../../backend/index';
import { isEvidenceEligible } from '../../backend/evidence-eligibility';

const source = (key: string) => SOURCES.find((item) => item.key === key)!;
const json = (body: unknown) => new Response(JSON.stringify(body));
const members: Record<string, string> = {
  'nt-mineral-titles': 'NT_MineralTitles_kml.kml',
  'nt-petroleum-pipeline-titles': 'NT_PetroleumPipelineTitles_kml.kml',
  'nt-geothermal-titles': 'NT_GeothermalTitles_kml.kml',
};
function archive(key: string, body: string) {
  const zip = CFB.utils.cfb_new();
  CFB.utils.cfb_add(
    zip,
    members[key],
    Buffer.from(`<kml><Document>${body}</Document></kml>`),
  );
  return Buffer.from(
    CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true }),
  );
}
function mark(layer: string, fields: Record<string, string>) {
  return `<Placemark><ExtendedData><SchemaData schemaUrl="#kml_schema_ft_${layer}">${Object.entries(
    fields,
  )
    .map(([key, value]) => `<SimpleData name="${key}">${value}</SimpleData>`)
    .join('')}</SchemaData></ExtendedData></Placemark>`;
}
const title = (id = 'GEP33024', unique = '497543', type = 'GEP') => ({
  TITLEID: id,
  UNIQ_ID: unique,
  SW_MEMBER: '338564',
  TI_TYPE_CD: type,
  TI_NUMBER: id.replace(/\D/g, ''),
  STATUS: 'Current',
  TS_TYPE: 'Grant',
  PTY_NAME: 'QA title holder',
  HLD_TY_CD: 'A',
  PCT: '100',
  DT_EFFECT: '20251127000000',
  DT_GRNT: '20251127000000',
});
function feed(key: string, bytes: Uint8Array) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init: RequestInit) => {
      if (String(input).includes('package_show'))
        return json({
          success: true,
          result: {
            resources: [
              { format: 'KML', url: `https://example.test/${key}.zip` },
            ],
          },
        });
      if (
        !new Headers(init.headers)
          .get('accept')
          ?.includes('application/x-zip-compressed')
      )
        return new Response('MIME not accepted', { status: 406 });
      return new Response(bytes, {
        headers: { 'content-type': 'application/x-zip-compressed' },
      });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('negotiates the geothermal ZIP and preserves distinct title holder identities in both collectors', async () => {
  const key = 'nt-geothermal-titles';
  feed(
    key,
    archive(
      key,
      mark('GEOTH_TITLE_EXPL_GRNT', title()) +
        mark('GEOTH_TITLE_EXPL_GRNT', title('GEP33024', '497542')),
    ),
  );
  const historical = await collectBackfillPage(source(key), 0);
  const live = await collect(source(key));
  expect(historical.rows.map((row) => row.externalId)).toEqual([
    'nt-geothermal-titles:GEOTH_TITLE_EXPL_GRNT:GEP33024:497542',
    'nt-geothermal-titles:GEOTH_TITLE_EXPL_GRNT:GEP33024:497543',
  ]);
  expect(live.opportunities.map((row) => row.externalId)).toEqual(
    historical.rows.map((row) => row.externalId),
  );
  expect(historical.rows[0].raw).toMatchObject({
    titleDomain: 'geothermal',
    sourceLayer: 'GEOTH_TITLE_EXPL_GRNT',
    TITLEID: 'GEP33024',
    DT_GRNT: '20251127000000',
  });
  expect(live.opportunities[0].qualityFlags).toEqual(
    expect.arrayContaining(['CONTEXT_ONLY', 'SOURCE_RIGHTS_REVIEW_REQUIRED']),
  );
  expect(live.opportunities[0]).toMatchObject({
    company: 'QA title holder',
    organisationRole: 'APPLICANT_HOLDER',
  });
  expect(
    normalizeEvidence(source(key), historical.rows[0], '2026-09-18')
      .sourceObservedAt,
  ).toBe('');
  expect(source(key).enabled).toBe(false);
});

it('excludes only verified contextual layers and exact provider placeholders from geothermal title rows', async () => {
  const key = 'nt-geothermal-titles';
  const placeholder = {
    TI_TYPE_CD: 'GEP',
    PTY_NAME: 'Please Ignore this system generated record',
    UNIQ_ID: '170367',
  };
  feed(
    key,
    archive(
      key,
      mark('GEOTH_TITLE_EXPL_GRNT', title()) +
        mark('GEOTH_TITLE_EXPL_APPL', placeholder) +
        mark('RESERVES_GEOTHERMAL', title('GRO10', '496988', 'GRO')),
    ),
  );
  expect((await collectBackfillPage(source(key), 0)).rows).toHaveLength(1);
  feed(
    key,
    archive(
      key,
      mark('GEOTH_TITLE_EXPL_GRNT', {
        ...placeholder,
        PTY_NAME: 'QA actual holder',
      }),
    ),
  );
  await expect(collectBackfillPage(source(key), 0)).rejects.toThrow(
    'KML_TITLE_IDENTITY_MISSING',
  );
});

it('keeps pipeline, petroleum, application and historical title domains distinct without including release areas', async () => {
  const key = 'nt-petroleum-pipeline-titles';
  feed(
    key,
    archive(
      key,
      mark('PETRO_PIPE_EXPL_GRNT', title('PL1', '101', 'PL')) +
        mark('PETRO_TITLE_EXPL_APPL', {
          ...title('EP1', '102', 'EP'),
          TS_TYPE: 'Application',
        }) +
        mark('TITLES_PETRO_HISTORICAL', {
          ...title('EP1', '103', 'EP'),
          STATUS: 'Ceased',
        }) +
        mark('PETRO_ACREAGE_RELEASE_AREAS', {
          ID: 'release-1',
          STATUS: 'Open',
        }),
    ),
  );
  const rows = (await collectBackfillPage(source(key), 0)).rows;
  expect(
    rows.map((row) => [
      row.raw.titleDomain,
      row.raw.sourceLayer,
      row.raw.TITLEID,
    ]),
  ).toEqual([
    ['pipeline', 'PETRO_PIPE_EXPL_GRNT', 'PL1'],
    ['petroleum', 'PETRO_TITLE_EXPL_APPL', 'EP1'],
    ['petroleum', 'TITLES_PETRO_HISTORICAL', 'EP1'],
  ]);
  expect(rows.every((row) => row.qualityFlags?.includes('CONTEXT_ONLY'))).toBe(
    true,
  );
});

it('rejects wrong-domain title fields, new schemas and conflicting title identity instead of guessing', async () => {
  const key = 'nt-geothermal-titles';
  for (const [body, error] of [
    [
      mark('GEOTH_TITLE_EXPL_GRNT', title('EP1', '100', 'EP')),
      'KML_TITLE_DOMAIN_INVALID',
    ],
    [mark('GEOTH_TITLE_NEW', title()), 'KML_TITLE_SCHEMA_REVIEW_REQUIRED'],
    [
      mark('GEOTH_TITLE_EXPL_GRNT', title()) +
        mark('GEOTH_TITLE_EXPL_GRNT', {
          ...title(),
          PTY_NAME: 'Conflicting holder',
        }),
      'KML_IDENTITY_COLLISION',
    ],
  ]) {
    feed(key, archive(key, body));
    await expect(collectBackfillPage(source(key), 0)).rejects.toThrow(error);
  }
});

it('reports the mineral archive expansion bound after correct ZIP negotiation', async () => {
  const key = 'nt-mineral-titles';
  const bytes = archive(key, '<Placemark/>');
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  bytes.writeUInt32LE(117447591, central + 24);
  feed(key, bytes);
  await expect(collectBackfillPage(source(key), 0)).rejects.toThrow(
    'KML_ZIP_EXPANDED_LIMIT',
  );
});

it('rejects changed geothermal snapshots when continuing historical pages', async () => {
  const key = 'nt-geothermal-titles';
  feed(
    key,
    archive(
      key,
      Array.from({ length: 101 }, (_, i) =>
        mark('GEOTH_TITLE_EXPL_GRNT', title('GEP33024', String(1000 + i))),
      ).join(''),
    ),
  );
  const first = await collectBackfillPage(source(key), 0);
  expect(first.rows).toHaveLength(100);
  feed(key, archive(key, mark('GEOTH_TITLE_EXPL_GRNT', title())));
  await expect(
    collectBackfillPage(source(key), first.next, undefined, first.context),
  ).rejects.toThrow('KML_SNAPSHOT_CHANGED');
});

it('classifies a Queensland WAF challenge without replacing the latest grant period', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      if (String(input).includes('package_show'))
        return json({
          success: true,
          result: {
            resources: [
              {
                id: 'august',
                created: '2026-09-15',
                format: 'XLSX',
                url: 'https://example.test/august.xlsx',
              },
              { id: 'july', created: '2026-08-24', datastore_active: true },
            ],
          },
        });
      if (!String(input).endsWith('/august.xlsx'))
        throw new Error('OLDER_PERIOD_MUST_NOT_BE_USED');
      return new Response(null, {
        status: 202,
        headers: { 'x-amzn-waf-action': 'challenge' },
      });
    }),
  );
  await expect(
    collect(source('qld-granted-resource-authorities')),
  ).rejects.toThrow('HTTP_202:PROVIDER_CHALLENGE');
});

it('reports a challenged cloned response even when the other body reader stays open', async () => {
  const response = new Response('challenge', {
    status: 202,
    headers: { 'x-amzn-waf-action': 'challenge' },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) =>
      String(input).includes('package_show')
        ? json({
            success: true,
            result: {
              resources: [
                { format: 'XLSX', url: 'https://example.test/latest.xlsx' },
              ],
            },
          })
        : response.clone(),
    ),
  );
  const failure = collect(source('qld-granted-resource-authorities')).catch(
    (error) => error.message,
  );
  const result = await Promise.race([
    failure,
    new Promise((resolve) =>
      setTimeout(() => resolve('classification stalled'), 250),
    ),
  ]);
  await response.body?.cancel();
  expect(result).toBe('HTTP_202:PROVIDER_CHALLENGE');
});

it('reports the unavailable Stadiums workbook when its declared datastore is empty', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      if (String(input).includes('package_show'))
        return json({
          success: true,
          result: {
            resources: [
              {
                id: '045ac29a-ae16-4e08-82c8-3618500ec5bf',
                format: 'XLSX',
                datastore_active: true,
                url: 'https://example.test/july-december-2025.xlsx',
              },
            ],
          },
        });
      if (String(input).includes('datastore_search'))
        return json({ success: true, result: { total: 0, records: [] } });
      return new Response(null, {
        status: 202,
        headers: { 'x-amzn-waf-action': 'challenge' },
      });
    }),
  );
  await expect(
    collectBackfillPage(source('qld-stadiums-contracts-jul-dec-2025'), 0),
  ).rejects.toThrow('CKAN_EMPTY_DATASTORE:HTTP_202:PROVIDER_CHALLENGE');
});

it('uses only the same Stadiums publication workbook after empty datastore and pins that path', async () => {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['Contract reference number', 'Contract description/name'],
      ['SQ2025-1', 'QA roof repairs'],
    ]),
    'Contracts',
  );
  const bytes = write(book, { type: 'buffer', bookType: 'xlsx' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      if (String(input).includes('package_show'))
        return json({
          success: true,
          result: {
            resources: [
              {
                id: '045ac29a-ae16-4e08-82c8-3618500ec5bf',
                format: 'XLSX',
                datastore_active: true,
                url: 'https://example.test/july-december-2025.xlsx',
              },
            ],
          },
        });
      if (String(input).includes('datastore_search'))
        return json({ success: true, result: { total: 0, records: [] } });
      if (String(input) !== 'https://example.test/july-december-2025.xlsx')
        throw Error('WRONG_PERIOD');
      return new Response(bytes);
    }),
  );
  const page = await collectBackfillPage(
    source('qld-stadiums-contracts-jul-dec-2025'),
    0,
  );
  expect(page.rows[0].externalId).toBe('SQ2025-1');
  expect(page.rows[0].qualityFlags).toEqual(
    expect.arrayContaining(['SOURCE_SCHEMA_REVIEW_REQUIRED', 'CONTEXT_ONLY']),
  );
  expect(
    isEvidenceEligible(
      normalizeEvidence(
        source('qld-stadiums-contracts-jul-dec-2025'),
        page.rows[0],
        '2026-09-18',
      ),
    ),
  ).toBe(false);
  const live = await collect(source('qld-stadiums-contracts-jul-dec-2025'));
  expect(live.opportunities).toHaveLength(1);
  expect(isEvidenceEligible(live.opportunities[0])).toBe(false);
  expect(page.context?.ckanResource).toMatchObject({
    id: '045ac29a-ae16-4e08-82c8-3618500ec5bf',
    datastore_active: false,
    url: 'https://example.test/july-december-2025.xlsx',
  });
});

it('rejects an unverified Stadiums workbook whose first sheet is publication metadata', async () => {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['Publication', 'Value'],
      ['Period', 'July–December 2025'],
      ['Publisher', 'Stadiums Queensland'],
    ]),
    'Publication',
  );
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['Contract reference number', 'Contract description/name'],
      ['SQ2025-1', 'QA roof repairs'],
    ]),
    'Contracts',
  );
  const bytes = write(book, { type: 'buffer', bookType: 'xlsx' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      if (String(input).includes('package_show'))
        return json({
          success: true,
          result: {
            resources: [
              {
                id: '045ac29a-ae16-4e08-82c8-3618500ec5bf',
                format: 'XLSX',
                datastore_active: true,
                url: 'https://example.test/july-december-2025.xlsx',
              },
            ],
          },
        });
      if (String(input).includes('datastore_search'))
        return json({ success: true, result: { total: 0, records: [] } });
      return new Response(bytes);
    }),
  );
  const target = source('qld-stadiums-contracts-jul-dec-2025');
  await expect(collect(target)).rejects.toThrow(
    'STADIUMS_WORKBOOK_SCHEMA_REVIEW_REQUIRED',
  );
  await expect(collectBackfillPage(target, 0)).rejects.toThrow(
    'STADIUMS_WORKBOOK_SCHEMA_REVIEW_REQUIRED',
  );
});
