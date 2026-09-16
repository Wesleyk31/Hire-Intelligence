# Hire Intelligence â€” full-site audit
## 16 September 2026 Â· Australia/Perth

**Audit complete; release readiness is not complete.** Every current page was run, faults were reproduced and repaired locally, all registered feeds were probed, and seven incremental source families were researched. The live deployment still runs the older version. No deployment, GitHub push, live data mutation or external form/message submission was performed.

## Verification results

| Check | Measured result |
|---|---|
| Page inventory | 9 public pages + 12 operational modules, all exercised at desktop and mobile sizes |
| Local Chrome suite | **88 passed, 1 failed, 0 skipped** across 89 tests; failure is corrupt approved homepage artwork |
| Live navigation | All 21 page headings rendered; 0 page JavaScript errors during read-only navigation |
| Unit/API/parser tests | **52 passed** across 6 files, including 18 feed regressions |
| TypeScript | Frontend and backend pass |
| Static hardening checks | **24/24 pass** |
| Large PDF | 15 pages inspected; 0 out-of-margin glyphs; all 15 fleet notes and calibration retained |
| Handoff preservation | **21/21 SHA-256 entries match** |
| Dependency audit | **30 known advisories reduced to 0** after PDF/spreadsheet package updates |
| Verification build | Pass; main JS 909.56 kB (284.01 kB gzip), with size warning |
| Production build/auth/storage | Requires actual private AppDeploy runtime and staging; not established by local fixtures |

[Browser result inventory](BROWSER_RESULTS.json) Â· [Page/pathway details](UI_AUDIT.md) Â· [Dependency evidence](DEPENDENCY_AUDIT.md)

## Faults repaired locally

- Broken search-to-project pathways, stale map selections, browser-history drawer behavior, keyboard focus/Escape, overlapping controls, scroll positioning and narrow-screen forms/empty states.
- Source content interpreted as tooltip HTML; tooltips now use plain text.
- Old/undated source records appearing recent because of collection timestamps, and event dates inherited from unrelated evidence.
- CRM calibration inflated by repeated outcomes, ambiguous project matching and quality-assurance rows.
- Public regional summaries, report-history response/validation/sorting and missing/stale source-health states.
- Long fleet/calibration notes overflowing PDF pages.
- AEMO glossary rows becoming projects, duplicate KCI IDs, date/holder-role mappings, CKAN resource switching and AusTender pagination/date-window drift.
- Response-body time/size limits, future Melbourne permit dates and false-success reporting for partial/degraded ingestion.

The tests exercise application handlers and real parsers with controlled boundaries; they do not certify the platform identity provider or deployed database.

## Remaining release blockers

### P1 â€” live operational data is accessible without signing in

A fresh browser session received HTTP 200 and operational dashboard fields from the live API. All 12 internal pages were accessible anonymously. The local branch adds authentication and account scoping, but those changes are **not deployed**. New public-summary/report-history routes return 404 on the older deployment.

First release work: build with the real runtime; prove anonymous denial, session lifecycle and two-account isolation in staging; then release the reviewed branch. See [live evidence](LIVE_PLATFORM_AUDIT.md).

### P2 â€” approved homepage artwork is corrupt

Both the checked live JPEG and local baseline file are 5,128 bytes and fail decoding. The five feature photos and related background strips are blank. The regression remains failing. Restore the intact approved original; a text-location question is pending. No substitute design was invented.

### P2 â€” incomplete and unreliable data coverage

The historical archive does not yet feed the dashboard index. Existing bounded windows and single-resource/layer adapters do not provide exhaustive historical coverage. Malformed production rows created by older parsers need a reviewed migration. External source outages remain visible, not relabelled as success.

## Feed findings

All **70 definitions** were probed: 53 enabled, 13 disabled and 4 historical-only. Initial enabled samples: **51/53 returned rows**. Final complete pass: **49/53 returned rows**, with two WA timeouts, one Queensland download error and one empty Queensland dataset.

The two persistent gaps are Queensland granted resource authorities and Stadiums Queensland contracts. WA endpoints showed intermittent timeouts. Five disabled sources now parse (four SA and the national major-project workbook); three NSW replacement WFS layers were verified separately. No disabled/new source was activated.

The live dashboard reported 51 SUCCESS/2 DEGRADED and cron success, but those statuses do not prove data completeness or parser correctness. See [feed summary](FEED_AUDIT_SUMMARY.md) and its 70-row evidence table.

## Additional data sources

Seven official source families were ranked: Logan development applications; Queensland coordinated projects; CER renewable pipeline; WA EPA proposals; NSW DA/CDC/PCC; WA Major Resources Projects; national harmonised roadworks.

Start with small **Logan** and **Queensland coordinated-project** pilots after existing ingestion repairs. Logan has an unexplained upstream quality flag; coordinated projects supply pipeline context rather than a dated demand trigger. The other candidates retain explicit licence, access, duplication or download conditions. See [source research](NEW_SOURCE_RESEARCH.md).

## Next scope

1. **Release readiness:** restore artwork; real runtime/staging; authentication and account isolation; authorised release.
2. **Historical/data repair:** connect archive evidence to the project index, add replay-safe ingestion, reconcile counts, quarantine/re-ingest old malformed rows.
3. **Feed recovery and expansion:** validate recovered sources, then pilot Logan and Queensland context data.
4. **Operational acceptance:** per-source quality monitoring, representative load tests, code splitting and broader device/accessibility checks.

[Detailed scope and acceptance criteria](NEXT_SCOPE.md)

This audit establishes the listed evidence, not a guarantee that no possible fault exists. The current browser suite is intentionally red for the unresolved image asset, and the public deployment is not yet the repaired local application.
