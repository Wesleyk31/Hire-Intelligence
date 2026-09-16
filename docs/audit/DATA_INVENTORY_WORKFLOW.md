# Evidence inventory and grouping load evidence

## Read-only local inventory

`scripts/inventory-evidence.mjs` reads only explicitly named local JSON files. It does not load the AppDeploy SDK, contact a network service, read credentials, write source files, delete records, or quarantine data. Findings are JSON on stdout. Importing the module starts no work.

Use Node 24 or a compatible runtime with native TypeScript stripping for the optional grouping benchmark. Inventory-only operation uses Node built-ins. No dependency installation is required.

From the repository root, with this workspace's bundled runtime:

```powershell
$taskNode = 'C:/Users/wkelm/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
& $taskNode scripts/inventory-evidence.mjs --now '2026-09-16T00:00:00Z' --stale-days 730 '.local/exports/live-001.json' '.local/exports/archive-001.json' |
  Set-Content -LiteralPath '.local/evidence-inventory.json' -Encoding utf8
```

The filenames are examples: provide actual local exports. The CLI creates no directories or files itself. Choose an output filename different from every input. Omit `--now` to use the current clock. Exit code 0 means the analysis ran; findings still require review. Invalid arguments, unreadable files, and malformed JSON return exit code 2 and a JSON error on stderr. `--help` prints usage. HTTP/HTTPS inputs are rejected. There is no implicit directory scan.

### Accepted JSON formats

- An array of evidence rows. Without explicit review/storage references these are unlocated observations, even when repeated content is present.
- A review response with `origin`, `items`, optional `nextCursor` and `pageIssues`, as returned by authenticated `GET /api/evidence/review?origin=ARCHIVE&limit=200` or the `LIVE` equivalent.
- An archive page object with `id`, `sourceKey`, and `events`. Event offsets identify each stored row.
- A `{ "records": [...] }` evidence envelope.
- A `{ "pages": [...] }` envelope containing review/archive page objects. Arrays of page objects should use this envelope; a plain array denotes evidence rows.

The tool does not fetch exports. Save each response separately, preserving its original row fields. To verify an exported pagination chain, include the cursor used to request each page as `requestCursor`: `null` for the first page, then the exact preceding `nextCursor`. For example:

```json
{
  "pages": [
    { "origin": "ARCHIVE", "requestCursor": null, "items": [], "nextCursor": "cursor-for-page-two" },
    { "origin": "ARCHIVE", "requestCursor": "cursor-for-page-two", "items": [] }
  ]
}
```

`EXPORTED_CHAIN_COMPLETE` means the supplied cursor receipts link from the first page to a terminal response. It does not prove a frozen snapshot or full database coverage. Unresolved next cursors, disconnected/cyclic receipts, and malformed pages are disclosed as `PARTIAL`. Exports without cursor receipts are `UNVERIFIED`. Concurrent ingestion can change page contents; repeatable reconciliation needs a stable export or ingestion pause outside this tool.

### How to read the findings

Every retained observation includes the input filename/page/row, storage reference when known, source key/external ID, project, provenance, original source date, collection date, issues, and hashes. Repeated exports retain all occurrence references.

| Finding | Meaning |
|---|---|
| `repeatedExports` | Same `reviewId` and identical exported row appeared again. Counted once for stored-data analysis. |
| `changedReviewIds` | The same storage review ID had different exported representations. This may reflect concurrent changes or changing review metadata; it is not a second storage location. |
| `storedDuplicateRows` | Additional distinct storage references have the same source/external ID and comparable exported content. They are review candidates; historical copies can be intentional. |
| `duplicateCandidateRows` | Repeated comparable content lacks enough storage references to establish physical duplicates. |
| `revisionIdentities` / `additionalContentVersions` | One source/external ID has multiple comparable content versions. No preferred version is silently selected. |
| `quarantineCandidates` | Advisory records marked `HUMAN_REVIEW_REQUIRED`; no quarantine occurred. |

Comparable content uses source key, external ID, project, location, company, description, source activity date, and provenance. Storage metadata and collection time do not create an artificial content revision. Fields omitted or truncated by review exports cannot be compared. Supplied original `contentHash` values remain attached but are not independently verifiable without the original full row. `exportHash` is SHA-256 over canonical exported JSON; `fileHash` from CLI inputs is SHA-256 over exact file bytes.

Quality findings cover malformed rows, missing identity/project/location/provenance, archive-source mismatches, known AEMO metadata headings, and small numeric IDs that may be positional. A small numeric ID is a clue, not proof of an invalid upstream identifier.

Source dates have five explicit states: `UNKNOWN`, `INVALID`, `FUTURE`, `STALE`, and `CURRENT`. Missing/unknown dates remain unknown; collection timestamps never establish source activity. Numeric spreadsheet serials and impossible calendar dates are invalid. Future means more than one day beyond the analysis clock. Stale means older than 730 days by default, configurable with `--stale-days`. Historical or undated evidence is not automatically invalid.

### Review and reconciliation workflow

1. Preserve exported originals and the generated report together. Record the collection origin, cursor receipts and collection period.
2. Resolve incomplete coverage before interpreting inventory totals as wider storage totals. Separate repeated exports from distinct storage locations.
3. Inspect each candidate's original storage reference and provenance. Verify AEMO headings, date interpretation, ID stability and whether equivalent records are intentional historical copies.
4. Keep historical revisions and unknown activity dates visible. Define a reviewed correction/re-ingestion decision for each affected source; do not manufacture dates or external IDs.
5. Any later quarantine or re-ingestion is separate from this tool. Match current stored hashes to the reviewed originals, preserve rollback copies, and reconcile source/archive/evidence/project counts after that work.

No real stored-data export was supplied during this implementation. Tests use explicitly synthetic evidence, so no live records were inventoried or repaired.

## Canonical grouping benchmark

Run the same representative workload:

```powershell
& $taskNode scripts/inventory-evidence.mjs --benchmark --sizes 1500,10000,50000 --benchmark-timeout-ms 60000 |
  Set-Content -LiteralPath '.local/evidence-grouping-benchmark.json' -Encoding utf8
```

`--benchmark` can also accompany explicit inventory files. Sizes must be positive multiples of five. Each workload has unique source IDs, seven sources, 32 localities, mixed project categories, and 20% cross-source corroboration with title expansion. The remaining projects are distinct; five records represent four canonical projects. It includes unknown/stale source dates, which do not alter title/location grouping. These are synthetic labels, not real projects or hire signals.

Each sample runs in a bounded worker. Completed timings measure grouping only, excluding worker startup and input generation. A timeout reports the elapsed deadline and no invented result count. Elapsed values are measurements, not machine-independent test thresholds or production capacity guarantees.

### 16 September 2026 results

Runtime: Node v24.19.0, Windows x64. Other local work may affect elapsed times.

| Input rows | Expected groups | Before | After | Rows retained after |
|---:|---:|---:|---:|---:|
| 1,500 | 1,200 | 136.16 ms | 57.54 ms | 1,500 |
| 10,000 | 8,000 | 2,248.49 ms | 364.79 ms | 10,000 |
| 50,000 | 40,000 | Exceeded 60,000 ms | 10,304.68 ms | 50,000 |

Before evidence: `.local/evidence-grouping-benchmark.json`. After evidence: `.local/evidence-grouping-benchmark-after.json`. These local artifacts remain excluded from Git; this table preserves the measured results.

The original implementation scored every prior group for each record. The updated implementation caches normalized titles/location keys and token sets, indexes groups by location and token, and scores only groups with at least one shared token. Merging a title updates the index. The existing 0.8 threshold, both similarity formulas, short-title behavior, representative keys, and original insertion-order tie break remain unchanged.

This reduces the measured workload but does not establish a linear worst case. Many unrelated titles sharing common tokens in one location can still create large candidate sets. The 50,000-row result is approximately 10.3 seconds of grouping alone; database loading, intelligence calculations, SDK limits and API response latency require separate staging measurement.

### Validation

- Nine inventory tests cover cross-file duplicates/revisions, changed review IDs, unknown storage references, date/AEMO quality, cursor/page issues, immutable input files, import behavior and a real grouping-worker run.
- Five differential tests compare the indexed implementation against a frozen exhaustive baseline: insertion-order ties across token postings, tokens added by a merge, short/empty/repeated tokens and location aliases, repeated-token collapse after a merge, plus 20 deterministic adversarial mixtures in both input orders.
- The representative 1,500-row test retains all 1,500 rows in 1,200 stable groups. Larger measured samples also match their independently specified counts.
- Targeted inventory/grouping/identity/backend/archive run: 55 tests passed across five files. Backend TypeScript passed. Existing broader acceptance remains part of the parent task's final checks.
