# Production automation rollout — 18 September 2026

**Historical rollout record.** The 19 September hosting outage is recorded in [INCIDENT_2026-09-19.md](INCIDENT_2026-09-19.md). Service was available again on 20 September, with repairs and economy schedules recorded in [RECOVERY_2026-09-20.md](RECOVERY_2026-09-20.md). The original schedules and checks below describe the 18 September rollout, not current cadence or availability.

## Architecture and implementation

Hirer Intelligence remains a React/Vite/TypeScript application on AppDeploy with its existing managed key-value database. GitHub Actions invokes narrowly scoped backend operations using verified, short-lived GitHub OIDC identities bound to this repository, immutable repository/owner IDs, main, an approved workflow and run identity. No database URL, permanent production API token or source credentials were added.

The implementation adds durable source registry, source discovery/admission, job/run/report receipts and watchdog state. Existing source IDs, evidence, source cursors, outcomes and report history are preserved. Database changes are additive; no SQL database, destructive migration, reseed or checkpoint reset is introduced. The SDK has no transactions, unique constraints or compare-and-swap: production writers are serialized by one GitHub concurrency group. Interrupted ambiguous writes are held for reconciliation.

## Workflow schedules

All schedules below use UTC and support manual dispatch.

| Workflow                     | Schedule                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Live Source Refresh          | Minutes 03, 18, 33, 48                                                              |
| Source Health                | Hourly at minute 11                                                                 |
| Historical Backfill          | Minutes 07, 22, 37, 52                                                              |
| Source Validation            | Daily at 02:41                                                                      |
| Production QA, including E2E | PRs, pushes to main, successful deployment events, and every six hours at minute 26 |
| Workflow Watchdog            | Minutes 09 and 39                                                                   |

Badges and detailed permissions are in README and GITHUB_ACTIONS.md. The watchdog evaluates actual GitHub timestamps and conclusions; missing runs become STALE. A watchdog hosted on GitHub cannot independently detect an outage that stops GitHub and itself.

## Source health and admission

Hourly checks probe accessibility, parser/response compatibility, declared schema where available, authentication, bounded pagination and observed record dates. Unproved checks—including freshness where a publisher-specific expectation is absent—remain NOT_VERIFIED. One bounded retry is allowed for identified transient transport failures. Structural failures hold collection; access/authentication/licence-contract changes require review; repeated failures degrade the source. Disabled configuration is preserved, with its reason.

Fixed WA and Australian Government catalogue queries rotate across the requested industry categories, at most five datasets per run. Discovered URLs are metadata only. Candidates never become production collectors automatically. Activation requires a reviewed compiled adapter and documented legal, provenance, licence, pagination, field, rate-limit, freshness and reproducibility evidence. Existing pilot review gaps remain REVIEW_REQUIRED.

## Backfill and evidence

Backfill processes a bounded page from the stored source checkpoint, preserves pinned resource/window context and advances only after acknowledged evidence storage. Content fingerprints preserve factual revisions while preventing repeat insertion of the same evidence version. An additive legacy identity index is built in bounded steps before new historical ingestion. This maintenance progress is distinct from newly ingested evidence.

Per-run receipts retain before/after checkpoints, source identity, counts, timing, failures, completion and retry information. Unknown totals remain null. Legacy processed counts are not represented as unique evidence insertion totals. Original structured evidence, source URLs, record IDs, publisher and licence metadata are preserved when available.

Equipment inference remains PREDICTED. The audit found that explicit proposed/conditional construction language could previously qualify for CALL NOW. That weakness was reported before changing behavior; a conservative stage guard now keeps uncommitted work in WATCH. Existing priority, freshness, contractor, quality and equipment thresholds remain unchanged.

## Verification completed locally

- TypeScript frontend/backend checks: passed.
- Unit, API, collector, source admission, inference, duplicate, checkpoint, auth and watchdog contracts: 417 passed across 33 files.
- Schema/migration static validation: passed; 70 unique configured source IDs, two compiled candidates, six workflows and seven logical jobs.
- Workflow safety lint and the exact CI formatting checks: passed.
- Verification frontend build: passed.
- Local browser acceptance: 14 passed, including module navigation, provenance, source health, user isolation, report persistence/PDF, mobile forms and expired-session recovery.
- Actual production public browser/API/auth-boundary smoke: passed during rollout.
- Live authenticated-user browser journey: NOT VERIFIED; local coverage uses explicit synthetic test fixtures.

## Production rollout observations

The previous production snapshot was 1789467699311 and was several repository revisions behind. The last captured legacy backfill state, at 2026-09-18T01:08:34Z, reported 234305 processed rows and 48 of 57 sources completed. Its latest stored error was melbourne-building-permits: HTTP_400. These were stored legacy counters, not newly verified unique evidence totals.

The two native AppDeploy schedules were removed before GitHub production workflows were published. Legacy handlers now return RETIRED rather than creating a second writer. Repository-authored SVG assets and existing tested authentication/evidence UI dependencies were included to bring the production snapshot into agreement with the repository.

AppDeploy validation initially identified missing staged backfill interfaces and local SVG dependencies; both were supplied from the tested repository. Neither failure reset or reseeded production data.

## Live workflow results and remaining limitations

Snapshot 1789694012430 was deployed. Live OIDC and bounded legacy backfill indexing succeeded in run 35294648359; source health ran and reported three failed probes. Code acceptance passed on commit 5c0441516d6dc37f79e38eb296c7110966f0e657. Production API smoke passed at 2026-09-18T01:22:41Z, then the browser received HTTP 402 at 01:23:04Z. Subsequent production jobs failed with the same hosting response. Stored checkpoints and remaining source failures cannot currently be inspected through the blocked API. See the incident report for links and recovery limits.

There are no intentionally missing long-lived secrets. Runtime requirements are Actions enabled, workflow contents/id-token permissions, public provider access and AppDeploy database capacity. Provider outages and unsupported/changed legacy schemas must remain visible failures rather than being bypassed.

## Files

Created: six files under .github/workflows; backend automation-api/auth/probes/state and source-automation/admission/discovery modules; automation runner/safety/schema scripts; automation browser configuration and smoke; focused automation test suites; architecture/operations/GitHub Actions documentation and implementation plan.

Modified: backend index, intelligence, backfill, backfill-fetch and archive-storage; necessary archive/observability regression expectations; package scripts; README; cron.json. Unrelated uncommitted luxury landing-page mockups were excluded from this automation commit.

The native deployment also includes previously committed repository hardening dependencies that were absent from the old remote snapshot. It reuses the existing app and database.
