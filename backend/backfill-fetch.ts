import { RECOVERED_KML_MEMBERS } from './feed-recovery';
import {
  findField,
  recordIdentity,
  projectRecordIdentity,
  sourceWfsPage,
  RECOVERED_WFS_LAYERS,
  sourceJson,
  sourceText,
  sourceWorkbook,
  projectWorkbookRows,
  ckanResourceRows,
  ckanKmlRows,
  selectCkanResource,
  paginationTotal,
  paginationCompleted,
  sourceWfsRows,
  checkpointWfsPage,
  validateWfsCheckpoint,
  wfsMatchedTotal,
  type WfsCheckpoint,
  type CkanResource,
} from './source-helpers';
import { read, utils } from 'xlsx';
import { extractSourceDate, inferOrganisation } from './domain-hardening';

export type BackfillSource = {
  key: string;
  territory: string;
  method: string;
  endpoint: string;
  provenance: string;
  owner?: string;
  publisher?: string;
  datasetId?: string;
  licence?: string;
  licenceUrl?: string;
};
export type RawRow = {
  externalId: string;
  raw: Record<string, unknown>;
  originalEvidence?: Record<string, unknown>;
  qualityFlags?: string[];
};
export type BackfillContext = {
  anchorAt?: string;
  ckanResource?: CkanResource;
  wfs?: WfsCheckpoint;
  wfsLayer?: string;
  kmlSnapshot?: string;
};
export type Page = {
  rows: RawRow[];
  next: number;
  completed: boolean;
  nextUrl?: string;
  context?: BackfillContext;
};
export type Evidence = {
  rawEvidence?: Record<string, unknown>;
  publisher?: string;
  dataset?: string;
  sourceUrl?: string;
  sourceRecordId?: string;
  licence?: string;
  licenceUrl?: string;
  evidenceConfidence?: unknown;
  inferenceStatus?: unknown;
  qualityFlags?: string[];
  sourceKey: string;
  externalId: string;
  project: string;
  company: string;
  organisationRole?:
    | 'DELIVERY_CONTRACTOR'
    | 'OWNER_PROPONENT'
    | 'APPLICANT_HOLDER'
    | 'SUPPLIER'
    | 'OPERATOR'
    | 'UNKNOWN';
  location: string;
  description: string;
  observedAt: string;
  sourceObservedAt?: string;
  provenance: string;
  evidenceType: 'EXPLICIT';
};
const BATCH = 100;
const MAX_DAYS = 3650;
const text = (v: unknown) =>
  typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
const stripHtml = (v: unknown) =>
  text(v)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const find = findField;

const jsonFetch = sourceJson;
const textFetch = sourceText;
const workbook = sourceWorkbook;

export function normalizeEvidence(
  source: BackfillSource,
  row: RawRow,
  observedAt: string,
): Evidence {
  const organisation = inferOrganisation(source.key, row.raw);
  return {
    sourceKey: source.key,
    externalId: row.externalId,
    rawEvidence: structuredClone(row.originalEvidence || row.raw),
    publisher: source.publisher || source.owner,
    dataset: source.datasetId,
    sourceUrl: source.provenance,
    sourceRecordId: row.externalId,
    licence: source.licence,
    licenceUrl: source.licenceUrl,
    evidenceConfidence: row.raw.evidenceConfidence ?? row.raw.confidence,
    inferenceStatus: row.raw.inferenceStatus ?? row.raw.inference_status,
    qualityFlags: row.qualityFlags ? [...new Set(row.qualityFlags)] : undefined,
    project:
      find(row.raw, [
        'projectname',
        'sitename',
        'project',
        'projecttitle',
        'tenement',
        'tenure',
        'permitnumber',
        'authoritynumber',
        'contractid',
        'title',
        'name',
        'description',
      ]) || row.externalId,
    company: organisation.name,
    organisationRole: organisation.role,
    location:
      find(row.raw, [
        'locality',
        'location',
        'shire',
        'lga',
        'miningdistrict',
        'region',
        'district',
        'area',
        'state',
      ]) || source.territory,
    description: find(row.raw, [
      'description',
      'activity',
      'purpose',
      'commodity',
      'resource',
      'permittype',
      'type',
      'status',
      'industry',
    ]),
    observedAt,
    sourceObservedAt: extractSourceDate(row.raw, observedAt),
    provenance: source.provenance,
    evidenceType: 'EXPLICIT',
  };
}
function params(sourceUrl: string, values: Record<string, string>) {
  const url = new URL(sourceUrl);
  Object.entries(values).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  return url.toString();
}

async function arcgis(source: BackfillSource, cursor: number): Promise<Page> {
  const body = await jsonFetch(
    params(source.endpoint, {
      resultOffset: String(cursor),
      resultRecordCount: String(BATCH),
      f: 'json',
    }),
  );
  if (body.error || !Array.isArray(body.features))
    throw new Error('ARCGIS_SCHEMA_INVALID');
  const rows = body.features.map((feature: any) => ({
    externalId: recordIdentity(feature.attributes || {}),
    raw: (feature.attributes || {}) as Record<string, unknown>,
    originalEvidence: Object.keys(feature).some((key) => key !== 'attributes')
      ? feature
      : undefined,
  }));
  const total = paginationTotal(body.total ?? body.totalCount, 'ARCGIS');
  let completed = paginationCompleted(
    'ARCGIS',
    cursor,
    rows.length,
    BATCH,
    total,
  );
  if (body.exceededTransferLimit === true) {
    if (!rows.length) throw new Error('ARCGIS_PAGE_NO_PROGRESS');
    if (total !== undefined && completed)
      throw new Error('ARCGIS_TOTAL_CONTRADICTION');
    completed = false;
  } else if (body.exceededTransferLimit === false) {
    if (total !== undefined && !completed)
      throw new Error('ARCGIS_TOTAL_CONTRADICTION');
    completed = true;
  }
  return { rows, next: cursor + rows.length, completed };
}
async function datastore(
  source: BackfillSource,
  cursor: number,
): Promise<Page> {
  const body = await jsonFetch(
    params(source.endpoint, { limit: String(BATCH), offset: String(cursor) }),
  );
  if (body.success !== true || !Array.isArray(body.result?.records))
    throw new Error('CKAN_SCHEMA_INVALID');
  const rows = body.result.records.map((row: Record<string, unknown>) => ({
    externalId: recordIdentity(row),
    raw: row,
  }));
  const total = paginationTotal(body.result.total, 'CKAN');
  return {
    rows,
    next: cursor + rows.length,
    completed: paginationCompleted('CKAN', cursor, rows.length, BATCH, total),
  };
}
async function ods(source: BackfillSource, cursor: number): Promise<Page> {
  const url = new URL(source.endpoint);
  url.searchParams.delete('order_by');
  url.searchParams.set('limit', String(BATCH));
  url.searchParams.set('offset', String(cursor));
  let body: any;
  try {
    body = await jsonFetch(url.toString());
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'HTTP_400' &&
      cursor === 0
    ) {
      url.searchParams.delete('offset');
      body = await jsonFetch(url.toString());
    } else throw error;
  }
  if (!Array.isArray(body.results)) throw new Error('ODS_SCHEMA_INVALID');
  const rows = body.results.map((row: Record<string, unknown>) => ({
    externalId: recordIdentity(row),
    raw: row,
  }));
  const total = paginationTotal(body.total_count, 'ODS');
  return {
    rows,
    next: cursor + rows.length,
    completed: paginationCompleted('ODS', cursor, rows.length, BATCH, total),
  };
}
async function wfs(
  source: BackfillSource,
  cursor: number,
  context?: BackfillContext,
): Promise<Page> {
  if (
    RECOVERED_WFS_LAYERS[source.key] ||
    /[?&]typeNames?=/i.test(source.endpoint)
  )
    return wfsDirect(source, cursor, context);
  let names = context?.wfsLayer ? [context.wfsLayer] : [];
  if (!names.length) {
    const capabilities = await textFetch(
      params(source.endpoint, {
        service: 'WFS',
        version: '1.1.0',
        request: 'GetCapabilities',
      }),
    );
    names = [
      ...capabilities.matchAll(
        /<(?:\w+:)?FeatureType\b[^>]*>([\s\S]*?)<\/(?:\w+:)?FeatureType>/gi,
      ),
    ]
      .map(
        (match) =>
          match[1]
            .match(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/i)?.[1]
            ?.trim() || '',
      )
      .filter(Boolean)
      .slice(0, 4);
  }
  if (!names.length) throw new Error('WFS_NO_FEATURE_TYPES');
  for (const name of names) {
    const requestUrl = params(source.endpoint, {
      service: 'WFS',
      version: '1.1.0',
      request: 'GetFeature',
      typeName: name,
      outputFormat: 'application/json',
      maxFeatures: String(BATCH),
      startIndex: String(cursor),
    });
    validateWfsCheckpoint(source.key, requestUrl, cursor, context?.wfs);
    let body: any;
    try {
      body = await jsonFetch(requestUrl);
    } catch (error) {
      if (context?.wfsLayer) throw error;
      continue;
    }
    if (body.error || !Array.isArray(body.features)) {
      if (context?.wfsLayer) throw new Error('WFS_SCHEMA_INVALID');
      continue;
    }
    if (body.features.length > BATCH) throw new Error('WFS_PAGE_OVERFLOW');
    // Once a valid layer responds, integrity failures must surface, never select a different layer.
    const rows = retainWfsEvidence(
      source.key,
      sourceWfsRows(source.key, body.features),
      body.features,
    );
    const checkpoint = checkpointWfsPage(
      source.key,
      requestUrl,
      cursor,
      body.features,
      context?.wfs,
    );
    const completed = paginationCompleted(
      'WFS',
      cursor,
      body.features.length,
      BATCH,
      wfsMatchedTotal(body),
    );
    return {
      rows,
      next: cursor + body.features.length,
      completed,
      context: { ...context, wfsLayer: name, wfs: checkpoint },
    };
  }
  throw new Error('WFS_NO_JSON_FEATURES');
}
function retainWfsEvidence(
  sourceKey: string,
  rows: RawRow[],
  features: unknown[],
): RawRow[] {
  const originals = new Map<string, unknown[]>();
  // Keep every original multipart feature even when the established normalizer
  // combines matching source identities for display.
  for (const feature of features) {
    const id = sourceWfsRows(sourceKey, [feature])[0].externalId;
    originals.set(id, [...(originals.get(id) || []), feature]);
  }
  return rows.map((row) => ({
    ...row,
    originalEvidence: { features: originals.get(row.externalId) || [] },
  }));
}
async function wfsDirect(
  source: BackfillSource,
  cursor: number,
  context?: BackfillContext,
): Promise<Page> {
  let originalFeatures: unknown[] = [];
  const { checkpoint, ...page } = await sourceWfsPage(
    source,
    cursor,
    BATCH,
    async (url) => {
      const body = await sourceJson(url);
      if (Array.isArray(body.features)) originalFeatures = body.features;
      return body;
    },
    context?.wfs,
  );
  return {
    ...page,
    rows: retainWfsEvidence(source.key, page.rows, originalFeatures),
    context: { ...context, wfs: checkpoint },
  };
}
function validateOcdsPageUrl(
  candidate: string,
  endpoint: string,
  expectedPath?: string,
) {
  const url = new URL(candidate);
  const base = new URL(endpoint);
  const suffix = url.pathname.slice(base.pathname.length);
  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(base.pathname + '/') ||
    !/^\/\d{4}-\d{2}-\d{2}T[\d:]+Z\/\d{4}-\d{2}-\d{2}T[\d:]+Z$/.test(suffix) ||
    (expectedPath && url.pathname !== expectedPath)
  )
    throw new Error('OCDS_PAGINATION_URL_INVALID');
  return url.toString();
}
export async function prepareBackfillContext(
  source: BackfillSource,
  cursor: number,
  nextUrl?: string,
  context?: BackfillContext,
): Promise<BackfillContext> {
  if (source.method === 'CKAN_PACKAGE' && !context?.ckanResource) {
    const resource = await selectCkanResource(source.endpoint);
    if (!resource) throw new Error('CKAN_RESOURCE_MISSING');
    return { ...context, ckanResource: resource };
  }
  if (source.method === 'OCDS' && !context?.anchorAt) {
    const end = nextUrl
      ? new URL(validateOcdsPageUrl(nextUrl, source.endpoint)).pathname
          .split('/')
          .at(-1)
      : undefined;
    const anchorAt = end
      ? new Date(Date.parse(end) + cursor * 86400000).toISOString()
      : new Date().toISOString();
    return { ...context, anchorAt };
  }
  return context || {};
}

async function ocds(
  source: BackfillSource,
  cursor: number,
  savedNextUrl?: string,
  context?: BackfillContext,
): Promise<Page> {
  const savedEnd = savedNextUrl
    ? new URL(validateOcdsPageUrl(savedNextUrl, source.endpoint)).pathname
        .split('/')
        .at(-1)
    : undefined;
  const anchorAt =
    context?.anchorAt ||
    (savedEnd
      ? new Date(Date.parse(savedEnd) + cursor * 86400000).toISOString()
      : new Date().toISOString());
  if (!Number.isFinite(Date.parse(anchorAt)))
    throw new Error('OCDS_ANCHOR_INVALID');
  const end = new Date(Date.parse(anchorAt) - cursor * 86400000);
  const start = new Date(end.getTime() - 7 * 86400000);
  const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = validateOcdsPageUrl(
    savedNextUrl || source.endpoint + '/' + iso(start) + '/' + iso(end),
    source.endpoint,
  );
  const body = (await jsonFetch(url)) as any;
  if (!Array.isArray(body.releases) && !Array.isArray(body.records))
    throw new Error('OCDS_SCHEMA_INVALID');
  const releases = Array.isArray(body.releases)
    ? body.releases
    : body.records.flatMap((record: any) => record.releases || []);
  if (releases.length > BATCH) throw new Error('OCDS_PAGE_OVERFLOW');
  const rows = releases.map((release: any) => {
    const contract = release.contracts?.[0];
    const award = release.awards?.[0];
    return {
      externalId:
        text(contract?.id || release.id || release.ocid) ||
        recordIdentity(release),
      originalEvidence: release,
      raw: {
        title: release.tender?.title || contract?.id || release.id,
        description: release.tender?.description || award?.description || '',
        supplier: award?.suppliers?.[0]?.name || '',
        location: 'Australia',
        value: contract?.value?.amount ?? award?.value?.amount ?? '',
        date: release.date || '',
      },
    };
  });
  const nextUrl = body.links?.next
    ? validateOcdsPageUrl(
        String(body.links.next),
        source.endpoint,
        new URL(url).pathname,
      )
    : undefined;
  if (nextUrl === url) throw new Error('OCDS_PAGINATION_LOOP');
  return {
    rows,
    next: nextUrl ? cursor : cursor + 7,
    nextUrl,
    context: { ...context, anchorAt },
    completed: !nextUrl && cursor + 7 >= MAX_DAYS,
  };
}

async function ckanPackage(
  source: BackfillSource,
  cursor: number,
  context?: BackfillContext,
): Promise<Page> {
  const page = await ckanResourceRows(
    source.endpoint,
    BATCH,
    cursor,
    context?.ckanResource,
  );
  return {
    rows: page.rows,
    next: cursor + page.rows.length,
    context: { ...context, ckanResource: page.resource },
    completed: paginationCompleted(
      'CKAN',
      cursor,
      page.rows.length,
      BATCH,
      page.total,
    ),
  };
}
async function kml(
  source: BackfillSource,
  cursor: number,
  context?: BackfillContext,
): Promise<Page> {
  if (RECOVERED_KML_MEMBERS[source.key]) {
    if (cursor > 0 && !context?.kmlSnapshot)
      throw new Error('KML_CHECKPOINT_REQUIRED_RESTART');
    const page = await ckanKmlRows(source.key, source.endpoint);
    if (context?.kmlSnapshot && context.kmlSnapshot !== page.snapshot)
      throw new Error('KML_SNAPSHOT_CHANGED');
    if (cursor > page.rows.length) throw new Error('KML_CURSOR_INVALID');
    const rows = page.rows.slice(cursor, cursor + BATCH);
    return {
      rows,
      next: cursor + rows.length,
      completed: cursor + rows.length >= page.rows.length,
      context: { ...context, kmlSnapshot: page.snapshot },
    };
  }
  const body = (await jsonFetch(source.endpoint)) as any;
  if (body.success !== true || !Array.isArray(body.result?.resources))
    throw new Error('CKAN_SCHEMA_INVALID');
  const resource = body.result.resources.find(
    (item: any) =>
      String(item.format || '').toUpperCase() === 'KML' && item.url,
  );
  if (!resource?.url) throw new Error('KML_RESOURCE_MISSING');
  const xml = await textFetch(String(resource.url));
  const all = [
    ...xml.matchAll(
      /<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi,
    ),
  ];
  const rows = all.slice(cursor, cursor + BATCH).map((match, index) => {
    const block = match[1];
    const name =
      block
        .match(/<(?:\w+:)?name>([\s\S]*?)<\/(?:\w+:)?name>/i)?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .trim() || '';
    const description =
      block
        .match(/<(?:\w+:)?description>([\s\S]*?)<\/(?:\w+:)?description>/i)?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || '';
    return {
      externalId: name || text(cursor + index + 1),
      originalEvidence: { placemark: block },
      raw: { name, description },
    };
  });
  return {
    rows,
    next: cursor + rows.length,
    completed: cursor + rows.length >= all.length,
  };
}
function geoJsonRaw(feature: any): Record<string, unknown> {
  const props = (feature?.properties || {}) as Record<string, unknown>;
  const roads = Array.isArray((props as any).roads) ? (props as any).roads : [];
  const road = (roads[0] || {}) as Record<string, unknown>;
  const title = [
    text(road.mainStreet) ||
      text((props as any).name) ||
      text((props as any).headline) ||
      text((props as any).displayName),
    text((props as any).subCategoryA),
    text(road.suburb),
  ]
    .filter(Boolean)
    .join(' · ');
  const location = [text(road.suburb), text(road.region)]
    .filter(Boolean)
    .join(', ');
  const description = [
    text((props as any).mainCategory),
    text((props as any).subCategoryA),
    stripHtml((props as any).otherAdvice),
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    ...props,
    title: title || text(feature?.id) || 'Published roadwork',
    road: text(road.mainStreet),
    suburb: text(road.suburb),
    region: text(road.region),
    location,
    description,
  };
}
async function geojson(source: BackfillSource, cursor: number): Promise<Page> {
  const body = (await jsonFetch(source.endpoint)) as any;
  if (!Array.isArray(body.features)) throw new Error('GEOJSON_SCHEMA_INVALID');
  const all = body.features;
  const rows = all
    .slice(cursor, cursor + BATCH)
    .map((feature: any, index: number) => ({
      externalId: text(
        feature.id || feature.properties?.id || cursor + index + 1,
      ),
      raw: geoJsonRaw(feature),
      originalEvidence: feature,
    }));
  return {
    rows,
    next: cursor + rows.length,
    completed: cursor + rows.length >= all.length,
  };
}
async function projectXlsx(
  source: BackfillSource,
  cursor: number,
): Promise<Page> {
  const all = projectWorkbookRows(
    source.key,
    await workbook(source.endpoint),
    true,
  );
  const rows = all.slice(cursor, cursor + BATCH).map((raw) => ({
    externalId: projectRecordIdentity(source.key, raw),
    raw,
  }));
  return {
    rows,
    next: cursor + rows.length,
    completed: cursor + rows.length >= all.length,
  };
}

export async function collectBackfillPage(
  source: BackfillSource,
  cursor: number,
  nextUrl?: string,
  context?: BackfillContext,
): Promise<Page> {
  if (
    (source.method === 'WFS' || source.method === 'WFS_DIRECT') &&
    cursor > 0 &&
    !context?.wfs
  )
    throw new Error('WFS_CHECKPOINT_REQUIRED_RESTART');
  if (source.method === 'ARCGIS') return arcgis(source, cursor);
  if (source.method === 'CKAN_DATASTORE') return datastore(source, cursor);
  if (source.method === 'CKAN_PACKAGE')
    return ckanPackage(source, cursor, context);
  if (source.method === 'OCDS') return ocds(source, cursor, nextUrl, context);
  if (source.method === 'OPENDATASOFT') return ods(source, cursor);
  if (source.method === 'WFS') return wfs(source, cursor, context);
  if (source.method === 'WFS_DIRECT') return wfsDirect(source, cursor, context);
  if (source.method === 'CKAN_KML') return kml(source, cursor, context);
  if (source.method === 'XLSX_PROJECT') return projectXlsx(source, cursor);
  if (source.method === 'GEOJSON') return geojson(source, cursor);
  throw new Error('BACKFILL_METHOD_UNSUPPORTED:' + source.method);
}
