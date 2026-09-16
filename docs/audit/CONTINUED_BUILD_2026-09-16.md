# Accepted continuation: evidence quality, recovery and repair preparation

16 September 2026. Continues the accepted scopes 1–4 from commit `c022798`. No production change or real data repair occurred.

## Changes and acceptance

1. **Evidence quality:** `contextOnly`, `promotionEligible: false`, nonempty quality flags and malformed restrictions now exclude a record from stage, priority, contractor, equipment and demand-event inference. Eligible rows alone define canonical groups and commercial ranking. Restricted evidence remains visible with reasons. Public aggregates exclude held rows. Archive normalization retains malformed restrictions; within-window duplicate selection unions known holds rather than letting a preferred newer/live version erase them. Stored originals are unchanged.
2. **Read projections:** dashboard/CRM project construction no longer writes stage snapshots. Existing snapshots remain comparison baselines; new baselines and advancement require a future explicit ingestion reconciliation under a controlled writer. This avoids physical duplicate snapshots caused by bounded reads. No new stage-history persistence is claimed.
3. **Review and reporting:** the project drawer shows eligible/held counts and per-record reasons. Source activity is separate from collection time, with unknown dates explicit. Reports disclose held evidence separately from scored evidence. The report cover uses a fixed metric-label width for readable wrapping.
4. **Repair proposals:** the offline planner requires complete original LIVE/index exports, exact file hashes/counts/cursor chains and a reviewed paused-writer snapshot attestation before emitting exact proposed mappings. Even successful analysis is review-only and `applicable: false`. It has no apply/delete/marker-clear path. Partial/sanitized/ambiguous exports block proposals; malformed UTF-8 is rejected before it can alter identifiers. [Contract and CLI](EVIDENCE_REPAIR_PROPOSALS.md).
5. **Feed recovery:** NT mines and mineral occurrences now share a bounded ZIP/KML parser, use MODAT identifiers, preserve source fields and bind backfill continuation to a content snapshot. Every row is held for context/rights review. Both feeds stay disabled. Real collectors returned mines 40 live/61 historical rows and occurrences 40 live/100 historical rows; all sampled source dates remain unknown. [Receipts and remaining failures](REMAINING_FEED_RECOVERY.md).

## Verification

- 231 unit/API tests across 19 files; frontend/backend TypeScript passed.
- 113 Chrome checks across all 9 public pages and 12 operational modules; 18 Edge workflows passed. Tests use isolated fixtures, not real provider authentication or production storage.
- 24 maintained static checks and all 21 original handoff SHA-256 checks passed.
- Verification build passed; production SDK build remains blocked with staging.
- Stress PDF: 15 pages, zero glyphs outside margins, all 15 fleet-note markers and calibration retained. Cover rendered and visually checked after layout adjustment.
- Independent review reproduced and fixed held-count ranking inflation, blank-flag eligibility and invalid UTF-8 identity substitution. Final focused review accepted the bounded duplicate-hold fix. No material finding remained in these reviewed changes; undiscovered issues remain possible.
- An initial concurrent browser run failed when Vite watched a locked generated Edge trace. The verification server now ignores `.local`, `test-results` and `playwright-report`; subsequent complete browser runs passed.

## Remaining work

The user explicitly approved the 49-path isolated staging request with cron disabled. Its direct retry was rejected before deployment by the same **200,000-byte automatic approval review limit**. No app was created. Do not ask for that approval again, split the request or reroute it to evade the rejection.

When that technical limit is resolved, stage through AppDeploy, validate the actual SDK/provider and two-account persistence, then observe scheduled canaries. Obtain actual reviewed exports for repair proposals; do not infer a distributed writer guarantee from an offline attestation. Supply the previously requested legal business/contact/admin/retention details and authorized staging accounts before their acceptance gates.

Remaining collector limitations: Queensland granted-authority workbook returns 202; Stadiums datastore is empty and its workbook is challenged; three NT title feeds require scalable export/domain/identity/date work. Recovered-feed rights and legacy-ID review remain required. Known holds are preserved only among records read in a bounded window; unseen revisions require complete indexed reconciliation.
