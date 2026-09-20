import { createHash } from 'node:crypto';
import type { SourceDef } from './index';
import { sourceJson } from './source-helpers';
import {
  collectBackfillPage,
  prepareBackfillContext,
  normalizeEvidence,
  type Page,
} from './backfill-fetch';
import { fetchSourcePilot } from './source-pilots';
import type { SourcePilotContract } from './source-contracts';
import type { SourceProbeResult } from './source-automation';
import type { AdmissionProbeResult } from './source-admission';

/** Provider-declared schema only; optional fields in a sample cannot establish schema drift. */
async function arcgisSchema(
  source: { endpoint: string },
  requiredFields: readonly string[] = [],
) {
  const url = new URL(source.endpoint);
  url.pathname = url.pathname.replace(/\/query\/?$/i, '');
  url.search = '';
  url.searchParams.set('f', 'json');
  const metadata = (await sourceJson(url.toString())) as Record<
    string,
    unknown
  >;
  if (
    metadata.error &&
    typeof metadata.error === 'object' &&
    [401, 403, 498, 499].includes(
      Number((metadata.error as Record<string, unknown>).code),
    )
  )
    throw new Error('AUTHENTICATION_REQUIRED:ARCGIS');
  if (
    metadata.error ||
    !Array.isArray(metadata.fields) ||
    !metadata.fields.length
  )
    throw new Error('ARCGIS_SCHEMA_METADATA_INVALID');
  const fields = metadata.fields
    .map((field: unknown) => {
      if (
        !field ||
        typeof field !== 'object' ||
        !('name' in field) ||
        !('type' in field) ||
        typeof field.name !== 'string' ||
        !field.name.trim() ||
        typeof field.type !== 'string' ||
        !field.type.trim()
      )
        throw new Error('ARCGIS_SCHEMA_FIELDS_INVALID');
      return [field.name, field.type];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  const names = new Set(fields.map((field) => field[0]));
  if (names.size !== fields.length)
    throw new Error('ARCGIS_SCHEMA_FIELDS_INVALID');
  if (requiredFields.some((name) => !names.has(name)))
    throw new Error('ARCGIS_REQUIRED_FIELDS_MISSING');
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
async function melbournePermitSchema(source: SourceDef): Promise<string> {
  const url = new URL(source.endpoint);
  if (!/\/datasets\/building-permits\/records\/?$/.test(url.pathname))
    throw new Error('ODS_SCHEMA_METADATA_INVALID');
  url.pathname = url.pathname.replace(/\/records\/?$/, '');
  url.search = '';
  const metadata = await sourceJson(url.toString());
  if (
    metadata.dataset_id !== 'building-permits' ||
    !Array.isArray(metadata.fields) ||
    !metadata.fields.length
  )
    throw new Error('ODS_SCHEMA_METADATA_INVALID');
  const fields: [string, string][] = metadata.fields.map((field: any) => {
    if (
      !field ||
      typeof field.name !== 'string' ||
      !field.name.trim() ||
      typeof field.type !== 'string' ||
      !field.type.trim()
    )
      throw new Error('ODS_SCHEMA_FIELDS_INVALID');
    return [field.name, field.type];
  });
  const types = new Map(fields);
  if (types.size !== fields.length)
    throw new Error('ODS_SCHEMA_FIELDS_INVALID');
  for (const [name, type] of [
    ['permit_number', 'text'],
    ['issue_date', 'date'],
    ['address', 'text'],
    ['desc_of_works', 'text'],
  ]) {
    if (!types.has(name)) throw new Error('ODS_REQUIRED_FIELDS_MISSING');
    if (types.get(name) !== type)
      throw new Error('ODS_SCHEMA_REQUIRED_FIELD_TYPE_INVALID');
  }
  fields.sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
function checkedPage(page: Page) {
  if (!Array.isArray(page.rows) || page.rows.length > 100)
    throw new Error('SOURCE_PROBE_PAGE_LIMIT');
  if (
    !Number.isSafeInteger(page.next) ||
    page.next < 0 ||
    typeof page.completed !== 'boolean'
  )
    throw new Error('PAGINATION_CURSOR_INVALID');
  if (
    page.rows.some(
      (row) =>
        !row ||
        typeof row.externalId !== 'string' ||
        !row.externalId ||
        !row.raw ||
        typeof row.raw !== 'object' ||
        Array.isArray(row.raw),
    )
  )
    throw new Error('SOURCE_PROBE_ROW_SCHEMA_INVALID');
}
function canonicalEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalEvidence);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalEvidence(item)]),
    );
  return value;
}
function evidenceFingerprint(row: Page['rows'][number]) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        row.externalId,
        canonicalEvidence(row.originalEvidence || row.raw),
      ]),
    )
    .digest('hex');
}
export async function probeSource(
  source: SourceDef,
  collect: (source: SourceDef) => Promise<{
    recordsFetched: number;
    opportunities: Array<{ sourceObservedAt?: string }>;
  }>,
): Promise<SourceProbeResult> {
  let schemaVersion =
    source.method === 'ARCGIS'
      ? await arcgisSchema(source)
      : source.method === 'OPENDATASOFT' &&
          source.key === 'melbourne-building-permits'
        ? await melbournePermitSchema(source)
        : undefined;
  // These two legacy methods lack a historical adapter; retain a bounded live parser probe.
  if (['QLD_TENURE', 'WFS_MATCH'].includes(source.method)) {
    const result = await collect(source);
    return {
      recordCount: result.recordsFetched,
      lastRecordTimestamp: latestDate(result.opportunities),
      checks: {
        accessibility: 'PASS',
        response_type: 'PASS',
        parser: result.recordsFetched ? 'PASS' : 'NOT_VERIFIED',
        authentication: 'PASS',
        schema: 'NOT_VERIFIED',
        pagination: 'NOT_VERIFIED',
        freshness: 'NOT_VERIFIED',
      },
    };
  }
  const context = await prepareBackfillContext(source, 0);
  const first = await collectBackfillPage(source, 0, undefined, context);
  checkedPage(first);
  if (
    source.method === 'XLSX_PROJECT' &&
    source.key === 'aemo-key-connection-information'
  )
    schemaVersion = first.schemaVersion;
  let rows = first.rows;
  let paginationVerified = false;
  if (!first.completed) {
    if (!first.nextUrl && first.next <= 0)
      throw new Error('PAGINATION_NOT_ADVANCING');
    const second = await collectBackfillPage(
      source,
      first.next,
      first.nextUrl,
      { ...context, ...first.context },
    );
    checkedPage(second);
    if (first.schemaVersion !== second.schemaVersion)
      throw new Error('SOURCE_SCHEMA_CHANGED');
    // One source identity can have several factual versions or component rows.
    // Only repeated evidence across requests proves overlapping source pages.
    const firstEvidence = new Set(first.rows.map(evidenceFingerprint));
    if (second.rows.some((row) => firstEvidence.has(evidenceFingerprint(row))))
      throw new Error('PAGINATION_REPEATED_PAGE');
    if (
      !second.completed &&
      second.next <= first.next &&
      second.nextUrl === first.nextUrl
    )
      throw new Error('PAGINATION_NOT_ADVANCING');
    rows = [...rows, ...second.rows];
    paginationVerified = first.rows.length > 0 && second.rows.length > 0;
  }
  const normalized = rows.map((row) =>
    normalizeEvidence(source, row, new Date().toISOString()),
  );
  return {
    recordCount: rows.length,
    schemaVersion,
    lastRecordTimestamp: latestDate(normalized),
    checks: {
      accessibility: 'PASS',
      response_type: 'PASS',
      parser: rows.length ? 'PASS' : 'NOT_VERIFIED',
      authentication: 'PASS',
      schema: schemaVersion ? 'PASS' : 'NOT_VERIFIED',
      pagination: paginationVerified ? 'PASS' : 'NOT_VERIFIED',
      freshness: 'NOT_VERIFIED',
    },
  };
}
function latestDate(rows: Array<{ sourceObservedAt?: string }>) {
  const timestamps = rows
    .map((row) => Date.parse(row.sourceObservedAt || ''))
    .filter(Number.isFinite);
  return timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : null;
}
export async function probeCandidate(
  contract: SourcePilotContract,
): Promise<AdmissionProbeResult> {
  const schemaVersion = await arcgisSchema(contract, contract.requiredFields);
  const result = await fetchSourcePilot(contract.key, {
    pageSize: 10,
    maxPages: 2,
    maxRows: 20,
  });
  const missingFields = result.quarantine.some((row) =>
    row.qualityFlags.some((flag) => flag.startsWith('MISSING_FIELD:')),
  );
  return {
    recordCount: result.fetch.rowsFetched,
    schemaVersion,
    lastRecordTimestamp: latestDate(result.evidence),
    checks: {
      accessibility: 'PASS',
      response_type: 'PASS',
      schema: 'PASS',
      parser: result.quarantine.length
        ? 'FAIL'
        : result.fetch.rowsFetched
          ? 'PASS'
          : 'NOT_VERIFIED',
      authentication: 'PASS',
      pagination:
        result.fetch.pages >= 2 && result.fetch.rowsFetched > 10
          ? 'PASS'
          : 'NOT_VERIFIED',
      freshness: 'NOT_VERIFIED',
    },
    requiredFields: missingFields ? 'FAIL' : 'PASS',
    rateLimits: 'NOT_VERIFIED',
    reproducibility: 'NOT_VERIFIED',
  };
}
