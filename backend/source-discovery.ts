import { createHash } from 'node:crypto';
import { db } from '@appdeploy/sdk';
import { sourceJson } from './source-helpers';

/** Fixed query taxonomy; request input can never provide a catalogue endpoint or resource URL. */
export const DISCOVERY_QUERIES = [
  'mining OR resources OR "oil and gas" OR LNG',
  '"renewable energy" OR "electricity infrastructure" OR transmission',
  '"road projects" OR "rail projects" OR ports OR airports',
  '"water infrastructure" OR "civil construction" OR "major developments"',
  '"planning approvals" OR "environmental approvals" OR "construction permits" OR "project approvals"',
  '"government tenders" OR "awarded contracts" OR maintenance OR shutdowns',
  'remediation OR "mine closure" OR "site preparation" OR demolition OR "project status"',
] as const;
const CATALOGUES = [
  {
    key: 'wa',
    endpoint: 'https://catalogue.data.wa.gov.au/api/3/action/package_search',
    datasetBase: 'https://catalogue.data.wa.gov.au/dataset/',
    jurisdiction: 'WA',
  },
  {
    key: 'australia',
    endpoint: 'https://data.gov.au/data/api/3/action/package_search',
    datasetBase: 'https://data.gov.au/data/dataset/',
    jurisdiction: 'AU',
  },
] as const;
type CatalogueKey = (typeof CATALOGUES)[number]['key'];
type Catalogue = (typeof CATALOGUES)[number];
type Checkpoint = { query_index: number; offset: number };
export type DiscoveryRun = {
  status: 'SUCCESS' | 'FAILED';
  catalogue: CatalogueKey;
  query: string;
  checkpoint_before: Checkpoint;
  checkpoint_after: Checkpoint;
  datasets_processed: number;
  candidates_created: number;
  duplicates_skipped: number;
  failure_reason: string | null;
  completed_at: string;
};
export type DiscoveryState = {
  schema_version: 1;
  catalogue: CatalogueKey;
  query_index: number;
  query_offsets: number[];
  candidate_keys: string[];
  last_run: DiscoveryRun | null;
  updated_at: string;
};
type Rotation = { schema_version: 1; next_catalogue: CatalogueKey };
export type DiscoveredCandidate = {
  schema_version: 1;
  source_id: string;
  source_name: string;
  catalogue: CatalogueKey;
  catalogue_endpoint: string;
  publisher: string | null;
  jurisdiction: string;
  category_query: string;
  dataset_id: string;
  provenance_url: string;
  licence_name: string | null;
  licence_url: string | null;
  status: 'CANDIDATE' | 'REVIEW_REQUIRED' | 'REJECTED';
  collection_blocked: true;
  legal_review_status: 'NOT_VERIFIED';
  technical_validation: 'NOT_VERIFIED';
  admission_reason: 'REVIEW_AND_COMPILED_ADAPTER_REQUIRED';
  resources: Array<{
    id: string | null;
    name: string | null;
    format: string | null;
    url: string | null;
    raw_url: string | null;
  }>;
  resources_truncated: boolean;
  catalogue_modified_at: string | null;
  catalogue_evidence: {
    title: string | null;
    notes: string | null;
    publisher_name: string | null;
    licence_id: string | null;
  };
  retrieved_at: string;
  created_at: string;
  updated_at: string;
};
const PAGE_SIZE = 5;
const MAX_CANDIDATES_PER_CATALOGUE = 500;
const MAX_QUERY_OFFSET = 10000;
const boundedText = (value: unknown, max = 1000): string | null =>
  typeof value === 'string' && value.trim() ? value.slice(0, max) : null;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function safeReference(value: unknown) {
  const text = boundedText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? text
      : null;
  } catch {
    return null;
  }
}
async function readSingleton<T>(
  table: string,
): Promise<(T & { id: string }) | null> {
  const result = await db.list<T>(table, { limit: 2 });
  if (result.items.length > 1 || result.nextToken)
    throw new Error('SOURCE_DISCOVERY_CONFLICT:' + table);
  return (result.items[0] as (T & { id: string }) | undefined) || null;
}
async function saveSingleton<T extends object>(
  table: string,
  record: T,
  id?: string,
) {
  const { id: _id, ...data } = record as T & { id?: string };
  if (id) {
    const results = await db.update(table, [
      { id, record: data as Record<string, unknown> },
    ]);
    if (results.length !== 1 || results[0] !== true)
      throw new Error('SOURCE_DISCOVERY_WRITE_FAILED:' + table);
  } else {
    const results = await db.add(table, [data as Record<string, unknown>]);
    if (results.length !== 1 || typeof results[0] !== 'string' || !results[0])
      throw new Error('SOURCE_DISCOVERY_WRITE_FAILED:' + table);
  }
}
function initialState(catalogue: Catalogue): DiscoveryState {
  return {
    schema_version: 1,
    catalogue: catalogue.key,
    query_index: 0,
    query_offsets: DISCOVERY_QUERIES.map(() => 0),
    candidate_keys: [],
    last_run: null,
    updated_at: new Date().toISOString(),
  };
}
function validateState(state: DiscoveryState, key: CatalogueKey) {
  if (
    state.schema_version !== 1 ||
    state.catalogue !== key ||
    !Number.isInteger(state.query_index) ||
    state.query_index < 0 ||
    state.query_index >= DISCOVERY_QUERIES.length ||
    !Array.isArray(state.query_offsets) ||
    state.query_offsets.length !== DISCOVERY_QUERIES.length ||
    state.query_offsets.some(
      (value) =>
        !Number.isInteger(value) || value < 0 || value > MAX_QUERY_OFFSET,
    ) ||
    !Array.isArray(state.candidate_keys) ||
    state.candidate_keys.length > MAX_CANDIDATES_PER_CATALOGUE ||
    state.candidate_keys.some(
      (value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value),
    ) ||
    new Set(state.candidate_keys).size !== state.candidate_keys.length
  )
    throw new Error('SOURCE_DISCOVERY_STATE_INVALID:' + key);
}
async function readRotation() {
  const row = await readSingleton<Rotation>('automation_discovery:rotation');
  if (
    row &&
    (row.schema_version !== 1 ||
      !CATALOGUES.some((item) => item.key === row.next_catalogue))
  )
    throw new Error('SOURCE_DISCOVERY_STATE_INVALID:rotation');
  return row;
}
function parsePage(data: unknown) {
  if (
    !object(data) ||
    data.success !== true ||
    !object(data.result) ||
    !Array.isArray(data.result.results) ||
    !Number.isInteger(data.result.count) ||
    (data.result.count as number) < 0 ||
    data.result.results.length > PAGE_SIZE ||
    data.result.results.length > (data.result.count as number)
  )
    throw new Error('SOURCE_DISCOVERY_CKAN_SCHEMA_INVALID');
  const rows = data.result.results;
  if (
    rows.some(
      (row) =>
        !object(row) ||
        typeof row.id !== 'string' ||
        !row.id.trim() ||
        row.id.length > 300 ||
        (row.resources !== undefined && !Array.isArray(row.resources)),
    )
  )
    throw new Error('SOURCE_DISCOVERY_DATASET_SCHEMA_INVALID');
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error('SOURCE_DISCOVERY_DUPLICATE_PAGE_IDS');
  return {
    rows: rows as Record<string, unknown>[],
    count: data.result.count as number,
  };
}
function candidateRecord(
  catalogue: Catalogue,
  dataset: Record<string, unknown>,
  query: string,
  hash: string,
): DiscoveredCandidate {
  const now = new Date().toISOString();
  const publisher = object(dataset.organization)
    ? boundedText(dataset.organization.title) ||
      boundedText(dataset.organization.name)
    : null;
  const resources = Array.isArray(dataset.resources) ? dataset.resources : [];
  const name = boundedText(dataset.name, 300) || String(dataset.id);
  return {
    schema_version: 1,
    source_id: 'discovered-' + catalogue.key + '-' + hash.slice(0, 24),
    source_name: boundedText(dataset.title) || name,
    catalogue: catalogue.key,
    catalogue_endpoint: catalogue.endpoint,
    publisher,
    jurisdiction: catalogue.jurisdiction,
    category_query: query,
    dataset_id: String(dataset.id),
    provenance_url: catalogue.datasetBase + encodeURIComponent(name),
    licence_name:
      boundedText(dataset.license_title) || boundedText(dataset.license_id),
    licence_url: safeReference(dataset.license_url),
    status: 'CANDIDATE',
    collection_blocked: true,
    legal_review_status: 'NOT_VERIFIED',
    technical_validation: 'NOT_VERIFIED',
    admission_reason: 'REVIEW_AND_COMPILED_ADAPTER_REQUIRED',
    resources_truncated: resources.length > 20,
    resources: resources
      .slice(0, 20)
      .filter(object)
      .map((resource) => ({
        id: boundedText(resource.id, 300),
        name: boundedText(resource.name),
        format: boundedText(resource.format, 100),
        url: safeReference(resource.url),
        raw_url: boundedText(resource.url, 2048),
      })),
    catalogue_modified_at: boundedText(dataset.metadata_modified, 100),
    catalogue_evidence: {
      title: boundedText(dataset.title),
      notes: boundedText(dataset.notes, 4000),
      publisher_name: publisher,
      licence_id: boundedText(dataset.license_id),
    },
    retrieved_at: now,
    created_at: now,
    updated_at: now,
  };
}

/**
 * One page from a fixed official catalogue, at most five metadata candidates. Resource URLs are
 * evidence only and are NEVER fetched. All callers must share the production automation mutex;
 * the CRUD SDK cannot atomically enforce unique rows or compare-and-swap a checkpoint.
 */
export async function runSourceDiscovery(
  request: (url: string) => Promise<unknown> = sourceJson,
): Promise<DiscoveryRun> {
  const rotation = await readRotation();
  const catalogueIndex = CATALOGUES.findIndex(
    (item) => item.key === (rotation?.next_catalogue || 'wa'),
  );
  const catalogue = CATALOGUES[catalogueIndex];
  const table = 'automation_discovery:' + catalogue.key;
  const stored = await readSingleton<DiscoveryState>(table);
  const state = stored || initialState(catalogue);
  validateState(state, catalogue.key);
  const query = DISCOVERY_QUERIES[state.query_index];
  const checkpoint = {
    query_index: state.query_index,
    offset: state.query_offsets[state.query_index],
  };
  const result: DiscoveryRun = {
    status: 'SUCCESS',
    catalogue: catalogue.key,
    query,
    checkpoint_before: checkpoint,
    checkpoint_after: { ...checkpoint },
    datasets_processed: 0,
    candidates_created: 0,
    duplicates_skipped: 0,
    failure_reason: null,
    completed_at: new Date().toISOString(),
  };
  const url = new URL(catalogue.endpoint);
  url.searchParams.set('q', query);
  url.searchParams.set('rows', String(PAGE_SIZE));
  url.searchParams.set('start', String(checkpoint.offset));
  url.searchParams.set('sort', 'id asc');
  let page: ReturnType<typeof parsePage> | undefined;
  try {
    if (checkpoint.offset >= MAX_QUERY_OFFSET)
      throw new Error('SOURCE_DISCOVERY_QUERY_LIMIT_REVIEW_REQUIRED');
    page = parsePage(await request(url.toString()));
    if (!page.rows.length && checkpoint.offset < page.count)
      throw new Error('SOURCE_DISCOVERY_EMPTY_PAGE_BEFORE_END');
  } catch (error) {
    result.status = 'FAILED';
    result.failure_reason = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 2000);
  }
  const candidateKeys = new Set(state.candidate_keys);
  if (page && result.status === 'SUCCESS') {
    const newKeys = page.rows.map((dataset) =>
      createHash('sha256')
        .update(catalogue.key + ':' + dataset.id)
        .digest('hex'),
    );
    if (
      new Set([...candidateKeys, ...newKeys]).size >
      MAX_CANDIDATES_PER_CATALOGUE
    ) {
      result.status = 'FAILED';
      result.failure_reason = 'SOURCE_DISCOVERY_CAPACITY_REVIEW_REQUIRED';
    } else {
      for (const [index, dataset] of page.rows.entries()) {
        const hash = newKeys[index],
          candidateTable = 'automation_candidate:' + hash;
        const existing =
          await readSingleton<DiscoveredCandidate>(candidateTable);
        if (
          existing &&
          (existing.schema_version !== 1 ||
            existing.catalogue !== catalogue.key ||
            existing.dataset_id !== dataset.id ||
            !['CANDIDATE', 'REVIEW_REQUIRED', 'REJECTED'].includes(
              existing.status,
            ) ||
            existing.collection_blocked !== true)
        )
          throw new Error('SOURCE_DISCOVERY_CANDIDATE_INVALID:' + hash);
        const candidate = candidateRecord(catalogue, dataset, query, hash);
        // Discovery does not overwrite an operator's review disposition or activate any source.
        await saveSingleton(
          candidateTable,
          existing
            ? {
                ...existing,
                ...candidate,
                status: existing.status,
                created_at: existing.created_at,
              }
            : candidate,
          existing?.id,
        );
        candidateKeys.add(hash);
        result.datasets_processed++;
        if (existing) result.duplicates_skipped++;
        else result.candidates_created++;
      }
      const offset = checkpoint.offset + page.rows.length;
      const queryOffsets = [...state.query_offsets];
      // Exhausted discovery searches deliberately revisit metadata on their next taxonomy cycle.
      queryOffsets[state.query_index] = offset >= page.count ? 0 : offset;
      const queryIndex = (state.query_index + 1) % DISCOVERY_QUERIES.length;
      result.checkpoint_after = {
        query_index: queryIndex,
        offset: queryOffsets[queryIndex],
      };
      state.query_index = queryIndex;
      state.query_offsets = queryOffsets;
    }
  }
  result.completed_at = new Date().toISOString();
  // This checkpoint is advanced only after every candidate write was acknowledged. SDK errors are never retried.
  await saveSingleton(
    table,
    {
      ...state,
      candidate_keys: [...candidateKeys],
      last_run: result,
      updated_at: result.completed_at,
    },
    stored?.id,
  );
  await saveSingleton(
    'automation_discovery:rotation',
    {
      schema_version: 1,
      next_catalogue: CATALOGUES[(catalogueIndex + 1) % CATALOGUES.length].key,
    },
    rotation?.id,
  );
  return result;
}

export async function getSourceDiscoveryStatus() {
  const catalogues: DiscoveryState[] = [];
  for (const catalogue of CATALOGUES) {
    const row = await readSingleton<DiscoveryState>(
      'automation_discovery:' + catalogue.key,
    );
    if (row) {
      validateState(row, catalogue.key);
      catalogues.push(row);
    }
  }
  const rotation = await readRotation();
  const lastRun =
    catalogues
      .map((row) => row.last_run)
      .filter((row): row is DiscoveryRun => row !== null)
      .sort((left, right) =>
        right.completed_at.localeCompare(left.completed_at),
      )[0] || null;
  return {
    catalogues,
    candidate_count: catalogues.reduce(
      (sum, row) => sum + row.candidate_keys.length,
      0,
    ),
    candidate_count_basis: 'ACKNOWLEDGED_CHECKPOINT_INDEX' as const,
    next_catalogue: rotation?.next_catalogue || null,
    last_run: lastRun,
  };
}
