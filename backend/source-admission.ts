import { createHash } from 'node:crypto';
import {
  SOURCE_PILOT_CONTRACTS,
  type SourcePilotContract,
  type SourcePilotKey,
} from './source-contracts';
import type { SourceDef } from './index';
import {
  initialSourceRecord,
  readAutomationSourceRecord,
  saveAutomationSourceRecord,
  SOURCE_CHECK_NAMES,
  unverifiedSourceChecks,
  type CheckStatus,
  type SourceProbeResult,
  type SourceRegistryRecord,
} from './source-automation';

export type AdmissionReview = {
  reviewedBy: string;
  reviewedAt: string;
  endpoint: string;
  provenanceUrl: string;
  licenceName: string;
  licenceUrl: string;
  provenanceVerified: boolean;
  lawfulMachineAccess: boolean;
  noAccessBypass: boolean;
  machineReadable: boolean;
  requiredFieldsVerified: boolean;
  rateLimitVerified: boolean;
  reproducibleRetrievalVerified: boolean;
  activationApproved: boolean;
  evidenceUrls: readonly string[];
  minPollHours: number;
  freshnessWindowHours: number;
};
export type AdmissionProbeResult = SourceProbeResult & {
  requiredFields?: CheckStatus;
  rateLimits?: CheckStatus;
  reproducibility?: CheckStatus;
};
export type AdmissionDecision = {
  status: 'VERIFIED' | 'REVIEW_REQUIRED';
  reasons: string[];
};
type CandidateProbe = (
  contract: SourcePilotContract,
) => Promise<AdmissionProbeResult>;

/**
 * Empty deliberately: existing pilots have metadata review only and activation remains pending.
 * Entries may be added ONLY by a reviewed repository change containing the actual legal/access
 * evidence and reviewer identity. Neither an HTTP request body nor a probe can supply this review.
 */
const COMPILED_ADMISSION_REVIEWS: Readonly<
  Partial<Record<SourcePilotKey, AdmissionReview>>
> = Object.freeze({});
const candidateKeys = Object.keys(SOURCE_PILOT_CONTRACTS) as SourcePilotKey[];
const httpsUrl = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};
const failureText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 2000);
function compiledContract(key: string): SourcePilotContract {
  if (!Object.hasOwn(SOURCE_PILOT_CONTRACTS, key))
    throw new Error('SOURCE_CANDIDATE_NOT_ALLOWLISTED');
  return SOURCE_PILOT_CONTRACTS[key as SourcePilotKey];
}
function catalogueVersion(contract: SourcePilotContract) {
  return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}
function candidateDefinition(contract: SourcePilotContract): SourceDef {
  return {
    key: contract.key,
    name: contract.name,
    owner: contract.owningAgency,
    territory: 'QLD',
    sector: 'Planning approvals',
    licence: contract.licence.name,
    method: 'ARCGIS',
    endpoint: contract.endpoint,
    provenance: contract.metadataUrl,
  };
}
function newCandidate(contract: SourcePilotContract): SourceRegistryRecord {
  return {
    ...initialSourceRecord(candidateDefinition(contract)),
    status: 'CANDIDATE',
    collection_blocked: true,
    collection_hold_reason: 'ACTIVATION_REVIEW_PENDING',
    activation_basis: 'CONTROLLED_ADMISSION',
    legal_review_status: 'REVIEW_REQUIRED',
    licence_url: contract.licence.url,
    access_requirements: 'PUBLIC_MACHINE_ACCESS_REVIEW_PENDING',
    admission: {
      catalogue_version: catalogueVersion(contract),
      lifecycle: [{ status: 'CANDIDATE', at: new Date().toISOString() }],
      rights_review: contract.rightsReview.status,
      review_evidence_urls: [...contract.rightsReview.evidenceUrls],
      limitations: contract.rightsReview.limitations,
      latest_validation: null,
      decision_reasons: ['ACTIVATION_REVIEW_PENDING'],
    },
  };
}
function matchesCatalogue(
  row: SourceRegistryRecord,
  contract: SourcePilotContract,
) {
  return (
    row.activation_basis === 'CONTROLLED_ADMISSION' &&
    row.admission?.catalogue_version === catalogueVersion(contract) &&
    row.endpoint === contract.endpoint &&
    row.provenance_url === contract.metadataUrl &&
    row.licence_name === contract.licence.name &&
    row.licence_url === contract.licence.url &&
    row.publisher === contract.owningAgency
  );
}
async function ensureCandidate(key: string) {
  const contract = compiledContract(key);
  let row = await readAutomationSourceRecord(contract.key);
  if (!row) {
    await saveAutomationSourceRecord(newCandidate(contract));
    row = await readAutomationSourceRecord(contract.key);
    if (!row) throw new Error('SOURCE_REGISTRY_WRITE_NOT_VISIBLE:' + key);
  }
  return { row, contract };
}
function lifecycle(
  row: SourceRegistryRecord,
  status: SourceRegistryRecord['status'],
) {
  const previous = Array.isArray(row.admission?.lifecycle)
    ? row.admission.lifecycle
    : [];
  return [...previous.slice(-7), { status, at: new Date().toISOString() }];
}
async function holdChangedCandidate(
  row: SourceRegistryRecord & { id: string },
) {
  return saveAutomationSourceRecord(
    {
      ...row,
      status: 'REVIEW_REQUIRED',
      collection_blocked: true,
      collection_hold_reason: 'SOURCE_CANDIDATE_CONTRACT_CHANGED',
      failure_reason: 'SOURCE_CANDIDATE_CONTRACT_CHANGED',
      legal_review_status: 'REVIEW_REQUIRED',
      updated_at: new Date().toISOString(),
      admission: {
        ...row.admission,
        lifecycle: lifecycle(row, 'REVIEW_REQUIRED'),
        decision_reasons: ['SOURCE_CANDIDATE_CONTRACT_CHANGED'],
      },
    },
    row.id,
  );
}

/** Discovery is a finite compiled catalogue. No URL or publisher supplied by a request is used. */
export async function discoverSourceCandidates(): Promise<
  SourceRegistryRecord[]
> {
  const rows: SourceRegistryRecord[] = [];
  for (const key of candidateKeys) {
    const { row, contract } = await ensureCandidate(key);
    rows.push(
      matchesCatalogue(row, contract) ? row : await holdChangedCandidate(row),
    );
  }
  return rows;
}
export async function readSourceCandidates(): Promise<SourceRegistryRecord[]> {
  const rows: SourceRegistryRecord[] = [];
  for (const key of candidateKeys) {
    const row = await readAutomationSourceRecord(key);
    if (row) rows.push(row);
  }
  return rows;
}

/** Pure gate evaluator. Its review argument is never accepted by the production validation API. */
export function evaluateSourceAdmission(
  contract: SourcePilotContract,
  review: AdmissionReview | null,
  probe: AdmissionProbeResult,
): AdmissionDecision {
  const reasons: string[] = [];
  if (!review) reasons.push('ACTIVATION_REVIEW_PENDING');
  else {
    const approvalDate = Date.parse(review.reviewedAt);
    if (
      !review.reviewedBy?.trim() ||
      !Number.isFinite(approvalDate) ||
      approvalDate > Date.now()
    )
      reasons.push('REVIEW_IDENTITY_REQUIRED');
    if (!review.evidenceUrls?.length || !review.evidenceUrls.every(httpsUrl))
      reasons.push('REVIEW_EVIDENCE_REQUIRED');
    if (
      review.endpoint !== contract.endpoint ||
      review.provenanceUrl !== contract.metadataUrl ||
      !httpsUrl(contract.endpoint) ||
      !contract.owningAgency ||
      review.provenanceVerified !== true
    )
      reasons.push('PROVENANCE_REVIEW_REQUIRED');
    if (
      !review.licenceName?.trim() ||
      !contract.licence.name?.trim() ||
      review.licenceName !== contract.licence.name ||
      !httpsUrl(review.licenceUrl) ||
      review.licenceUrl !== contract.licence.url
    )
      reasons.push('LICENCE_METADATA_REQUIRED');
    if (review.lawfulMachineAccess !== true || review.noAccessBypass !== true)
      reasons.push('LAWFUL_MACHINE_ACCESS_REVIEW_REQUIRED');
    if (review.machineReadable !== true)
      reasons.push('MACHINE_READABLE_ACCESS_REQUIRED');
    if (review.requiredFieldsVerified !== true)
      reasons.push('REQUIRED_FIELDS_REVIEW_REQUIRED');
    if (
      review.rateLimitVerified !== true ||
      !Number.isFinite(review.minPollHours) ||
      review.minPollHours <= 0
    )
      reasons.push('RATE_LIMIT_REVIEW_REQUIRED');
    if (review.reproducibleRetrievalVerified !== true)
      reasons.push('REPRODUCIBILITY_REVIEW_REQUIRED');
    if (review.activationApproved !== true)
      reasons.push('ACTIVATION_REVIEW_PENDING');
    const age = probe.lastRecordTimestamp
      ? Date.now() - Date.parse(probe.lastRecordTimestamp)
      : NaN;
    if (
      !Number.isFinite(review.freshnessWindowHours) ||
      review.freshnessWindowHours <= 0 ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > review.freshnessWindowHours * 3600000
    )
      reasons.push('FRESHNESS_EVIDENCE_REQUIRED');
  }
  for (const check of SOURCE_CHECK_NAMES)
    if (probe.checks?.[check] !== 'PASS')
      reasons.push('TECHNICAL_CHECK_NOT_PASSED:' + check);
  for (const check of [
    'requiredFields',
    'rateLimits',
    'reproducibility',
  ] as const)
    if (probe[check] !== 'PASS')
      reasons.push('TECHNICAL_CHECK_NOT_PASSED:' + check);
  if (!probe.schemaVersion?.trim()) reasons.push('SCHEMA_VERSION_REQUIRED');
  if (!Number.isInteger(probe.recordCount) || probe.recordCount! <= 0)
    reasons.push('REPRODUCIBLE_RECORD_SAMPLE_REQUIRED');
  return { status: reasons.length ? 'REVIEW_REQUIRED' : 'VERIFIED', reasons };
}

/** Read-only technical probes run against compiled contracts; admission writes never ingest their sample evidence. */
export async function validateSourceCandidate(
  key: string,
  probe: CandidateProbe,
): Promise<SourceRegistryRecord> {
  let { row, contract } = await ensureCandidate(key);
  if (!matchesCatalogue(row, contract)) return holdChangedCandidate(row);
  if (['DISABLED', 'REJECTED'].includes(row.status)) return row;
  const review = COMPILED_ADMISSION_REVIEWS[contract.key] || null;
  const startedAt = Date.now();
  const validating = {
    ...row,
    status: 'VALIDATING' as const,
    collection_blocked: true,
    collection_hold_reason: 'VALIDATION_IN_PROGRESS',
    updated_at: new Date().toISOString(),
    admission: { ...row.admission, lifecycle: lifecycle(row, 'VALIDATING') },
  };
  await saveAutomationSourceRecord(validating, row.id);
  row = { ...validating, id: row.id };
  let observed: AdmissionProbeResult = {};
  let failure: string | null = null;
  try {
    observed = await probe(contract);
  } catch (error) {
    failure = failureText(error);
  }
  const decision = failure
    ? { status: 'REVIEW_REQUIRED' as const, reasons: [failure] }
    : evaluateSourceAdmission(contract, review, observed);
  const now = new Date().toISOString();
  const saved = await saveAutomationSourceRecord(
    {
      ...row,
      status: decision.status,
      legal_review_status:
        decision.status === 'VERIFIED' ? 'APPROVED' : 'REVIEW_REQUIRED',
      collection_blocked: true,
      collection_hold_reason:
        decision.status === 'VERIFIED'
          ? 'ACTIVATION_PENDING'
          : decision.reasons.join('; ').slice(0, 2000),
      failure_reason: decision.reasons.length
        ? decision.reasons.join('; ').slice(0, 2000)
        : null,
      checks: { ...unverifiedSourceChecks(), ...observed.checks },
      last_checked_at: now,
      last_success_at:
        !failure && observed.checks?.accessibility === 'PASS'
          ? now
          : row.last_success_at,
      last_failure_at: failure ? now : row.last_failure_at,
      consecutive_failures: failure ? row.consecutive_failures + 1 : 0,
      response_latency: Date.now() - startedAt,
      schema_version: observed.schemaVersion || row.schema_version,
      last_record_timestamp: observed.lastRecordTimestamp || null,
      freshness_status:
        decision.status === 'VERIFIED' ? 'FRESH' : 'NOT_VERIFIED',
      freshness_window_hours: review?.freshnessWindowHours || null,
      updated_at: now,
      admission: {
        ...row.admission,
        lifecycle: lifecycle(row, decision.status),
        decision_reasons: decision.reasons,
        latest_validation: observed,
        reviewed_by: review?.reviewedBy || null,
        reviewed_at: review?.reviewedAt || null,
        min_poll_hours: review?.minPollHours || null,
      },
    },
    row.id,
  );
  return saved;
}

/** Activation is a second checked transition and rechecks compiled reviews plus the stored technical evidence. */
export async function activateVerifiedCandidate(
  key: string,
): Promise<SourceRegistryRecord> {
  const { row, contract } = await ensureCandidate(key);
  if (row.status !== 'VERIFIED')
    throw new Error('SOURCE_ADMISSION_NOT_VERIFIED');
  if (!matchesCatalogue(row, contract)) return holdChangedCandidate(row);
  const review = COMPILED_ADMISSION_REVIEWS[contract.key] || null;
  const observation = row.admission?.latest_validation as
    AdmissionProbeResult | undefined;
  const decision = evaluateSourceAdmission(contract, review, observation || {});
  if (decision.status !== 'VERIFIED') {
    return saveAutomationSourceRecord(
      {
        ...row,
        status: 'REVIEW_REQUIRED',
        collection_blocked: true,
        collection_hold_reason: decision.reasons.join('; ').slice(0, 2000),
        failure_reason: decision.reasons.join('; ').slice(0, 2000),
        legal_review_status: 'REVIEW_REQUIRED',
        updated_at: new Date().toISOString(),
        admission: {
          ...row.admission,
          lifecycle: lifecycle(row, 'REVIEW_REQUIRED'),
          decision_reasons: decision.reasons,
        },
      },
      row.id,
    );
  }
  return saveAutomationSourceRecord(
    {
      ...row,
      status: 'ACTIVE',
      collection_blocked: false,
      collection_hold_reason: null,
      failure_reason: null,
      legal_review_status: 'APPROVED',
      updated_at: new Date().toISOString(),
      access_requirements: 'REVIEWED_PUBLIC_MACHINE_ACCESS',
      admission: {
        ...row.admission,
        lifecycle: lifecycle(row, 'ACTIVE'),
        activated_at: new Date().toISOString(),
      },
    },
    row.id,
  );
}
