import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import type { SourceDef } from './index';

export type SourceStatus =
  | 'ACTIVE'
  | 'DEGRADED'
  | 'DISABLED'
  | 'CANDIDATE'
  | 'VALIDATING'
  | 'VERIFIED'
  | 'REVIEW_REQUIRED'
  | 'REJECTED';
export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_VERIFIED';
export type SourceCheckName =
  | 'accessibility'
  | 'response_type'
  | 'schema'
  | 'parser'
  | 'authentication'
  | 'pagination'
  | 'freshness';
export type SourceChecks = Record<SourceCheckName, CheckStatus>;
export type SourceFailureKind =
  'TRANSIENT' | 'STRUCTURAL' | 'ACCESS_REVIEW' | 'OTHER';
export type SourceProbeResult = {
  recordCount?: number;
  schemaVersion?: string;
  lastRecordTimestamp?: string | null;
  freshnessWindowHours?: number | null;
  checks?: Partial<SourceChecks>;
};
export type SourceOutcome = SourceProbeResult & {
  ok: boolean;
  failureReason?: string;
  failureKind?: SourceFailureKind;
  responseLatencyMs?: number;
  retryCount?: number;
};
export type SourceRegistryRecord = {
  registry_schema_version: 1;
  source_id: string;
  source_name: string;
  publisher: string;
  jurisdiction: string;
  category: string;
  endpoint: string;
  provenance_url: string;
  dataset_id: string | null;
  machine_readable_format: string;
  licence_name: string | null;
  licence_url: string | null;
  access_requirements: string;
  legal_review_status: 'NOT_VERIFIED' | 'REVIEW_REQUIRED' | 'APPROVED';
  activation_basis: 'LEGACY_CONFIGURATION' | 'CONTROLLED_ADMISSION';
  contract_version: string;
  status: SourceStatus;
  collection_blocked: boolean;
  collection_hold_reason: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  failure_reason: string | null;
  response_latency: number | null;
  schema_version: string | null;
  last_record_timestamp: string | null;
  freshness_status: 'FRESH' | 'STALE' | 'NOT_VERIFIED';
  freshness_window_hours: number | null;
  checks: SourceChecks;
  retry_count: number;
  backfill_checkpoint: unknown;
  backfill_complete: boolean | null;
  records_processed: number | null;
  evidence_processed: number | null;
  created_at: string;
  updated_at: string;
  admission?: Record<string, unknown>;
};
export const SOURCE_CHECK_NAMES: SourceCheckName[] = [
  'accessibility',
  'response_type',
  'schema',
  'parser',
  'authentication',
  'pagination',
  'freshness',
];
export const unverifiedSourceChecks = (): SourceChecks =>
  Object.fromEntries(
    SOURCE_CHECK_NAMES.map((key) => [key, 'NOT_VERIFIED']),
  ) as SourceChecks;
const validStatuses = new Set<SourceStatus>([
  'ACTIVE',
  'DEGRADED',
  'DISABLED',
  'CANDIDATE',
  'VALIDATING',
  'VERIFIED',
  'REVIEW_REQUIRED',
  'REJECTED',
]);
const reason = (value: unknown) =>
  (value instanceof Error ? value.message : String(value)).slice(0, 2000);
const registryTable = (key: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(key))
    throw new Error('SOURCE_KEY_INVALID');
  return 'automation_source:' + key;
};
function contractVersion(source: SourceDef) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        source.endpoint,
        source.provenance,
        source.owner,
        source.licence,
        source.method,
      ]),
    )
    .digest('hex');
}

/** One bounded logical table per compiled source. SDK has no unique keys/CAS: callers must serialize all registry writers. */
export async function readAutomationSourceRecord(
  key: string,
): Promise<(SourceRegistryRecord & { id: string }) | null> {
  const page = await db.list<SourceRegistryRecord>(registryTable(key), {
    limit: 2,
  });
  if (page.items.length > 1 || page.nextToken)
    throw new Error('SOURCE_REGISTRY_CONFLICT:' + key);
  const row = page.items[0];
  if (!row) return null;
  if (
    row.registry_schema_version !== 1 ||
    row.source_id !== key ||
    !row.id ||
    !validStatuses.has(row.status) ||
    !Number.isInteger(row.consecutive_failures) ||
    row.consecutive_failures < 0 ||
    typeof row.collection_blocked !== 'boolean' ||
    !row.checks ||
    SOURCE_CHECK_NAMES.some(
      (name) => !['PASS', 'FAIL', 'NOT_VERIFIED'].includes(row.checks[name]),
    )
  )
    throw new Error('SOURCE_REGISTRY_INVALID:' + key);
  return row;
}

/** Checked full replacement; existing SDK IDs remain the storage identity. No retry for unacknowledged writes or quota. */
export async function saveAutomationSourceRecord(
  record: SourceRegistryRecord,
  existingId?: string,
): Promise<SourceRegistryRecord> {
  const { id: _id, ...data } = record as SourceRegistryRecord & { id?: string };
  if (existingId) {
    const result = await db.update(registryTable(record.source_id), [
      { id: existingId, record: data },
    ]);
    if (result.length !== 1 || result[0] !== true)
      throw new Error('SOURCE_REGISTRY_WRITE_FAILED:' + record.source_id);
  } else {
    const result = await db.add(registryTable(record.source_id), [data]);
    if (result.length !== 1 || typeof result[0] !== 'string' || !result[0])
      throw new Error('SOURCE_REGISTRY_WRITE_FAILED:' + record.source_id);
  }
  return data;
}

export function initialSourceRecord(source: SourceDef): SourceRegistryRecord {
  registryTable(source.key);
  const now = new Date().toISOString();
  let dataset: string | null = null;
  try {
    const endpoint = new URL(source.endpoint);
    dataset =
      endpoint.searchParams.get('resource_id') ||
      endpoint.searchParams.get('id');
    if (
      !dataset &&
      /\/(?:MapServer|FeatureServer)\/\d+/i.test(endpoint.pathname)
    )
      dataset = endpoint.origin + endpoint.pathname.replace(/\/query\/?$/i, '');
  } catch {
    /* Metadata remains unknown; this function never fetches a supplied URL. */
  }
  const format: Record<SourceDef['method'], string> = {
    ARCGIS: 'ArcGIS REST JSON',
    CKAN_DATASTORE: 'CKAN JSON',
    CKAN_PACKAGE: 'CKAN JSON',
    QLD_TENURE: 'CKAN JSON',
    OCDS: 'OCDS JSON',
    OPENDATASOFT: 'JSON',
    WFS: 'WFS',
    WFS_MATCH: 'WFS',
    WFS_DIRECT: 'WFS',
    CKAN_KML: 'KML',
    XLSX_PROJECT: 'XLSX',
    GEOJSON: 'GeoJSON',
  };
  return {
    registry_schema_version: 1,
    source_id: source.key,
    source_name: source.name,
    publisher: source.owner,
    jurisdiction: source.territory,
    category: source.sector,
    endpoint: source.endpoint,
    provenance_url: source.provenance,
    dataset_id: dataset,
    machine_readable_format: format[source.method],
    licence_name: source.licence || null,
    licence_url: null,
    access_requirements: 'NOT_VERIFIED',
    legal_review_status: 'NOT_VERIFIED',
    activation_basis: 'LEGACY_CONFIGURATION',
    contract_version: contractVersion(source),
    status: source.enabled === false ? 'DISABLED' : 'ACTIVE',
    collection_blocked: source.enabled === false,
    collection_hold_reason:
      source.enabled === false
        ? reason(source.disableReason || 'DISABLED_IN_EXISTING_CONFIGURATION')
        : null,
    last_checked_at: null,
    last_success_at: null,
    last_failure_at: null,
    consecutive_failures: 0,
    failure_reason:
      source.enabled === false
        ? reason(source.disableReason || 'DISABLED_IN_EXISTING_CONFIGURATION')
        : null,
    response_latency: null,
    schema_version: null,
    last_record_timestamp: null,
    freshness_status: 'NOT_VERIFIED',
    freshness_window_hours: null,
    checks: unverifiedSourceChecks(),
    retry_count: 0,
    backfill_checkpoint: null,
    backfill_complete: null,
    records_processed: null,
    evidence_processed: null,
    created_at: now,
    updated_at: now,
  };
}

async function ensureSourceRecord(source: SourceDef) {
  const existing = await readAutomationSourceRecord(source.key);
  if (!existing) {
    await saveAutomationSourceRecord(initialSourceRecord(source));
    const inserted = await readAutomationSourceRecord(source.key);
    if (!inserted)
      throw new Error('SOURCE_REGISTRY_WRITE_NOT_VISIBLE:' + source.key);
    return inserted;
  }
  if (existing.contract_version !== contractVersion(source)) {
    const changed = {
      ...existing,
      status: 'REVIEW_REQUIRED' as const,
      collection_blocked: true,
      legal_review_status: 'REVIEW_REQUIRED' as const,
      failure_reason: 'SOURCE_ACCESS_CONTRACT_CHANGED',
      collection_hold_reason: 'SOURCE_ACCESS_CONTRACT_CHANGED',
      updated_at: new Date().toISOString(),
    };
    // Preserve the reviewed/original endpoint and licence rather than silently accepting changed metadata.
    await saveAutomationSourceRecord(changed, existing.id);
    return changed;
  }
  if (source.enabled === false && existing.status !== 'DISABLED') {
    const disabledReason = reason(
      source.disableReason || 'DISABLED_IN_EXISTING_CONFIGURATION',
    );
    const disabled = {
      ...existing,
      status: 'DISABLED' as const,
      collection_blocked: true,
      collection_hold_reason: disabledReason,
      failure_reason: disabledReason,
      updated_at: new Date().toISOString(),
    };
    await saveAutomationSourceRecord(disabled, existing.id);
    return disabled;
  }
  return existing;
}

export async function initializeSourceRegistry(
  sources: readonly SourceDef[],
): Promise<SourceRegistryRecord[]> {
  const records: SourceRegistryRecord[] = [];
  for (const source of sources) records.push(await ensureSourceRecord(source));
  return records;
}

/** Read-only: missing records are explicitly absent and never represented as observed production success. */
export async function readSourceRegistry(
  sources: readonly SourceDef[],
): Promise<SourceRegistryRecord[]> {
  const rows: SourceRegistryRecord[] = [];
  for (const source of sources) {
    const row = await readAutomationSourceRecord(source.key);
    if (row) rows.push(row);
  }
  return rows;
}

export async function isSourceCollectionAllowed(
  source: SourceDef,
): Promise<boolean> {
  if (source.enabled === false) return false;
  const saved = await readAutomationSourceRecord(source.key);
  // The additive migration preserves the existing source activation until a registry row is initialized.
  if (!saved) return true;
  return (
    saved.contract_version === contractVersion(source) &&
    !saved.collection_blocked &&
    ['ACTIVE', 'DEGRADED'].includes(saved.status)
  );
}

export function classifySourceFailure(message: string): SourceFailureKind {
  if (
    /HTTP_(401|403)\b|AUTHENTICATION_REQUIRED|AUTH_REQUIRED|LICEN[CS]E_(?:CHANGED|REVOKED|REQUIRED)|ACCESS_(?:CHANGED|DENIED)|PROVIDER_CHALLENGE|SOURCE_CHECK_FAILED:authentication/i.test(
      message,
    )
  )
    return 'ACCESS_REVIEW';
  if (
    /SCHEMA|PARSER|PARSE|Unexpected token|JSON|REQUIRED_FIELDS|PAGINATION|NON_INCREASING|REPEATED_PAGE|INVALID_BODY|SOURCE_BODY_TOO_LARGE|SOURCE_PROBE_PAGE_LIMIT|SOURCE_CHECK_FAILED:(?:schema|parser|response_type|pagination)/i.test(
      message,
    )
  )
    return 'STRUCTURAL';
  if (
    /HTTP_(408|425|500|502|503|504)\b|^fetch failed$|^Failed to fetch$|ECONNRESET|ETIMEDOUT|\bAbortError\b|operation was aborted/i.test(
      message,
    )
  )
    return 'TRANSIENT';
  return 'OTHER';
}

export async function recordSourceOutcome(
  source: SourceDef,
  outcome: SourceOutcome,
): Promise<SourceRegistryRecord> {
  const previous = await ensureSourceRecord(source);
  const now = new Date().toISOString();
  const checks = { ...unverifiedSourceChecks(), ...outcome.checks };
  let lastTimestamp = outcome.lastRecordTimestamp || null;
  const window =
    outcome.freshnessWindowHours &&
    Number.isFinite(outcome.freshnessWindowHours) &&
    outcome.freshnessWindowHours > 0
      ? outcome.freshnessWindowHours
      : null;
  let freshness: SourceRegistryRecord['freshness_status'] = 'NOT_VERIFIED';
  if (lastTimestamp) {
    const age = Date.parse(now) - Date.parse(lastTimestamp);
    if (!Number.isFinite(age) || age < 0) {
      checks.freshness = 'FAIL';
      lastTimestamp = null;
    } else if (window) {
      freshness = age <= window * 3600000 ? 'FRESH' : 'STALE';
      checks.freshness = freshness === 'FRESH' ? 'PASS' : 'FAIL';
    }
  }
  const schemaChanged = !!(
    previous.schema_version &&
    outcome.schemaVersion &&
    previous.schema_version !== outcome.schemaVersion
  );
  if (schemaChanged) checks.schema = 'FAIL';
  const failedCheck = SOURCE_CHECK_NAMES.find(
    (name) => name !== 'freshness' && checks[name] === 'FAIL',
  );
  const failureReason = !outcome.ok
    ? reason(outcome.failureReason || 'SOURCE_PROBE_FAILED')
    : schemaChanged
      ? 'SOURCE_SCHEMA_CHANGED'
      : failedCheck
        ? 'SOURCE_CHECK_FAILED:' + failedCheck
        : null;
  const ok = outcome.ok && !failureReason;
  const kind = failureReason
    ? outcome.failureKind || classifySourceFailure(failureReason)
    : null;
  if (outcome.ok && checks.accessibility === 'NOT_VERIFIED')
    checks.accessibility = 'PASS';
  if (!outcome.ok && kind === 'TRANSIENT') checks.accessibility = 'FAIL';
  if (kind === 'ACCESS_REVIEW') checks.authentication = 'FAIL';
  const failures = ok ? 0 : previous.consecutive_failures + 1;
  const protectedStatus = !['ACTIVE', 'DEGRADED'].includes(previous.status);
  const validatedRecovery =
    ok &&
    checks.schema === 'PASS' &&
    checks.parser === 'PASS' &&
    (!/PAGINATION|NON_INCREASING|REPEATED_PAGE|pagination/.test(
      previous.collection_hold_reason || '',
    ) ||
      checks.pagination === 'PASS') &&
    (previous.collection_hold_reason !== 'SOURCE_SCHEMA_CHANGED' ||
      outcome.schemaVersion === previous.schema_version);
  const structuralHold =
    kind === 'STRUCTURAL' ||
    (previous.collection_blocked && !validatedRecovery);
  const status: SourceStatus = protectedStatus
    ? previous.status
    : kind === 'ACCESS_REVIEW'
      ? 'REVIEW_REQUIRED'
      : structuralHold ||
          failures >= 3 ||
          freshness === 'STALE' ||
          checks.freshness === 'FAIL'
        ? 'DEGRADED'
        : ok
          ? 'ACTIVE'
          : previous.status;
  return saveAutomationSourceRecord(
    {
      ...previous,
      status,
      collection_blocked: protectedStatus
        ? previous.collection_blocked
        : kind === 'ACCESS_REVIEW' || structuralHold,
      collection_hold_reason: protectedStatus
        ? previous.collection_hold_reason
        : kind === 'ACCESS_REVIEW' || kind === 'STRUCTURAL'
          ? failureReason
          : structuralHold
            ? previous.collection_hold_reason
            : null,
      legal_review_status:
        kind === 'ACCESS_REVIEW'
          ? 'REVIEW_REQUIRED'
          : previous.legal_review_status,
      last_checked_at: now,
      last_success_at: ok ? now : previous.last_success_at,
      last_failure_at: ok ? previous.last_failure_at : now,
      consecutive_failures: failures,
      failure_reason: protectedStatus ? previous.failure_reason : failureReason,
      response_latency:
        typeof outcome.responseLatencyMs === 'number' &&
        Number.isFinite(outcome.responseLatencyMs) &&
        outcome.responseLatencyMs >= 0
          ? outcome.responseLatencyMs
          : null,
      schema_version: schemaChanged
        ? previous.schema_version
        : outcome.schemaVersion || previous.schema_version,
      last_record_timestamp: lastTimestamp,
      freshness_status: freshness,
      freshness_window_hours: window,
      checks,
      retry_count: outcome.retryCount || 0,
      updated_at: now,
    },
    previous.id,
  );
}

/** Probe callbacks must only retrieve/parse; they must not ingest evidence or modify checkpoints. */
export async function checkSourceHealth(
  source: SourceDef,
  probe: (source: SourceDef) => Promise<SourceProbeResult>,
): Promise<SourceRegistryRecord> {
  const saved = await ensureSourceRecord(source);
  if (
    source.enabled === false ||
    !['ACTIVE', 'DEGRADED'].includes(saved.status)
  )
    return saved;
  const start = Date.now();
  let retryCount = 0;
  let outcome: SourceOutcome;
  while (true) {
    try {
      const result = await probe(source);
      outcome = { ...result, ok: true };
      break;
    } catch (error) {
      const failure = reason(error);
      if (retryCount === 0 && classifySourceFailure(failure) === 'TRANSIENT') {
        retryCount++;
        continue;
      }
      outcome = { ok: false, failureReason: failure };
      break;
    }
  }
  // Persistence is deliberately outside the retry boundary. An SDK/quota failure is never a source retry.
  return recordSourceOutcome(source, {
    ...outcome,
    responseLatencyMs: Date.now() - start,
    retryCount,
  });
}
