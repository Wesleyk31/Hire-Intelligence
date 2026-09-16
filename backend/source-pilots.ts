import {
  SOURCE_PILOT_CONTRACTS,
  type SourcePilotKey,
} from './source-contracts';
import { sourceJson } from './source-helpers';

type Attributes = Record<string, unknown>;
export type PilotContext = {
  retrievedAt: string;
  sourceLastModifiedAt?: string;
};
/** Can be stored as context only. Consumers must retain both promotion fields. */
export type PilotEvidence = {
  sourceKey: SourcePilotKey;
  externalId: string;
  project: string;
  location: string;
  company: string;
  organisationRole: 'APPLICANT_HOLDER' | 'UNKNOWN';
  description: string;
  value: string;
  observedAt: string;
  retrievedAt: string;
  sourceObservedAt?: string;
  sourceLastModifiedAt?: string;
  eventDateKind?: 'LODGEMENT';
  provenance: string;
  projectUrl?: string;
  sourceStatus: string;
  contextOnly: true;
  promotionEligible: false;
  evidenceType: 'EXPLICIT';
  applicationNumber?: string;
  applicationAmendment?: string;
  localities: string[];
  parcelKeys: string[];
  lotPlans: string[];
  upstreamObjectIds: string[];
  rawLinks: string[];
  qualityFlags: string[];
  attribution: string;
  licenceUrl: string;
  changeNotice: string;
};
export type PilotQuarantine = {
  externalId?: string;
  rowCount: number;
  qualityFlags: string[];
  evidence?: PilotEvidence;
};
export type PilotExclusion = {
  externalId: string;
  rowCount: number;
  reason:
    'DOMESTIC_DEVELOPMENT' | 'NO_COMMERCIAL_SIGNAL' | 'NON_CURRENT_APPLICATION';
};
export type PilotResult = {
  evidence: PilotEvidence[];
  quarantine: PilotQuarantine[];
  excluded: PilotExclusion[];
  summary: {
    inputRows: number;
    groupedRecords: number;
    usableEvidence: number;
    quarantined: number;
    excluded: number;
    duplicateRows: number;
    datedEvidence: number;
    promotionEligible: 0;
    qualityFlags: Record<string, number>;
  };
};
type Candidate = {
  evidence?: PilotEvidence;
  fatal: string[];
  rowCount: number;
  exclusion?: PilotExclusion['reason'];
};

const text = (value: unknown) =>
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : '';
const unique = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort();
const isRecord = (value: unknown): value is Attributes =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const decode = (value: string) =>
  value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
    (original, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
        nbsp: ' ',
      };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const number =
        entity[1]?.toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return number > 0 &&
        number <= 0x10ffff &&
        !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : original;
    },
  );
const plain = (value: unknown) =>
  decode(text(value))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function projectLink(
  value: unknown,
  source: SourcePilotKey,
): string | undefined {
  const raw = text(value);
  const match = raw.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  const candidate = decode(
    raw.includes('<') ? match?.[1] || match?.[2] || '' : raw,
  );
  if (!candidate || /[<>"'\s\u0000-\u001f]/.test(candidate)) return;
  try {
    const url = new URL(candidate);
    const qldHost =
      url.hostname === 'qld.gov.au' || url.hostname.endsWith('.qld.gov.au');
    const loganHost = [
      'devet.loganhub.com.au',
      'logan.qld.gov.au',
      'www.logan.qld.gov.au',
    ].includes(url.hostname);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !(source === 'qld-coordinated-projects' ? qldHost : loganHost)
    )
      return;
    // Preserve Logan's fragment: its authoritative application identity lives there.
    if (source === 'qld-coordinated-projects') url.hash = '';
    return url.toString();
  } catch {
    return;
  }
}

function dateValue(value: unknown): string | undefined {
  if (value == null || value === '') return;
  let stamp: number;
  if (typeof value === 'number') stamp = value;
  else if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value,
    )
  ) {
    // Date.parse rolls impossible calendar dates forward, so validate the calendar portion first.
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (
      calendar.getUTCFullYear() !== year ||
      calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day
    )
      return;
    stamp = Date.parse(value);
  } else return;
  // ArcGIS milliseconds only; spreadsheet serials and epoch-seconds are not dates here.
  if (
    !Number.isFinite(stamp) ||
    stamp < Date.UTC(1900, 0, 1) ||
    stamp > Date.UTC(2200, 0, 1) ||
    Math.abs(stamp) < 100000000000
  )
    return;
  return new Date(stamp).toISOString();
}
function validateContext(context: PilotContext) {
  if (
    !dateValue(context.retrievedAt) ||
    (context.sourceLastModifiedAt !== undefined &&
      !dateValue(context.sourceLastModifiedAt))
  )
    throw new Error('PILOT_CONTEXT_DATE_INVALID');
}
function base(sourceKey: SourcePilotKey, context: PilotContext): PilotEvidence {
  const contract = SOURCE_PILOT_CONTRACTS[sourceKey];
  return {
    sourceKey,
    externalId: '',
    project: '',
    location:
      sourceKey === 'logan-development-applications' ? 'Logan, QLD' : 'QLD',
    company: '',
    organisationRole: 'UNKNOWN',
    description: '',
    value: '',
    observedAt: context.retrievedAt,
    retrievedAt: context.retrievedAt,
    sourceLastModifiedAt: context.sourceLastModifiedAt,
    provenance: contract.endpoint,
    sourceStatus: '',
    contextOnly: true,
    promotionEligible: false,
    evidenceType: 'EXPLICIT',
    localities: [],
    parcelKeys: [],
    lotPlans: [],
    upstreamObjectIds: [],
    rawLinks: [],
    qualityFlags: [],
    attribution: contract.attribution,
    licenceUrl: contract.licence.url,
    changeNotice: contract.changeNotice,
  };
}
function missingFields(raw: Attributes, key: SourcePilotKey) {
  return SOURCE_PILOT_CONTRACTS[key].requiredFields
    .filter((name) => !Object.hasOwn(raw, name))
    .map((name) => 'MISSING_FIELD:' + name);
}
function commercialExclusion(
  description: string,
): PilotExclusion['reason'] | undefined {
  if (
    /\b(warehouse|showroom|industrial|industry|factory|commercial|retail|shop|shopping|hospital|school|child\s?care|hotel|service station|logistics|distribution|manufactur\w*)\b/i.test(
      description,
    )
  )
    return;
  return /\b(dwelling|domestic|carport|patio|pool|house|garage|shed|residential)\b/i.test(
    description,
  )
    ? 'DOMESTIC_DEVELOPMENT'
    : /\boffice\b/i.test(description)
      ? undefined
      : 'NO_COMMERCIAL_SIGNAL';
}

function combine(candidates: Candidate[], inputRows: number): PilotResult {
  const groups = new Map<string, Candidate>();
  for (const [index, candidate] of candidates.entries()) {
    const identity = candidate.evidence?.externalId || 'invalid-row:' + index;
    const prior = groups.get(identity);
    if (!prior) {
      groups.set(identity, candidate);
      continue;
    }
    prior.rowCount += candidate.rowCount;
    prior.fatal = unique([...prior.fatal, ...candidate.fatal]);
    const current = candidate.evidence,
      target = prior.evidence;
    if (!current || !target) continue;
    const signature = (row: PilotEvidence) =>
      JSON.stringify([
        row.project,
        row.company,
        row.sourceStatus,
        row.sourceObservedAt,
        row.description,
        row.applicationNumber,
        row.projectUrl,
      ]);
    if (
      signature(current) !== signature(target) ||
      prior.exclusion !== candidate.exclusion
    )
      prior.fatal.push('CONFLICTING_APPLICATION_ROWS');
    target.localities = unique([...target.localities, ...current.localities]);
    target.parcelKeys = unique([...target.parcelKeys, ...current.parcelKeys]);
    target.lotPlans = unique([...target.lotPlans, ...current.lotPlans]);
    target.upstreamObjectIds = unique([
      ...target.upstreamObjectIds,
      ...current.upstreamObjectIds,
    ]);
    target.rawLinks = unique([...target.rawLinks, ...current.rawLinks]);
    target.qualityFlags = unique([
      ...target.qualityFlags,
      ...current.qualityFlags,
    ]);
  }
  const result: PilotResult = {
    evidence: [],
    quarantine: [],
    excluded: [],
    summary: {
      inputRows,
      groupedRecords: groups.size,
      usableEvidence: 0,
      quarantined: 0,
      excluded: 0,
      duplicateRows: inputRows - groups.size,
      datedEvidence: 0,
      promotionEligible: 0,
      qualityFlags: {},
    },
  };
  for (const candidate of groups.values()) {
    const row = candidate.evidence;
    if (row?.localities.length) row.location = row.localities.join('; ');
    if (row && row.localities.length > 1)
      row.qualityFlags.push('MULTIPLE_PARCEL_LOCALITIES');
    const flags = unique([...candidate.fatal, ...(row?.qualityFlags || [])]);
    for (const flag of flags)
      result.summary.qualityFlags[flag] =
        (result.summary.qualityFlags[flag] || 0) + 1;
    if (row) row.qualityFlags = flags;
    if (candidate.fatal.length || !row)
      result.quarantine.push({
        externalId: row?.externalId || undefined,
        rowCount: candidate.rowCount,
        qualityFlags: flags,
        evidence: row,
      });
    else if (candidate.exclusion)
      result.excluded.push({
        externalId: row.externalId,
        rowCount: candidate.rowCount,
        reason: candidate.exclusion,
      });
    else result.evidence.push(row);
  }
  result.evidence.sort((a, b) => a.externalId.localeCompare(b.externalId));
  result.summary.usableEvidence = result.evidence.length;
  result.summary.quarantined = result.quarantine.length;
  result.summary.excluded = result.excluded.length;
  result.summary.datedEvidence = result.evidence.filter(
    (row) => row.sourceObservedAt,
  ).length;
  return result;
}

export function normalizeLoganApplications(
  rows: readonly unknown[],
  context: PilotContext,
): PilotResult {
  validateContext(context);
  return combine(
    rows.map((raw) => {
      if (!isRecord(raw))
        return { fatal: ['MALFORMED_ATTRIBUTES'], rowCount: 1 };
      const sourceKey = 'logan-development-applications';
      const fatal = missingFields(raw, sourceKey);
      const row = base(sourceKey, context);
      const applicationId = text(raw.Application_System_ID);
      const amendment = plain(raw.Application_Amendment).toLowerCase();
      if (
        raw.Application_Amendment != null &&
        typeof raw.Application_Amendment !== 'string'
      )
        fatal.push('INVALID_AMENDMENT_TYPE');
      if (!/^\d+$/.test(applicationId) || Number(applicationId) <= 0)
        fatal.push('MISSING_APPLICATION_ID');
      else
        row.externalId =
          'logan:' +
          applicationId +
          ':' +
          (amendment ? encodeURIComponent(amendment) : 'base');
      row.applicationNumber = plain(raw.Application_Number);
      row.applicationAmendment = plain(raw.Application_Amendment);
      row.project = plain(raw.Application_Description);
      row.description = row.project;
      if (!row.project) fatal.push('MISSING_PROJECT_TITLE');
      row.sourceStatus = plain(raw.Application_Status);
      if (!row.sourceStatus) fatal.push('MISSING_APPLICATION_STATUS');
      row.company = plain(raw.Application_Applicant);
      row.organisationRole = row.company ? 'APPLICANT_HOLDER' : 'UNKNOWN';
      row.localities = unique([plain(raw.Application_Property_Suburb)]);
      row.location = row.localities[0] || row.location;
      row.parcelKeys = unique([text(raw.Application_Property_Key)]);
      row.lotPlans = unique([plain(raw.Application_Property_Lot_Plan)]);
      row.upstreamObjectIds = unique([text(raw.OBJECTID)]);
      row.rawLinks = unique([text(raw.PDonline_Link)]);
      row.projectUrl = projectLink(raw.PDonline_Link, sourceKey);
      if (!row.projectUrl) row.qualityFlags.push('INVALID_PROJECT_LINK');
      row.sourceObservedAt = dateValue(raw.Application_Lodgement_Date);
      if (
        raw.Application_Lodgement_Date == null ||
        raw.Application_Lodgement_Date === ''
      )
        row.qualityFlags.push('MISSING_LODGEMENT_DATE');
      else if (
        !row.sourceObservedAt ||
        Date.parse(row.sourceObservedAt) > Date.parse(context.retrievedAt)
      )
        fatal.push('INVALID_LODGEMENT_DATE');
      if (row.sourceObservedAt) row.eventDateKind = 'LODGEMENT';
      if (
        raw.fme_rejection_code != null &&
        typeof raw.fme_rejection_code !== 'string'
      )
        fatal.push('INVALID_QUALITY_FLAG_TYPE');
      const rejection = plain(raw.fme_rejection_code);
      if (rejection) fatal.push('UPSTREAM_REJECTION:' + rejection);
      const decision = plain(raw.Application_Decision_Status);
      const nonCurrent =
        (decision && !/^undecided$/i.test(decision)) ||
        /\b(withdrawn|refused|cancelled|approved|decided)\b/i.test(
          row.sourceStatus,
        );
      const exclusion = nonCurrent
        ? ('NON_CURRENT_APPLICATION' as const)
        : commercialExclusion(row.project);
      return { evidence: row, fatal, rowCount: 1, exclusion };
    }),
    rows.length,
  );
}

export function normalizeQldCoordinatedProjects(
  rows: readonly unknown[],
  context: PilotContext,
): PilotResult {
  validateContext(context);
  return combine(
    rows.map((raw) => {
      if (!isRecord(raw))
        return { fatal: ['MALFORMED_ATTRIBUTES'], rowCount: 1 };
      const sourceKey = 'qld-coordinated-projects';
      const fatal = missingFields(raw, sourceKey);
      const row = base(sourceKey, context);
      row.project = plain(raw.name);
      row.description = plain(raw.description);
      row.sourceStatus = plain(raw.projectstatus);
      row.rawLinks = unique([text(raw.weblink)]);
      row.upstreamObjectIds = unique([text(raw.objectid)]);
      row.projectUrl = projectLink(raw.weblink, sourceKey);
      row.qualityFlags.push('UNDATED_CONTEXT');
      if (!row.project) fatal.push('MISSING_PROJECT_TITLE');
      if (!row.projectUrl) fatal.push('INVALID_PROJECT_LINK');
      if (!/^(Current|Completed) (EIS|IAR)( project)?$/i.test(row.sourceStatus))
        fatal.push('UNKNOWN_PROJECT_STATUS');
      if (
        row.projectUrl &&
        !/\/projects\/find-a-project\/(?:current(?:-coordinated)?|completed)-projects\/[^/]+/i.test(
          new URL(row.projectUrl).pathname,
        )
      )
        row.qualityFlags.push('GENERIC_PROJECT_LINK');
      if (row.project && row.projectUrl)
        row.externalId =
          'qld-coordinated:' +
          encodeURIComponent(row.project.toLowerCase()) +
          ':' +
          encodeURIComponent(row.projectUrl);
      return { evidence: row, fatal, rowCount: 1 };
    }),
    rows.length,
  );
}

export type PilotFetchOptions = {
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
  where?: string;
  retrievedAt?: string;
};
export type PilotFetchResult = PilotResult & {
  fetch: {
    metadataReachable: true;
    schemaVerified: true;
    pages: number;
    rowsFetched: number;
    completed: boolean;
    truncated: boolean;
    durationMs: number;
    productionReliabilityVerified: false;
    sourceLastModifiedAt?: string;
  };
};
function checkedBody(value: unknown): Attributes {
  if (!isRecord(value)) throw new Error('ARCGIS_SCHEMA_INVALID');
  if (value.error) throw new Error('ARCGIS_SOURCE_ERROR');
  return value;
}

/** Read-only, bounded, no registry/storage/SDK calls; throws before returning partial failed reads. */
export async function fetchSourcePilot(
  sourceKey: SourcePilotKey,
  options: PilotFetchOptions = {},
  requestJson: (url: string) => Promise<unknown> = sourceJson,
): Promise<PilotFetchResult> {
  const started = Date.now();
  const contract = SOURCE_PILOT_CONTRACTS[sourceKey];
  if (!contract) throw new Error('PILOT_SOURCE_UNKNOWN');
  const pageSize = options.pageSize ?? 50,
    maxPages = options.maxPages ?? 4,
    maxRows = options.maxRows ?? 200;
  for (const [value, maximum] of [
    [pageSize, 100],
    [maxPages, 20],
    [maxRows, 1000],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error('PILOT_BOUND_INVALID');
  }
  if (
    options.where !== undefined &&
    (!options.where.trim() || options.where.length > 1000)
  )
    throw new Error('PILOT_WHERE_INVALID');
  const retrievedAt = options.retrievedAt ?? new Date(started).toISOString();
  validateContext({ retrievedAt });
  const metadata = checkedBody(await requestJson(contract.metadataUrl));
  const fields = Array.isArray(metadata.fields)
    ? metadata.fields.filter(isRecord).map((field) => field.name)
    : [];
  if (
    contract.requiredFields.some((name) => !fields.includes(name)) ||
    !fields.includes(contract.pagination.objectIdField)
  )
    throw new Error('ARCGIS_REQUIRED_FIELDS_MISSING');
  const capabilities = isRecord(metadata.advancedQueryCapabilities)
    ? metadata.advancedQueryCapabilities
    : {};
  if (
    capabilities.supportsPagination !== true ||
    capabilities.supportsOrderBy !== true
  )
    throw new Error('ARCGIS_PAGINATION_UNSUPPORTED');
  const editing = isRecord(metadata.editingInfo) ? metadata.editingInfo : {};
  const sourceLastModifiedAt = dateValue(
    editing.dataLastEditDate ?? editing.lastEditDate,
  );
  const rows: Attributes[] = [];
  let completed = false,
    pages = 0,
    previousObjectId = -Infinity;
  while (pages < maxPages && rows.length < maxRows) {
    const count = Math.min(pageSize, maxRows - rows.length);
    const url = new URL(contract.endpoint + '/query');
    const params = {
      f: 'json',
      where: options.where ?? '1=1',
      outFields: contract.fields.join(','),
      returnGeometry: 'false',
      orderByFields: contract.pagination.orderBy,
      resultOffset: String(rows.length),
      resultRecordCount: String(count),
    };
    Object.entries(params).forEach(([name, value]) =>
      url.searchParams.set(name, value),
    );
    const body = checkedBody(await requestJson(url.toString()));
    if (!Array.isArray(body.features) || body.features.length > count)
      throw new Error('ARCGIS_PAGE_INVALID');
    const page: Attributes[] = [];
    for (const feature of body.features) {
      if (!isRecord(feature) || !isRecord(feature.attributes))
        throw new Error('ARCGIS_ATTRIBUTES_INVALID');
      const objectId = feature.attributes[contract.pagination.objectIdField];
      if (
        typeof objectId !== 'number' ||
        !Number.isSafeInteger(objectId) ||
        objectId < 0
      )
        throw new Error('ARCGIS_OBJECT_ID_INVALID');
      if (objectId <= previousObjectId)
        throw new Error('ARCGIS_NON_INCREASING_OBJECT_ID');
      previousObjectId = objectId;
      page.push(feature.attributes);
    }
    pages++;
    rows.push(...page);
    if (body.exceededTransferLimit === true && !page.length)
      throw new Error('ARCGIS_EMPTY_TRANSFER_LIMIT_PAGE');
    if (
      body.exceededTransferLimit === false ||
      (body.exceededTransferLimit !== true && page.length < count)
    ) {
      completed = true;
      break;
    }
  }
  const context = { retrievedAt, sourceLastModifiedAt };
  const normalized =
    sourceKey === 'logan-development-applications'
      ? normalizeLoganApplications(rows, context)
      : normalizeQldCoordinatedProjects(rows, context);
  return {
    ...normalized,
    fetch: {
      metadataReachable: true,
      schemaVerified: true,
      pages,
      rowsFetched: rows.length,
      completed,
      truncated: !completed,
      durationMs: Date.now() - started,
      productionReliabilityVerified: false,
      sourceLastModifiedAt,
    },
  };
}
