# Offline source-index repair proposals

`scripts/plan-evidence-repair.mjs` prepares a reviewable reconciliation proposal from explicitly supplied local exports. It never loads the platform SDK, accesses a database/provider, reads credentials, changes files, clears `pendingAddIntent`, deletes evidence, or applies a repair. Importing it performs no work.

This implements preparation for scope 2. No real stored-data export was supplied for this build, and no production records were inventoried or repaired. All test data is synthetic.

## Run

```powershell
$taskNode = 'C:/Users/wkelm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $taskNode scripts/plan-evidence-repair.mjs --source-key 'SOURCE_KEY' --snapshot '.local/exports/snapshot.json' --indexes '.local/exports/indexes.json' --now '2026-09-16T00:00:00Z' '.local/exports/live.json' '.local/exports/archive.json'
```

The paths are examples; supply actual preserved exports. Findings go to stdout. If redirecting output, choose a different path from every input. The script creates no files or directories. It has no `--apply` flag or output-file option.

- Exit **0**: `REVIEW_REQUIRED`; an exact proposed ID map is available for human review.
- Exit **1**: `BLOCKED`; the JSON report contains findings and blockers, and `proposal` is `null`.
- Exit **2**: invalid arguments, malformed JSON or UTF-8, unreadable inputs, duplicate JSON keys, or exceeded input limits; a JSON error goes to stderr.

Every report has `applicable: false`. A successful analysis is not authorization to change data, proof of a current exclusive writer, or acceptance of the source's content quality.

`--snapshot` and `--indexes` can be omitted to obtain blocked findings from ordinary inventory exports. `--source-key` and at least one explicit evidence file are required. Omit `--now` to use the current clock. URLs and UNC/network paths are rejected. There is no directory scan, export acquisition, or provider probe.

## Input contracts

The planner reuses `inventoryEvidence` for evidence, duplicate and revision findings. It accepts the inventory tool's review/archive formats for those findings. A terminal review cursor chain still cannot produce a proposal: review projections omit original fields and do not establish a frozen complete collection.

### Full collection export pages

A proposal requires **the complete `opportunities` collection and complete `opportunity_indexes` collection**, captured under a reviewed writer pause. Do not label a source-filtered export or a review projection as a complete full-storage export.

Each full-storage page has this wrapper around unchanged original database records:

```json
{
  "exportKind": "FULL_STORAGE",
  "snapshotId": "ACTUAL_REVIEWED_SNAPSHOT_ID",
  "origin": "LIVE",
  "requestCursor": null,
  "nextCursor": null,
  "records": []
}
```

This is a format illustration, not a stored-data receipt. Replace the example fields only with verified capture facts.

- Live opportunity records retain exact string `id`, `sourceKey`, `externalId`, and all original row fields. Supplied `storageId`, `reviewId`, `origin` and `eventIndex`, if present, must agree with that physical ID.
- Index records retain exact `id`, `sourceKey`, the complete `ids` object, the exact `pendingAddIntent` when present, and all original fields. Use the same page shape for indexes, omitting `origin`.
- Preserve an explicit `requestCursor` and `nextCursor` on every page. The first request is `null`; every intermediate next cursor matches exactly one subsequent request; the final next cursor is explicitly `null`. Repeated, missing, cyclic or disconnected receipts block proposals.
- Multiple pages use `{ "pages": [ ... ] }`. Live pages may span multiple explicit evidence files. All index pages are supplied through one `--indexes` file using the same envelope when needed.
- Exact repeated physical rows or overlapping pages block proposals; they are not silently deduplicated for reconciliation. Identical content at different live physical IDs also blocks. Revisions in live physical duplicates do not establish a preferred row.
- Optional archive inputs preserve historical findings and original supplied hashes. Archive locations are never used as IDs in a live source index, and supplied archive findings never establish complete archive coverage.

### Snapshot manifest

The separately supplied manifest binds the exact input file names and SHA-256 hashes of their **original bytes**, complete physical row counts, a snapshot identifier, capture time, reviewer and paused-writer attestation:

```json
{
  "snapshotId": "ACTUAL_REVIEWED_SNAPSHOT_ID",
  "capturedAt": "2026-09-16T00:00:00Z",
  "reviewedBy": "ACTUAL_REVIEWER",
  "writerState": "PAUSED",
  "collections": {
    "opportunities": {
      "complete": true,
      "rowCount": 0,
      "files": [{ "name": ".local/exports/live.json", "sha256": "SHA256_OF_EXACT_LIVE_FILE_BYTES" }]
    },
    "opportunity_indexes": {
      "complete": true,
      "rowCount": 0,
      "files": [{ "name": ".local/exports/indexes.json", "sha256": "SHA256_OF_EXACT_INDEX_FILE_BYTES" }]
    }
  }
}
```

These are schema placeholders, not data or assertions about production. Do not copy the example counts or claim a writer pause that has not occurred. `files[].name` must exactly match the corresponding CLI argument. Count every physical record in the complete collection, including other sources. Every relevant export file must appear exactly once, with no omitted or extra file receipts. Use the same snapshot identifier on all full-storage pages. The capture time must not be after the analysis time, and a pending intent must not be prepared after capture.

The tool independently checks byte hashes, rows and cursor structure **within the supplied artifacts**. It cannot independently verify the reviewer's identity, that no upstream rows were omitted, that collection occurred under a real writer pause, or that the database remains unchanged. The report labels those facts as attestations and always reports `independentlyVerified: false`.

## Proposal and blockers

When all preparation checks pass, `proposal.ids` contains the exact external-ID to physical database-ID mapping for the requested source. Each `mappings` entry contains its prior ID (if any), proposed ID, original row hash, file/page/row/storage reference and one reason:

| Reason | Meaning |
| --- | --- |
| `CONFIRMED_EXISTING` | Existing index mapping agrees with the confirmed original physical row. |
| `RECOVER_PENDING_ADD` | A pending external ID has exactly one confirmed physical row. The marker is still preserved. |
| `DISCOVERED_PHYSICAL_ROW` | A physical row exists but is absent from the index, or a complete index collection confirms that no source index exists. |

No existing mapping is silently dropped. A dangling mapping, a mapping to another identity, duplicate source indexes, missing or whitespace-altered identifiers, conflicting physical references, repeated physical IDs, ambiguous live duplicates, unresolved pending IDs, malformed markers, incomplete/unsnapshotted evidence, non-empty or malformed page issues, and mismatched hashes/counts block the proposal. An index exceeding the backend's 224 KiB record bound also blocks.

`indexEvidence` preserves the entire original affected index, including its exact pending marker, original hash and file/page/row reference. Full-row `originalHash` is SHA-256 over canonical JSON (object keys sorted recursively); input `fileHash` is SHA-256 over exact bytes. Inventory `contentHash` preserves a supplied original hash when available, but that field is not substituted for the planner's computed full-row hash.

Input quality and archived revisions remain inventory findings for review. Mapping an existing physical ID does not quarantine, promote, validate, merge, or change that evidence.

## Any later repair remains separate

The report carries these preconditions:

1. Human review and separate authorization of the concrete proposal.
2. A verified exclusive writer with collectors paused throughout validation, repair and acknowledgement. The SDK's absence of CAS/transactions means this file cannot establish a lock.
3. Fresh verification of complete current collections against the reviewed snapshot.
4. Exact current original row/index hashes and pending marker matching the reviewed originals. Any drift invalidates the proposal.
5. Preserved full originals and rollback references; no evidence deletion.
6. Acknowledged and read-back index mapping before explicitly reviewed marker resolution and writer resume.

There is no database writer, executable update payload, marker-clearing operation, or automatic retry in this CLI. The existing ingestion guard remains in force. Missing pending IDs are not assumed absent and are not retried.

## Programmatic use and bounds

```javascript
import { planEvidenceRepair } from './scripts/plan-evidence-repair.mjs';
const result = planEvidenceRepair(
  [{ name: 'live.json', bytes: liveFileBytes }],
  {
    sourceKey,
    indexExport: { name: 'indexes.json', bytes: indexFileBytes },
    snapshot: { name: 'snapshot.json', bytes: manifestFileBytes },
    now: '2026-09-16T00:00:00Z'
  }
);
```

`bytes` is a UTF-8 string or Buffer. Malformed UTF-8 byte sequences are rejected before JSON parsing; invalid identifier bytes are never replaced with a Unicode replacement character. The function computes file hashes internally and parses copies; it does not accept caller-invented hash overrides or mutate caller inputs.

Limits are 64 explicit files including snapshot/index inputs, 64 MiB combined original bytes, 5,000 total evidence/index pages, 100,000 supplied evidence/index rows, and 64 JSON nesting levels. Limits require a separately reviewed partitioning/export approach if exceeded; the tool does not truncate evidence or relax completeness.

Validation includes 18 tests covering exact mappings and preconditions, partial and projected exports, snapshot attestations, physical/identity collisions, duplicates/revisions, dangling mappings, pending marker failures, exact original hashes/references, malformed UTF-8 with matching snapshot hashes, malformed and duplicate JSON keys, row/nesting bounds, index capacity, source isolation, import behavior, and CLI input immutability. No real database or provider is used by these tests.
