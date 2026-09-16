# Scopes 1–4: implementation and acceptance status

16 September 2026 · Hire Intelligence · branch `codex/hire-production-hardening`

## Outcome

Local repairs and implementation increments across all four scopes are delivered. **These scopes are not yet accepted in production.** Automatic approval review rejected the new isolated staging deployment because the request exceeded its **200,000-byte review limit**. No app was created, no scheduled job was enabled, and no live database was modified. The existing app remains on its prior release; the local protections are not a claim that the old live APIs are protected.

The user has been asked to approve that specific staging deployment. The rejected action has not been split, rerouted or retried through another execution path. Business identity/contact, administrator emails, retention periods and two authorized real staging accounts are still required for their respective acceptance checks.

| Scope | Implemented and verified locally | External acceptance still required |
|---|---|---|
| 1. Release blockers | Six self-contained SVG illustrations replace broken active artwork; original corrupt file retained. Authenticated operational routes, deferred workspace loading, deterministic release package and five platform workflow tests. | Approval review must permit staging; actual production build/runtime, provider sign-in/expiry/revocation, anonymous denial and two-account persistence. No production release until staging acceptance. |
| 2. Historical evidence and repair | Bounded continuation for live and archived evidence; previous/next windows; window-aware CRM validation; read-only record review/export; immutable fingerprints and quality findings; dry-run inventory; checked index intents stop uncertain insertion retries. | Inventory actual stored records, review/reconcile legacy indexes and physical duplicates, restart old WFS cursors deliberately, then prove source→archive→project reconciliation. SDK has no CAS/transactions: no distributed single-writer or exactly-once claim. |
| 3. Feeds and pilots | Corrected SA/NSW WFS layers and stable IDs; dedicated national workbook parser; provider-total pagination and repeated-page guards; Logan and QLD context previews with attribution/quarantine; read-only collector diagnostics. | Real scheduled ingestion, rights/access acceptance and legacy-ID migration before enabling recovered feeds. Resolve six latest feed errors and one empty source. Pilots remain read-only and are not promoted to demand alerts. |
| 4. Operations/performance | Per-source latency/date/duplicate/save observations; bounded refresh slices; partial-write uncertainty; lazy app/map/PDF loading; faster canonical grouping; Chrome/Edge/mobile/keyboard/PDF checks. | Observe real scheduled cycles, verify actual account storage and representative deployed performance; approve business Privacy/Terms, retention and administrator policy. |

## Final local verification

- **182 unit/API tests passed** across 16 files using real maintained handlers/normalizers with replaced network/database boundaries.
- **112 Chrome browser checks passed**, covering all 9 public pages and all 12 operational modules, desktop/mobile navigation, empty/error states, forms, search, drill-downs, map flows, CRM/report fixtures, pagination and delayed-save races.
- **18 Edge workflow checks passed**, including operational navigation, evidence review, pagination, CRM/account fixtures and source diagnostics. Chrome and Edge share Chromium; Safari/Firefox were not tested.
- Frontend and backend TypeScript passed. The explicit **verification build** passed; it contains test-runtime aliases and is not deployed. A real platform production build remains unverified.
- **24 format-tolerant static checks** and **21 original handoff SHA-256 checks** passed. The immutable original checker is retained; the maintained UTF-8 companion permits normal source formatting.
- Stress PDF: **15 pages**, **zero glyphs outside margins**, all 15 fleet recommendation markers and calibration counts retained. Rendered layout inspected. Homepage replacement artwork reviewed at desktop/mobile sizes and image decoding passes.
- Independent focused reviews found retry, pagination, quality-flag and delayed-save defects; reproduced failures now have passing regressions. No remaining P1/P2 finding in the final reviewed persistence/review/release paths. This is bounded review evidence, not a guarantee of zero undiscovered defects.

## Repairs made during review

1. Index acknowledgement failure could leave saved rows undiscoverable and duplicate them on retry. An acknowledged pending insertion intent now precedes additions. Uncertain/partial saves retain it and block blind retries; a successful final index replacement clears it.
2. Thrown write errors lost earlier acknowledged counts. The failure status preserves known saved counts, fetched rows and uncertainty, while quota errors still propagate.
3. Short ArcGIS/CKAN/ODS/WFS pages could falsely end backfill despite explicit continuation. Provider totals/transfer flags now govern completion; contradictory metadata and zero progress fail visibly.
4. WFS could repeat a page at another offset and skip unseen records. Checkpoints bind source/request/offset and page fingerprints, with numeric sort-boundary checks where available. Multipart raw-feature offsets are retained. Generic layer selection is pinned before archival writes.
5. Archived provider quality flags disappeared, and changed review pages could omit records. Flags/restrictions survive normalization and review; fingerprints reject changed resumed pages.
6. Delayed CRM saves could reload an earlier window after navigation or unmount. Saves lock window navigation and ignore stale/unmounted refreshes.
7. Reports and calibration mislabeled later-window outcomes as unresolved legacy data. Project/evidence sections now explicitly describe the current window; CRM outcomes retain account scope and source health/backfill retain system scope.
8. Logan multi-parcel applications could pick an arbitrary locality. Localities are retained deterministically and multiple localities are flagged.

## Measured performance

- Initial verification JavaScript: **266,444 bytes**, down from **911,536 bytes** (70.77%). Operational workspace is about 65 KB, map about 166 KB and PDF libraries load on use. These are local verification artifacts, not measurements of the old live deployment.
- Synthetic canonical grouping: 1,500 rows **57.54 ms**; 10,000 **364.79 ms**; 50,000 **10,304.68 ms**. Previous 50,000-row run exceeded 60 seconds. Every row was retained and differential tests preserve legacy grouping decisions. Common-token worst cases can still produce large candidate sets.

## Feed evidence

The 70-source pass at 02:42 UTC returned 56 row-producing sources, 13 errors and one empty source. A targeted 13-source retest at 02:54 UTC returned 12 row-producing sources and one error, recovering seven temporary DNS failures. Latest per-source observations combined across those two times are **63 with rows, six errors and one empty**. This combination is not a simultaneous uptime or scheduler measurement.

Remaining errors: Queensland granted resource authorities returned HTTP 202 without usable data; five NT sources returned HTTP 406. Queensland Stadiums returned no rows. A provider response with rows still needs domain/date/rights review and does not prove successful deployed ingestion.

All seven recovered WFS bindings returned sampled rows on retest. The national workbook helper yielded 432 unique projects, including 21 completed, using the Consolidated sheet. Recovered sources remain disabled pending acceptance and identifier reconciliation. SA power retains `NATURAL_ID_REVIEW_REQUIRED`.

Logan's real sample yielded six quarantined rows carrying `INVALID_INPUT`; QLD coordinated projects yielded six undated context records. Neither produced a demand alert. CER commercial linking, WA EPA licence acceptance, NSW planning access, WA major-project download and national roadworks licensing remain external dependencies.

Evidence: [full feed audit](FEED_AUDIT_2026-09-16T02-42-20-545Z.md), [targeted retest](FEED_AUDIT_2026-09-16T02-54-21-399Z.md), [recovered-feed acceptance](RECOVERED_FEED_ACCEPTANCE.md), [pilot acceptance](SOURCE_PILOT_ACCEPTANCE.md), [inventory workflow](DATA_INVENTORY_WORKFLOW.md), [artwork](ARTWORK_REPLACEMENT.md).

## Release artifact and next actions

The reviewed source bundle contains **52 files / 596,054 bytes**, with cron disabled and synthetic SDK/test runtime excluded. The new-app request contains 49 paths after omitting unchanged scaffold files and expressing scaffold edits as diffs. Five complete workflow tests include exactly one sanity workflow and an explicit read-only API fault case. Original rollback reference: live **v96 / 1789467699311**; no release occurred in this task.

Bundle SHA-256: `df0ba62ce659d462bbb153a54baff0722d2c9ce24b75543206b9a4191b97f3a7`.

Artifacts: `.local/release-staging/files.json` and `.local/release-staging/manifest.json`. Recreate with `node scripts/prepare-release.mjs --out .local/release-staging` after any maintained-source change.

1. Resolve the specific staging approval-review block, then deploy this reviewed source through AppDeploy and inspect build/QA errors to terminal status.
2. Complete real provider authentication and Actor A/B report/CRM acceptance using authorized accounts and legitimate staging evidence. Do not inject fake users or replace the runtime.
3. Inventory actual stored evidence; review pending insertion intents, legacy ID mappings and WFS restart points under an exclusive writer. Do not blindly clear intent markers or rewind live cursors.
4. Observe scheduled canaries before activating recovered feeds. Retain disabled/empty/provider-error distinctions and context-only restrictions.
5. Supply and approve business legal name, contact/admin emails and retention periods before onboarding customers.
