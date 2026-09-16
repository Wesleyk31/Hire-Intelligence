import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inventoryEvidence, buildRepresentativeEvidence } from '../../scripts/inventory-evidence.mjs';
import { groupCanonicalEvidence } from '../../backend/domain-hardening';

const now = '2026-09-16T00:00:00.000Z';
const row = (extra = {}) => ({ sourceKey: 'qa-feed', externalId: 'stable-77', project: 'Synthetic River Crossing', location: 'Perth WA', company: '', description: 'Synthetic evidence only', sourceObservedAt: '2026-09-01', observedAt: now, provenance: 'https://example.test/evidence/77', ...extra });
const reviewed = (reviewId: string, extra = {}) => ({ ...row(), reviewId, origin: 'ARCHIVE', storageId: reviewId.split(':')[1], eventIndex: Number(reviewId.split(':')[2]), contentHash: 'a'.repeat(64), issues: [], ...extra });

describe('read-only exported evidence inventory', () => {
  it('separates repeated export IDs, duplicate stored rows, content revisions and other sources across files', () => {
    const a = reviewed('ARCHIVE:page-a:0');
    const inputs = [{ name: 'first.json', data: { origin: 'ARCHIVE', requestCursor: null, nextCursor: 'page-b', items: [a] } },
      { name: 'second.json', data: { origin: 'ARCHIVE', requestCursor: 'page-b', items: [a, reviewed('ARCHIVE:page-b:0'), reviewed('ARCHIVE:page-b:1', { description: 'Revised source description' }), reviewed('ARCHIVE:page-b:2', { sourceKey: 'another-feed' })] } }];
    const before = JSON.stringify(inputs);
    const result = inventoryEvidence(inputs, { now });
    expect(result.summary).toMatchObject({ inputRows: 5, repeatedExports: 1, uniqueIdentities: 2, storedDuplicateRows: 1, revisionIdentities: 1, additionalContentVersions: 1 });
    expect(result.identities.find((item: any) => item.sourceKey === 'qa-feed')).toMatchObject({ externalId: 'stable-77', storageLocations: 3, contentVersions: 2 });
    expect(result.records[0].occurrences).toHaveLength(2);
    expect(result.records[0].contentHash).toBe('a'.repeat(64));
    expect(result.records[0].exportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.coverage.status).toBe('EXPORTED_CHAIN_COMPLETE');
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it('reports changed exports of the same storage row without inventing a second stored duplicate', () => {
    const result = inventoryEvidence([{ name: 'changed.json', data: [reviewed('ARCHIVE:a:0'), reviewed('ARCHIVE:a:0', { description: 'Changed since previous export', contentHash: 'b'.repeat(64) })] }], { now });
    expect(result.summary).toMatchObject({ inputRows: 2, repeatedExports: 0, changedReviewIds: 1, storedDuplicateRows: 0 });
    expect(result.records[1].issues).toContain('REVIEW_RECORD_CHANGED_BETWEEN_EXPORTS');
    expect(result.coverage.status).toBe('UNVERIFIED');
  });

  it('keeps unlocated duplicate candidates separate from confirmed distinct storage references', () => {
    const result = inventoryEvidence([{ name: 'raw.json', data: [row(), row()] }], { now });
    expect(result.summary).toMatchObject({ storedDuplicateRows: 0, unlocatedRows: 2, duplicateCandidateRows: 1 });
    expect(result.identities[0].storageLocations).toBe(0);
    expect(result.quarantineCandidates.some((item: any) => item.issues.includes('POSSIBLE_DUPLICATE_CONTENT'))).toBe(true);
  });

  it('flags AEMO metadata and strict date quality without treating collection timestamps as source activity', () => {
    const records = [
      row({ sourceKey: 'aemo-generation-information', externalId: '0', project: 'Site Name', sourceObservedAt: '' }),
      row({ externalId: 'unknown', sourceObservedAt: 'Unknown' }),
      row({ externalId: 'invalid', sourceObservedAt: '2026-02-30' }),
      row({ externalId: 'future', sourceObservedAt: '2099-01-01' }),
      row({ externalId: 'stale', sourceObservedAt: '2020-01-01' }),
      row({ externalId: 'fresh', sourceObservedAt: '2026-09-16' }),
      null,
    ];
    const result = inventoryEvidence([{ name: 'quality.json', data: records }], { now });
    expect(result.records.map((item: any) => item.sourceDateStatus)).toEqual(['UNKNOWN', 'UNKNOWN', 'INVALID', 'FUTURE', 'STALE', 'CURRENT', 'UNKNOWN']);
    expect(result.records[0].issues).toEqual(expect.arrayContaining(['AEMO_METADATA_ROW', 'POSSIBLE_POSITIONAL_ID', 'MISSING_SOURCE_DATE']));
    expect(result.records[2].issues).toContain('INVALID_SOURCE_DATE');
    expect(result.quarantineCandidates.map((item: any) => item.ref.row)).toEqual(expect.arrayContaining([0, 2, 3, 6]));
    expect(result.quarantineCandidates.every((item: any) => item.action === 'HUMAN_REVIEW_REQUIRED')).toBe(true);
  });

  it('discloses unresolved cursors, malformed archive pages and archive source mismatches', () => {
    const result = inventoryEvidence([{ name: 'pending.json', data: { origin: 'LIVE', requestCursor: null, nextCursor: 'not-exported', items: [] } },
      { name: 'bad-archive.json', data: { id: 'archive-bad', sourceKey: 'qa-feed', events: null } },
      { name: 'mismatch.json', data: { id: 'archive-mismatch', sourceKey: 'different-feed', events: [row()] } }], { now });
    expect(result.coverage.status).toBe('PARTIAL');
    expect(result.coverage.unresolvedNextCursors).toContainEqual({ file: 'pending.json', page: 0, origin: 'LIVE', nextCursor: 'not-exported' });
    expect(result.pages[1].issues).toContain('MALFORMED_ARCHIVE_PAGE');
    expect(result.records[0].issues).toContain('ARCHIVE_SOURCE_MISMATCH');
    expect(result.records[0].ref).toMatchObject({ reviewId: 'ARCHIVE:archive-mismatch:0', storageId: 'archive-mismatch', eventIndex: 0 });
  });

  it('runs on explicit local files, emits JSON, and never changes the source file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hire-evidence-inventory-'));
    try {
      const input = join(directory, 'evidence.json');
      const original = JSON.stringify([row(), row({ externalId: 'future', sourceObservedAt: '2099-01-01' })]);
      await writeFile(input, original, 'utf8');
      const output = execFileSync(process.execPath, [resolve('scripts/inventory-evidence.mjs'), '--now', now, input], { encoding: 'utf8' });
      const report = JSON.parse(output);
      expect(report.mode).toBe('DRY_RUN');
      expect(report.summary.inputRows).toBe(2);
      expect(report.inputs[0].fileHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await readFile(input, 'utf8')).toBe(original);
      expect(() => execFileSync(process.execPath, [resolve('scripts/inventory-evidence.mjs'), 'https://example.test/export.json'], { stdio: 'pipe' })).toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

it('representative mixed inputs retain all 1500 rows in 1200 stable canonical groups', () => {
  const records = buildRepresentativeEvidence(1500);
  const grouped = groupCanonicalEvidence(records);
  expect(new Set(records.map((item: any) => item.sourceKey + ':' + item.externalId)).size).toBe(1500);
  expect(new Set(records.map((item: any) => item.location)).size).toBeGreaterThan(20);
  expect(grouped.size).toBe(1200);
  expect([...grouped.values()].reduce((count, items) => count + items.length, 0)).toBe(1500);
  expect([...groupCanonicalEvidence([...records].reverse()).keys()].sort()).toEqual([...grouped.keys()].sort());
});

it('classifies numeric spreadsheet serials as invalid source dates and emits no work on import', () => {
  const result = inventoryEvidence([{ name: 'numeric-date.json', data: [row({ sourceObservedAt: 45000 })] }], { now });
  expect(result.records[0].sourceDateStatus).toBe('INVALID');
  expect(result.records[0].issues).toContain('INVALID_SOURCE_DATE');
  const moduleUrl = new URL('../../scripts/inventory-evidence.mjs', import.meta.url).href;
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)});`], { encoding: 'utf8' })).toBe('');
});

it('benchmarks the real canonical grouping implementation in a bounded worker', () => {
  const output = execFileSync(process.execPath, [resolve('scripts/inventory-evidence.mjs'), '--benchmark', '--sizes', '1500', '--benchmark-timeout-ms', '60000'], { encoding: 'utf8' });
  const result = JSON.parse(output);
  expect(result.mode).toBe('BENCHMARK_ONLY');
  expect(result.benchmark.samples[0]).toMatchObject({ status: 'COMPLETED', rows: 1500, canonicalGroups: 1200, retainedRows: 1500 });
  expect(result.benchmark.samples[0].elapsedMs).toBeGreaterThan(0);
});
