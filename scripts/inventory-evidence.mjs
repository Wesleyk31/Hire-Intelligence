#!/usr/bin/env node
/** Read-only local-export inventory. Importing this module never reads files or starts a benchmark. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const DAY = 86400000;
const text = value => typeof value === 'string' ? value.trim() : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const stable = value => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value)) ?? 'null').digest('hex');
const comparableFields = ['sourceKey', 'externalId', 'project', 'location', 'company', 'description', 'sourceObservedAt', 'provenance'];
const quarantineIssues = new Set(['MALFORMED_RECORD', 'MISSING_SOURCE', 'MISSING_ID', 'MISSING_PROJECT', 'MISSING_LOCATION', 'MISSING_PROVENANCE', 'AEMO_METADATA_ROW', 'INVALID_SOURCE_DATE', 'FUTURE_SOURCE_DATE', 'ARCHIVE_SOURCE_MISMATCH', 'POSSIBLE_STORED_DUPLICATE', 'POSSIBLE_DUPLICATE_CONTENT']);

function sourceDate(value, now, staleDays) {
  if (value !== undefined && value !== null && typeof value !== 'string') return { status: 'INVALID', issue: 'INVALID_SOURCE_DATE' };
  const supplied = text(value);
  if (!supplied || /^(unknown|not stated|n\/?a|none|null|undated|-+)$/i.test(supplied)) return { status: 'UNKNOWN', issue: 'MISSING_SOURCE_DATE' };
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(supplied);
  const timestamp = Date.parse(supplied);
  const validCalendar = calendar && Number(calendar[2]) >= 1 && Number(calendar[2]) <= 12 && Number(calendar[3]) >= 1 && Number(calendar[3]) <= new Date(Date.UTC(Number(calendar[1]), Number(calendar[2]), 0)).getUTCDate();
  if (!validCalendar || !Number.isFinite(timestamp) || timestamp < Date.UTC(1900, 0, 1)) return { status: 'INVALID', issue: 'INVALID_SOURCE_DATE' };
  if (timestamp > now + DAY) return { status: 'FUTURE', issue: 'FUTURE_SOURCE_DATE' };
  if (now - timestamp > staleDays * DAY) return { status: 'STALE', issue: 'STALE_SOURCE_ACTIVITY' };
  return { status: 'CURRENT' };
}

function quality(value, now, staleDays, expectedSource) {
  const row = object(value) ? value : {};
  const issues = object(value) ? [] : ['MALFORMED_RECORD'];
  for (const [field, issue] of [['sourceKey', 'MISSING_SOURCE'], ['externalId', 'MISSING_ID'], ['project', 'MISSING_PROJECT'], ['location', 'MISSING_LOCATION'], ['provenance', 'MISSING_PROVENANCE']]) if (!text(row[field])) issues.push(issue);
  if (/^\d{1,3}$/.test(text(row.externalId))) issues.push('POSSIBLE_POSITIONAL_ID');
  if (text(row.sourceKey).startsWith('aemo-') && /^(site name|unit name|background information|glossary|definition|field name)$/i.test(text(row.project))) issues.push('AEMO_METADATA_ROW');
  if (expectedSource && row.sourceKey !== expectedSource) issues.push('ARCHIVE_SOURCE_MISMATCH');
  const date = sourceDate(row.sourceObservedAt, now, staleDays);
  if (date.issue) issues.push(date.issue);
  return { issues: [...new Set([...issues, ...(Array.isArray(row.issues) ? row.issues.filter(value => typeof value === 'string') : [])])], sourceDateStatus: date.status };
}

function unpack(data) {
  if (Array.isArray(data)) return [{ format: 'EVIDENCE_ARRAY', rows: data }];
  if (!object(data)) throw new Error('Export must be an evidence array, review page, archive page, or {pages:[...]} envelope.');
  if (Array.isArray(data.pages)) return data.pages.flatMap(unpack);
  if (Object.hasOwn(data, 'events')) return [{ ...data, format: 'ARCHIVE_PAGE', origin: 'ARCHIVE', rows: Array.isArray(data.events) ? data.events : [], issues: Array.isArray(data.events) ? [] : ['MALFORMED_ARCHIVE_PAGE'], expectedSource: text(data.sourceKey) }];
  if (Object.hasOwn(data, 'items') || Object.hasOwn(data, 'records')) {
    const rows = data.items ?? data.records;
    return [{ ...data, format: Object.hasOwn(data, 'items') ? 'REVIEW_PAGE' : 'EVIDENCE_EXPORT', rows: Array.isArray(rows) ? rows : [], issues: Array.isArray(rows) ? [] : ['MALFORMED_EXPORT_PAGE'] }];
  }
  throw new Error('Unrecognised export structure.');
}

function storageReference(row, page, file, pageIndex, rowIndex) {
  const origin = ['LIVE', 'ARCHIVE'].includes(row.origin) ? row.origin : ['LIVE', 'ARCHIVE'].includes(page.origin) ? page.origin : null;
  const storageId = text(row.storageId) || (page.format === 'ARCHIVE_PAGE' ? text(page.id) : origin === 'LIVE' ? text(row.id) : '');
  const eventIndex = Number.isSafeInteger(row.eventIndex) && row.eventIndex >= 0 ? row.eventIndex : page.format === 'ARCHIVE_PAGE' ? rowIndex : null;
  const reviewId = text(row.reviewId) || (origin && storageId && (origin === 'LIVE' || eventIndex !== null) ? `${origin}:${storageId}${origin === 'ARCHIVE' ? ':' + eventIndex : ''}` : null);
  return { file, page: pageIndex, row: rowIndex, reviewId, origin, storageId: storageId || null, eventIndex };
}

function coverageFor(pages) {
  const unresolvedNextCursors = pages.filter(page => page.nextCursor && !pages.some(other => other.origin === page.origin && other.requestCursorKnown && other.requestCursor === page.nextCursor)).map(page => ({ file: page.file, page: page.page, origin: page.origin, nextCursor: page.nextCursor }));
  const known = pages.filter(page => page.requestCursorKnown && page.origin);
  let chainComplete = pages.length > 0 && known.length === pages.length;
  const origins = [...new Set(known.map(page => page.origin))];
  for (const origin of origins) {
    const subset = known.filter(page => page.origin === origin);
    let cursor = null;
    const visited = new Set();
    while (true) {
      if (visited.has(cursor)) { chainComplete = false; break; }
      visited.add(cursor);
      const matching = subset.filter(page => page.requestCursor === cursor);
      if (!matching.length || new Set(matching.map(page => page.nextCursor)).size !== 1) { chainComplete = false; break; }
      cursor = matching[0].nextCursor;
      if (!cursor) break;
    }
    if (subset.some(page => !visited.has(page.requestCursor))) chainComplete = false;
  }
  const partial = unresolvedNextCursors.length > 0 || pages.some(page => page.issues.length > 0) || (known.length > 0 && !chainComplete);
  return { status: partial ? 'PARTIAL' : chainComplete ? 'EXPORTED_CHAIN_COMPLETE' : 'UNVERIFIED', unresolvedNextCursors,
    disclosure: 'Counts describe supplied exports only. A complete exported cursor chain is not a frozen snapshot or proof of complete stored evidence; concurrent ingestion may change pages.' };
}

export function inventoryEvidence(inputs, options = {}) {
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  const staleDays = options.staleDays ?? 730;
  if (!Number.isFinite(now) || !Number.isSafeInteger(staleDays) || staleDays < 1) throw new Error('Use a valid --now ISO timestamp and positive integer --stale-days.');
  const pages = [], records = [], seenExports = new Map(), reviewHashes = new Map();
  let inputRows = 0, repeatedExports = 0;
  const inputMetadata = inputs.map(input => {
    const file = text(input.name);
    if (!file) throw new Error('Each input needs a local file name.');
    const documentPages = unpack(input.data);
    documentPages.forEach((page, pageIndex) => {
      const pageIssues = [...new Set([...(Array.isArray(page.issues) ? page.issues.filter(value => typeof value === 'string') : []), ...(Array.isArray(page.pageIssues) ? page.pageIssues.filter(value => typeof value === 'string') : [])])];
      const receipt = { file, page: pageIndex, format: page.format, origin: ['LIVE', 'ARCHIVE'].includes(page.origin) ? page.origin : null, rows: page.rows.length,
        requestCursorKnown: Object.hasOwn(page, 'requestCursor'), requestCursor: text(page.requestCursor) || null, nextCursor: text(page.nextCursor) || null, issues: pageIssues };
      pages.push(receipt);
      page.rows.forEach((value, rowIndex) => {
        inputRows++;
        const row = object(value) ? value : {};
        const ref = storageReference(row, page, file, pageIndex, rowIndex);
        const exportHash = hash(value);
        const exportKey = ref.reviewId ? JSON.stringify([ref.reviewId, exportHash]) : null;
        if (exportKey && seenExports.has(exportKey)) { repeatedExports++; seenExports.get(exportKey).occurrences.push(ref); return; }
        const inspected = quality(value, now, staleDays, page.expectedSource);
        const record = { ref, sourceKey: text(row.sourceKey), externalId: text(row.externalId), project: text(row.project), provenance: text(row.provenance), sourceObservedAt: row.sourceObservedAt ?? null, observedAt: text(row.observedAt),
          contentHash: /^[a-f0-9]{64}$/i.test(text(row.contentHash)) ? row.contentHash : exportHash, contentHashOrigin: /^[a-f0-9]{64}$/i.test(text(row.contentHash)) ? 'SUPPLIED_ORIGINAL' : 'EXPORTED_ROW', exportHash,
          comparableContentHash: hash(Object.fromEntries(comparableFields.map(field => [field, field === 'sourceObservedAt' && typeof row[field] !== 'string' ? row[field] ?? '' : text(row[field])]))), ...inspected, occurrences: [ref] };
        if (ref.reviewId) {
          const previous = reviewHashes.get(ref.reviewId) || new Set();
          if (previous.size && !previous.has(exportHash)) record.issues.push('REVIEW_RECORD_CHANGED_BETWEEN_EXPORTS');
          previous.add(exportHash); reviewHashes.set(ref.reviewId, previous);
          seenExports.set(exportKey, record);
        }
        records.push(record);
      });
    });
    return { file, fileHash: input.fileHash || hash(input.data), hashOrigin: input.fileHash ? 'FILE_BYTES' : 'CANONICAL_JSON', pages: documentPages.length };
  });
  const grouped = new Map();
  for (const record of records) {
    if (!record.sourceKey || !record.externalId) continue;
    const key = JSON.stringify([record.sourceKey, record.externalId]);
    const group = grouped.get(key) || [];
    group.push(record); grouped.set(key, group);
  }
  let storedDuplicateRows = 0, duplicateCandidateRows = 0, revisionIdentities = 0, additionalContentVersions = 0;
  const identities = [...grouped.values()].map(group => {
    const versions = new Map();
    for (const record of group) { const version = versions.get(record.comparableContentHash) || []; version.push(record); versions.set(record.comparableContentHash, version); }
    let storedDuplicates = 0, unlocatedDuplicates = 0;
    for (const version of versions.values()) {
      const located = new Set(version.map(record => record.ref.reviewId).filter(Boolean));
      const anonymous = version.filter(record => !record.ref.reviewId);
      storedDuplicates += Math.max(0, located.size - 1);
      unlocatedDuplicates += Math.max(0, anonymous.length - (located.size ? 0 : 1));
      if (located.size > 1 || (anonymous.length && version.length > 1)) for (const record of version) record.issues.push(located.size > 1 ? 'POSSIBLE_STORED_DUPLICATE' : 'POSSIBLE_DUPLICATE_CONTENT');
    }
    storedDuplicateRows += storedDuplicates; duplicateCandidateRows += unlocatedDuplicates;
    if (versions.size > 1) revisionIdentities++;
    additionalContentVersions += Math.max(0, versions.size - 1);
    return { sourceKey: group[0].sourceKey, externalId: group[0].externalId, observations: group.length, storageLocations: new Set(group.map(record => record.ref.reviewId).filter(Boolean)).size,
      contentVersions: versions.size, storedDuplicateRows: storedDuplicates, duplicateCandidateRows: unlocatedDuplicates, refs: group.map(record => record.ref) };
  });
  const quarantineCandidates = records.filter(record => record.issues.some(issue => quarantineIssues.has(issue))).map(record => ({ ref: record.ref, sourceKey: record.sourceKey, externalId: record.externalId, contentHash: record.contentHash, exportHash: record.exportHash, provenance: record.provenance, issues: record.issues, action: 'HUMAN_REVIEW_REQUIRED' }));
  const issueCounts = {};
  for (const record of records) for (const issue of new Set(record.issues)) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  return { schemaVersion: 1, mode: 'DRY_RUN', generatedAt: new Date(now).toISOString(), policy: { staleDays, futureGraceDays: 1, comparableContentFields: comparableFields, collectionTimeEstablishesActivity: false }, inputs: inputMetadata,
    summary: { inputRows, retainedObservations: records.length, repeatedExports, changedReviewIds: [...reviewHashes.values()].filter(hashes => hashes.size > 1).length,
      unlocatedRows: records.filter(record => !record.ref.reviewId).length, uniqueIdentities: identities.length, storedDuplicateRows, duplicateCandidateRows, revisionIdentities, additionalContentVersions, needsReview: records.filter(record => record.issues.length).length, quarantineCandidates: quarantineCandidates.length, issueCounts },
    coverage: coverageFor(pages), pages, identities, records, quarantineCandidates,
    limitations: ['No source files or stored data are changed. Every quarantine candidate requires human review.', 'Comparable content uses only fields available in review exports. Original hashes are retained but cannot be verified against omitted source fields.', 'Matching source IDs or projected content do not establish that historical versions are redundant; missing storage references cannot prove physical duplicates.'] };
}

const localities = ['Perth WA', 'Pilbara WA', 'Albany WA', 'Geraldton WA', 'Kalgoorlie WA', 'Bunbury WA', 'Brisbane QLD', 'Logan QLD', 'Townsville QLD', 'Cairns QLD', 'Mackay QLD', 'Toowoomba QLD', 'Sydney NSW', 'Hunter NSW', 'Newcastle NSW', 'Wollongong NSW', 'Dubbo NSW', 'Tamworth NSW', 'Melbourne VIC', 'Geelong VIC', 'Ballarat VIC', 'Bendigo VIC', 'Adelaide SA', 'Whyalla SA', 'Port Augusta SA', 'Mount Gambier SA', 'Darwin NT', 'Alice Springs NT', 'Hobart TAS', 'Launceston TAS', 'Burnie TAS', 'Canberra ACT'];
const categories = ['Solar Facility', 'Bridge Renewal', 'Water Pipeline', 'Rail Terminal', 'Battery Storage'];

/** Every five unique source rows represent four projects, including one cross-source title variant. */
export function buildRepresentativeEvidence(size) {
  if (!Number.isSafeInteger(size) || size < 5 || size % 5 !== 0) throw new Error('Benchmark sizes must be positive multiples of five.');
  return Array.from({ length: size }, (_, index) => {
    const variant = index % 5, project = Math.floor(index / 5) * 4 + (variant < 2 ? 0 : variant - 1);
    const suffix = String(project).padStart(6, '0');
    return { sourceKey: 'synthetic-' + (index % 7), externalId: 'record-' + index,
      project: `Mallee${suffix} Creek${suffix} ${categories[project % categories.length]}${variant === 1 ? ' Extension' : ''}`, location: localities[project % localities.length],
      sourceObservedAt: index % 11 === 0 ? '' : index % 13 === 0 ? '2020-01-01' : '2026-09-01', observedAt: '2026-09-16',
      company: index % 3 ? 'Synthetic Owner' : '', description: 'Synthetic benchmark input; not a real project or commercial signal', provenance: 'https://example.test/benchmark/' + index };
  });
}

export async function benchmarkCanonicalGrouping(sizes = [1500, 10000, 50000], timeoutMs = 60000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100) throw new Error('Benchmark timeout must be at least 100 milliseconds.');
  const samples = [];
  for (const size of sizes) {
    buildRepresentativeEvidence(size);
    const started = performance.now();
    const sample = await new Promise((resolveSample, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
        (async () => { const { buildRepresentativeEvidence } = await import(workerData.inventoryUrl);
          const { groupCanonicalEvidence } = await import(workerData.domainUrl);
          const rows = buildRepresentativeEvidence(workerData.size), start = performance.now();
          const groups = groupCanonicalEvidence(rows), elapsedMs = performance.now() - start;
          parentPort.postMessage({status: 'COMPLETED', rows: rows.length, expectedCanonicalGroups: workerData.size * 4 / 5, canonicalGroups: groups.size, retainedRows: [...groups.values()].reduce((n, group) => n + group.length, 0), elapsedMs});
        })().catch(error => { throw error; });`, { eval: true, workerData: { inventoryUrl: import.meta.url, domainUrl: new URL('../backend/domain-hardening.ts', import.meta.url).href, size } });
      const timeout = setTimeout(() => { void worker.terminate(); resolveSample({ status: 'TIMEOUT', rows: size, expectedCanonicalGroups: size * 4 / 5, elapsedMs: performance.now() - started, timeoutMs }); }, timeoutMs);
      worker.once('message', result => { clearTimeout(timeout); resolveSample(result); });
      worker.once('error', error => { clearTimeout(timeout); reject(error); });
      worker.once('exit', code => { if (code !== 0) { clearTimeout(timeout); reject(new Error('Benchmark worker exited with code ' + code)); } });
    });
    samples.push(sample);
  }
  return { runtime: process.version, platform: process.platform, architecture: process.arch, samples,
    disclosure: 'Synthetic mixed titles, 32 localities and 7 sources; 20% cross-source corroboration. Grouping-only elapsed times on this machine, not a database, API or production capacity guarantee. Timeout includes worker startup; completed timings exclude startup and input construction.' };
}

const usage = `Usage: node scripts/inventory-evidence.mjs [--now ISO] [--stale-days DAYS] FILE.json [FILE.json ...]
       node scripts/inventory-evidence.mjs --benchmark [--sizes 1500,10000,50000] [--benchmark-timeout-ms 60000]
Read-only local JSON inputs; findings go to stdout. No network, credentials, file writes or automatic quarantine.
`;

async function main(args) {
  const files = [], options = {};
  let benchmark = false, sizes, timeoutMs;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') { process.stdout.write(usage); return; }
    if (argument === '--') { files.push(...args.slice(index + 1)); break; }
    if (argument === '--benchmark') { benchmark = true; continue; }
    if (['--now', '--stale-days', '--sizes', '--benchmark-timeout-ms'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + argument);
      if (argument === '--now') options.now = value;
      if (argument === '--stale-days') options.staleDays = Number(value);
      if (argument === '--sizes') sizes = value.split(',').map(Number);
      if (argument === '--benchmark-timeout-ms') timeoutMs = Number(value);
      continue;
    }
    if (argument.startsWith('--')) throw new Error('Unknown option: ' + argument);
    files.push(argument);
  }
  if (!files.length && !benchmark) throw new Error('Provide at least one explicit local JSON file or --benchmark.');
  if (!benchmark && (sizes !== undefined || timeoutMs !== undefined)) throw new Error('Benchmark options require --benchmark.');
  const inputs = [];
  for (const file of files) {
    if (/^[a-z]+:\/\//i.test(file)) throw new Error('Only local file paths are accepted.');
    const bytes = await readFile(resolve(file));
    inputs.push({ name: file, fileHash: createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) });
  }
  const report = files.length ? inventoryEvidence(inputs, options) : { schemaVersion: 1, mode: 'BENCHMARK_ONLY' };
  if (benchmark) report.benchmark = await benchmarkCanonicalGrouping(sizes, timeoutMs);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error), mode: 'NO_CHANGES' }) + '\n'); process.exitCode = 2; });
}
