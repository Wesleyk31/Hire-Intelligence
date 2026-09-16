import { recoveredKmlRows } from './feed-recovery';
import { read, utils, type WorkBook } from 'xlsx';
import { createHash } from 'node:crypto';

const text = (value: unknown) => (value == null ? '' : String(value).trim());
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findField(
  row: Record<string, unknown>,
  names: string[],
): string {
  const entries = Object.entries(row).map(([name, value]) => [
    key(name),
    text(value),
  ]);
  for (const name of names) {
    const hit = entries.find(([field, value]) => field === key(name) && value);
    if (hit) return hit[1];
  }
  for (const name of names.filter((name) => key(name).length > 2)) {
    const hit = entries.find(
      ([field, value]) => field.includes(key(name)) && value,
    );
    if (hit) return hit[1];
  }
  return '';
}

export function recordIdentity(row: Record<string, unknown>): string {
  const entries = new Map(
    Object.entries(row).map(([name, value]) => [key(name), text(value)]),
  );
  for (const name of [
    'geninfounitid',
    'aemokciid',
    'objectid',
    'oid',
    'gid',
    'id',
    'recordid',
    'tenid',
    'tasid',
    'titleid',
    'titleno',
    'permitnumber',
    'authoritynumber',
    'permitreference',
    'contractreferencenumber',
    'councilref',
    'projectid',
    'duid',
  ]) {
    const value = entries.get(name);
    if (value) return value;
  }
  // Positional IDs overwrite unrelated records when a publisher reorders a page.
  const stable = JSON.stringify(
    Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
  );
  let hash = 2166136261;
  for (let i = 0; i < stable.length; i++)
    hash = Math.imul(hash ^ stable.charCodeAt(i), 16777619);
  return 'record-' + (hash >>> 0).toString(16);
}

async function requestBytes(url: string, accept: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept,
        'user-agent': 'HirerIntelligence/1.0 public-open-data-client',
      },
    });
    if (!response.ok || response.status === 202 || response.status === 204)
      throw new Error('HTTP_' + response.status);
    const maximum = 25 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maximum) {
      await response.body?.cancel();
      throw new Error('SOURCE_BODY_TOO_LARGE');
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maximum) {
          await reader.cancel();
          throw new Error('SOURCE_BODY_TOO_LARGE');
        }
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

export async function sourceJson(url: string): Promise<any> {
  const data = JSON.parse(
    new TextDecoder().decode(await requestBytes(url, 'application/json')),
  );
  if (!data || typeof data !== 'object') throw new Error('SCHEMA_INVALID');
  return data;
}
export async function sourceText(url: string): Promise<string> {
  return new TextDecoder().decode(
    await requestBytes(url, 'application/xml,text/xml,text/plain'),
  );
}
export async function sourceWorkbook(url: string): Promise<WorkBook> {
  const bytes = await requestBytes(
    url,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75)
    throw new Error('XLSX_INVALID_BODY');
  const book = read(bytes, { type: 'array' });
  if (!book.SheetNames.length) throw new Error('XLSX_EMPTY');
  return book;
}

const aemoDateFields = new Set([
  'surveylatestupdatedate',
  'surveylastrequesteddate',
  'publicationdate',
  'kcidatatnspvalidationdate',
  'kcidataconnectionapplicantnotificationdate',
]);
function workbookValue(name: string, value: unknown): unknown {
  if (
    aemoDateFields.has(key(name)) &&
    typeof value === 'number' &&
    value >= 1 &&
    value < 100000
  ) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString();
  }
  return value;
}

export function projectWorkbookRows(
  sourceKey: string,
  book: WorkBook,
  preserveHistory = false,
): Record<string, unknown>[] {
  if (sourceKey === 'au-resources-energy-major-projects')
    return nationalMajorProjectRows(book);
  const all: Record<string, unknown>[] = [];
  const generator = sourceKey === 'aemo-generation-information';
  const kci = sourceKey === 'aemo-key-connection-information';
  const sheets = generator
    ? book.SheetNames.filter((name) => name === 'Generator Information')
    : book.SheetNames.filter(
        (name) =>
          !/background|disclaimer|summary|change log|glossary/i.test(name),
      );
  for (const sheet of sheets) {
    const table = utils.sheet_to_json<unknown[]>(book.Sheets[sheet], {
      header: 1,
      defval: '',
    }) as unknown[][];
    const header = table.slice(0, 40).findIndex((row) => {
      const names = row.map((value) => key(text(value)));
      if (generator)
        return (
          names.includes('sitename') &&
          names.includes('geninfounitid') &&
          names.includes('commitmentstatus')
        );
      if (kci) return names.includes('sitename') && names.includes('aemokciid');
      return (
        names.some((name) =>
          [
            'project',
            'projectname',
            'sitename',
            'generatorname',
            'facilityname',
          ].includes(name),
        ) &&
        names.some((name) =>
          [
            'state',
            'region',
            'status',
            'company',
            'owner',
            'siteowner',
          ].includes(name),
        )
      );
    });
    if (header < 0) continue;
    const names = table[header].map((value) => text(value));
    for (const row of table.slice(header + 1)) {
      const record: Record<string, unknown> = {};
      names.forEach((name, index) => {
        if (name && text(row[index]))
          record[name] =
            generator || kci ? workbookValue(name, row[index]) : row[index];
      });
      const title = findField(record, [
        'Site Name',
        'Project Name',
        'Project',
        'Generator Name',
        'Facility Name',
      ]);
      if (!title || /^(site name|project name|project)$/i.test(title)) continue;
      if (generator && !findField(record, ['Gen Info Unit ID'])) continue;
      if (kci && !findField(record, ['AEMO KCI ID'])) continue;
      all.push(record);
      if (all.length >= 20000) break;
    }
    if (all.length >= 20000) break;
  }
  if (!all.length) throw new Error('XLSX_PROJECT_ROWS_MISSING');
  if (!kci || preserveHistory) return all;
  // KCI is an update history; promote the newest published version for each ID.
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of all) {
    const id = recordIdentity(row);
    const prior = latest.get(id);
    const stamp = (item: Record<string, unknown>) =>
      Number(findField(item, ['KCI datafile compilation date time stamp'])) ||
      0;
    if (!prior || stamp(row) >= stamp(prior)) latest.set(id, row);
  }
  return [...latest.values()];
}

export type CkanResource = {
  id?: string;
  url?: string;
  format?: string;
  datastore_active?: boolean;
  created?: string;
  last_modified?: string;
};
export async function selectCkanResource(
  endpoint: string,
): Promise<CkanResource | undefined> {
  const body = await sourceJson(endpoint);
  if (body.success !== true || !Array.isArray(body.result?.resources))
    throw new Error('CKAN_SCHEMA_INVALID');
  const resources = [...body.result.resources].sort((a, b) => {
    const date = (resource: any) =>
      Date.parse(String(resource.created || resource.last_modified || '')) || 0;
    return date(b) - date(a);
  });
  const resource = resources.find(
    (item) =>
      (item.datastore_active === true && item.id) ||
      (['XLSX', 'CSV'].includes(String(item.format).toUpperCase()) && item.url),
  );
  return resource
    ? {
        id: resource.id,
        url: resource.url,
        format: resource.format,
        datastore_active: resource.datastore_active,
      }
    : undefined;
}

export async function ckanResourceRows(
  endpoint: string,
  limit: number,
  offset: number,
  pinnedResource?: CkanResource,
) {
  const resource = pinnedResource || (await selectCkanResource(endpoint));
  if (!resource)
    return {
      rows: [] as Array<{ externalId: string; raw: Record<string, unknown> }>,
      total: 0,
    };
  const selectedResource: CkanResource = {
    id: resource.id,
    url: resource.url,
    format: resource.format,
    datastore_active: resource.datastore_active,
  };
  if (resource.datastore_active === true && resource.id) {
    const url = new URL('/api/3/action/datastore_search', endpoint);
    url.searchParams.set('resource_id', resource.id);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    const page = await sourceJson(url.toString());
    if (page.success !== true || !Array.isArray(page.result?.records))
      throw new Error('CKAN_SCHEMA_INVALID');
    return {
      rows: page.result.records.map((raw: Record<string, unknown>) => ({
        externalId: recordIdentity(raw),
        raw,
      })),
      total: paginationTotal(page.result.total, 'CKAN'),
      resource: selectedResource,
    };
  }
  let book: WorkBook;
  if (String(resource.format).toUpperCase() === 'CSV') {
    const value = await sourceText(String(resource.url));
    if (!value.trim() || /<html|<!doctype/i.test(value))
      throw new Error('CSV_INVALID_BODY');
    book = read(value, { type: 'string' });
  } else book = await sourceWorkbook(String(resource.url));
  const sheet = book.SheetNames[0];
  const all = sheet
    ? utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheet], {
        defval: '',
      })
    : [];
  return {
    rows: all
      .slice(offset, offset + limit)
      .map((raw) => ({ externalId: recordIdentity(raw), raw })),
    total: all.length,
    resource: selectedResource,
  };
}

/** Pinned layers verified on 2026-09-16. Pinning also makes the registry's actual subset explicit. */
export const RECOVERED_WFS_LAYERS: Readonly<
  Record<string, { typeName: string; sortBy: string }>
> = {
  'sa-mining-projects': {
    typeName: 'south_australia_mining_projects:major_mines___minerals',
    sortBy: 'OBJECTID',
  },
  'sa-mineral-tenements': {
    typeName:
      'mineral_tenements:mineral_and_or_opal_exploration_licence_applications',
    sortBy: 'OBJECTID',
  },
  'sa-petroleum-tenements': {
    typeName:
      'petroleum_tenements:associated_facility_and_infrastructure_licence_applications',
    sortBy: 'OBJECTID',
  },
  'sa-power-generation': {
    typeName: 'renewable_energy_and_storage:power_generation___all',
    sortBy: 'OBJECTID',
  },
  'nsw-current-mining-titles': {
    typeName: 'mining-and-exploration:titles_title_granted',
    sortBy: 'tas_id',
  },
  'nsw-mining-title-applications': {
    typeName: 'mining-and-exploration:titles_title_applications',
    sortBy: 'tas_id',
  },
  'nsw-major-operating-mines': {
    typeName: 'mineral-occurrence:mineral_occurrence_operating_mines',
    sortBy: 'occurrence_id',
  },
};
type SourceWfs = { key: string; endpoint: string };
export type SourceWfsRow = {
  externalId: string;
  raw: Record<string, unknown>;
  qualityFlags: string[];
};
const identityPart = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};
const isAttributes = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const canonicalRow = (row: Record<string, unknown>, ignoreTransport = false) =>
  JSON.stringify(
    Object.entries(row)
      .filter(
        ([name, value]) =>
          text(value) &&
          !(ignoreTransport && /^(OBJECTID|TIME_SLICE|SHAPE_.*)$/i.test(name)),
      )
      .map(([name, value]) => [name, text(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );

export function sourceWfsRows(
  sourceKey: string,
  features: readonly unknown[],
): SourceWfsRow[] {
  const rows = new Map<string, SourceWfsRow>();
  for (const feature of features) {
    if (!isAttributes(feature) || !isAttributes(feature.properties))
      throw new Error('WFS_ATTRIBUTES_INVALID');
    const raw = feature.properties;
    let parts: string[] | undefined;
    const qualityFlags: string[] = [];
    if (sourceKey === 'sa-mining-projects') parts = [identityPart(raw.SITE_NO)];
    if (sourceKey === 'sa-mineral-tenements')
      parts = [
        identityPart(raw.APPLICATION_TYPE),
        identityPart(raw.FILE_REFERENCE),
      ];
    if (sourceKey === 'sa-petroleum-tenements')
      parts = [identityPart(raw.TENEMENT_NO)];
    if (
      sourceKey === 'nsw-current-mining-titles' ||
      sourceKey === 'nsw-mining-title-applications'
    )
      parts = [identityPart(raw.tas_id)];
    if (sourceKey === 'nsw-major-operating-mines')
      parts = [identityPart(raw.occurrence_id)];
    if (sourceKey === 'sa-power-generation') {
      const station = identityPart(raw.STATION_NAME);
      if (!station) throw new Error('WFS_STABLE_ID_MISSING:' + sourceKey);
      parts = [station, identityPart(raw.SUBURB), identityPart(raw.TECHNOLOGY)];
      qualityFlags.push('NATURAL_ID_REVIEW_REQUIRED');
    } else if (parts?.some((part) => !part || part === '0'))
      throw new Error('WFS_STABLE_ID_MISSING:' + sourceKey);
    const externalId = parts
      ? sourceKey + ':' + parts.map(encodeURIComponent).join(':')
      : text(feature.id) || recordIdentity(raw);
    const prior = rows.get(externalId);
    if (prior && canonicalRow(prior.raw, true) !== canonicalRow(raw, true))
      throw new Error('WFS_IDENTITY_COLLISION:' + sourceKey);
    if (!prior) rows.set(externalId, { externalId, raw, qualityFlags });
  }
  return [...rows.values()];
}

export function wfsPageUrl(
  source: SourceWfs,
  offset: number,
  limit: number,
): string {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error('WFS_PAGE_BOUND_INVALID');
  const url = new URL(source.endpoint);
  const pinned = RECOVERED_WFS_LAYERS[source.key];
  const configured =
    url.searchParams.get('typeNames') || url.searchParams.get('typeName');
  if (pinned && configured && configured !== pinned.typeName)
    throw new Error('WFS_PINNED_LAYER_MISMATCH');
  const typeName = pinned?.typeName || configured;
  if (!typeName) throw new Error('WFS_LAYER_REQUIRED');
  url.searchParams.delete('typeName');
  url.searchParams.delete('maxFeatures');
  Object.entries({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: typeName,
    outputFormat: 'application/json',
    count: String(limit),
    startIndex: String(offset),
  }).forEach(([name, value]) => url.searchParams.set(name, value));
  if (pinned) url.searchParams.set('sortBy', pinned.sortBy);
  return url.toString();
}

/** Missing totals allow a short-page fallback; an invalid supplied total never does. */
export function paginationTotal(
  value: unknown,
  provider: string,
): number | undefined {
  if (value === undefined || value === null) return;
  if (
    !(
      typeof value === 'number' ||
      (typeof value === 'string' && /^\d+$/.test(value))
    ) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 0
  )
    throw new Error(provider + '_TOTAL_INVALID');
  return Number(value);
}

export function paginationCompleted(
  provider: string,
  offset: number,
  count: number,
  limit: number,
  total?: number,
): boolean {
  const next = offset + count;
  if (total !== undefined && count && next > total)
    throw new Error(provider + '_TOTAL_CONTRADICTION');
  if (!count && total !== undefined && next < total)
    throw new Error(provider + '_PAGE_NO_PROGRESS');
  return total !== undefined ? next >= total : count < limit;
}

export type WfsCheckpoint = {
  sourceKey: string;
  requestIdentity: string;
  nextOffset: number;
  pageFingerprint: string;
  sortField?: string;
  lastSortValue?: number;
};
function wfsRequestIdentity(requestUrl: string): string {
  const url = new URL(requestUrl);
  for (const name of [...url.searchParams.keys()])
    if (/^(startIndex|count|maxFeatures)$/i.test(name))
      url.searchParams.delete(name);
  url.searchParams.sort();
  return createHash('sha256').update(url.toString()).digest('hex');
}
export function validateWfsCheckpoint(
  sourceKey: string,
  requestUrl: string,
  offset: number,
  previous?: WfsCheckpoint,
) {
  if (!previous) return;
  if (previous.sourceKey !== sourceKey)
    throw new Error('WFS_CHECKPOINT_SOURCE');
  if (previous.nextOffset !== offset) throw new Error('WFS_CHECKPOINT_OFFSET');
  if (previous.requestIdentity !== wfsRequestIdentity(requestUrl))
    throw new Error('WFS_CHECKPOINT_REQUEST');
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (isAttributes(value))
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((name) => JSON.stringify(name) + ':' + stableJson(value[name]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}

/** Raw features, rather than deduplicated evidence, prove that the provider advanced. */
export function checkpointWfsPage(
  sourceKey: string,
  requestUrl: string,
  offset: number,
  features: readonly unknown[],
  previous?: WfsCheckpoint,
): WfsCheckpoint {
  validateWfsCheckpoint(sourceKey, requestUrl, offset, previous);
  const pageFingerprint = createHash('sha256')
    .update(
      stableJson(
        features.map((feature) => {
          if (!isAttributes(feature) || !isAttributes(feature.properties))
            throw new Error('WFS_ATTRIBUTES_INVALID');
          // Generated top-level IDs can change on each request. Properties retain stable transport IDs.
          return {
            properties: feature.properties,
            geometry: feature.geometry ?? null,
          };
        }),
      ),
    )
    .digest('hex');
  if (features.length && previous?.pageFingerprint === pageFingerprint)
    throw new Error('WFS_PAGE_REPEATED');
  const sortField = new URL(requestUrl).searchParams
    .get('sortBy')
    ?.trim()
    .split(/\s+/)[0];
  let lastSortValue: number | undefined;
  if (sortField && features.length) {
    const values = features.map(
      (feature) =>
        (feature as { properties: Record<string, unknown> }).properties[
          sortField
        ],
    );
    // Some legacy providers omit sort attributes. The raw-page fingerprint still guards retries.
    if (
      values.every(
        (value) =>
          (typeof value === 'number' ||
            (typeof value === 'string' && /^\d+$/.test(value))) &&
          Number.isSafeInteger(Number(value)),
      )
    ) {
      const numbers = values.map(Number);
      if (
        numbers.some(
          (value, index) => index > 0 && value < numbers[index - 1],
        ) ||
        (previous?.sortField === sortField &&
          previous.lastSortValue !== undefined &&
          numbers[0] < previous.lastSortValue)
      )
        throw new Error('WFS_SORT_BOUNDARY');
      lastSortValue = numbers[numbers.length - 1];
    }
  }
  return {
    sourceKey,
    requestIdentity: wfsRequestIdentity(requestUrl),
    nextOffset: offset + features.length,
    pageFingerprint,
    sortField,
    lastSortValue,
  };
}

export function wfsMatchedTotal(
  body: Record<string, unknown>,
): number | undefined {
  const value = body.numberMatched ?? body.totalFeatures;
  return value === 'unknown' ? undefined : paginationTotal(value, 'WFS');
}

export async function sourceWfsPage(
  source: SourceWfs,
  offset: number,
  limit: number,
  requestJson: (url: string) => Promise<unknown> = sourceJson,
  previous?: WfsCheckpoint,
) {
  const requestUrl = wfsPageUrl(source, offset, limit);
  validateWfsCheckpoint(source.key, requestUrl, offset, previous);
  const body = await requestJson(requestUrl);
  if (!isAttributes(body) || body.error || !Array.isArray(body.features))
    throw new Error('WFS_DIRECT_SCHEMA_INVALID');
  if (body.features.length > limit) throw new Error('WFS_PAGE_OVERFLOW');
  const rows = sourceWfsRows(source.key, body.features);
  const checkpoint = checkpointWfsPage(
    source.key,
    requestUrl,
    offset,
    body.features,
    previous,
  );
  // Cursor counts source features, including multipart duplicates removed from the context view.
  const next = offset + body.features.length;
  const completed = paginationCompleted(
    'WFS',
    offset,
    body.features.length,
    limit,
    wfsMatchedTotal(body),
  );
  return { rows, next, completed, checkpoint };
}

/** The national workbook has no publisher project ID: keep a checked natural key, never a mutable-row hash. */
export function projectRecordIdentity(
  sourceKey: string,
  raw: Record<string, unknown>,
): string {
  if (sourceKey !== 'au-resources-energy-major-projects')
    return recordIdentity(raw);
  const project = identityPart(raw.Project),
    state = identityPart(raw.State);
  if (!project || !state) throw new Error('REMP_IDENTITY_MISSING');
  return (
    'au-remp:' + encodeURIComponent(project) + ':' + encodeURIComponent(state)
  );
}

function nationalMajorProjectRows(book: WorkBook): Record<string, unknown>[] {
  if (!book.SheetNames.includes('Consolidated') || !book.Sheets.Consolidated)
    throw new Error('REMP_CONSOLIDATED_SHEET_MISSING');
  const table = utils.sheet_to_json<unknown[]>(book.Sheets.Consolidated, {
    header: 1,
    defval: '',
  });
  const header = table
    .slice(0, 40)
    .findIndex((row) =>
      ['Project', 'State', 'Status'].every((name) =>
        row.some((value) => text(value) === name),
      ),
    );
  if (header < 0) throw new Error('REMP_HEADER_MISSING');
  const names = table[header].map(text);
  const rows = new Map<string, Record<string, unknown>>();
  for (const cells of table.slice(header + 1)) {
    const raw: Record<string, unknown> = {};
    names.forEach((name, index) => {
      if (name && text(cells[index])) raw[name] = cells[index];
    });
    if (
      (!text(raw.Project) && !text(raw.State)) ||
      (text(raw.Project) === 'Project' && text(raw.State) === 'State')
    )
      continue;
    const id = projectRecordIdentity('au-resources-energy-major-projects', raw);
    const prior = rows.get(id);
    // The 2025 sheet repeats Woodlawn with numeric/string formatting differences.
    if (prior && canonicalRow(prior) !== canonicalRow(raw))
      throw new Error('REMP_IDENTITY_COLLISION');
    if (!prior) rows.set(id, raw);
    if (rows.size > 20000) throw new Error('REMP_ROW_LIMIT');
  }
  if (!rows.size) throw new Error('XLSX_PROJECT_ROWS_MISSING');
  return [...rows.values()];
}

/** NT MODAT archives only; title archives retain their separate review gates. */
export async function ckanKmlRows(sourceKey: string, endpoint: string) {
  const body = await sourceJson(endpoint);
  if (body.success !== true || !Array.isArray(body.result?.resources))
    throw new Error('CKAN_SCHEMA_INVALID');
  const resources = body.result.resources.filter(
    (item: any) =>
      String(item.format || '').toUpperCase() === 'KML' && item.url,
  );
  if (resources.length !== 1)
    throw new Error('KML_RESOURCE_AMBIGUOUS_OR_MISSING');
  return recoveredKmlRows(
    sourceKey,
    await requestBytes(
      String(resources[0].url),
      'application/zip,application/x-zip-compressed,application/octet-stream',
    ),
  );
}
