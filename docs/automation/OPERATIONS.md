# Production cutover and recovery

The workflow implementation and a live production rollout are separate milestones. The AppDeploy deployment must contain the restricted automation routes before GitHub production jobs can succeed. A local test pass or green fixture build does not verify that deployment.

## Hosting outage pause and recovery

Repository variable `HI_PRODUCTION_AUTOMATION_ENABLED` must equal the literal `true` before **any** of the six production jobs can run, including manual dispatch. Missing, false or other values keep production jobs skipped. Set it to `false` under Settings > Secrets and variables > Actions > Variables to pause future production jobs. Also disable the five production-only workflows during a prolonged incident; this prevents empty scheduled runs. Keep `deployment-qa.yml` enabled for PR/main code acceptance. Running jobs are not interrupted by a variable change: inspect and allow an in-flight writer to finish before intervening in persisted state.

The 19 September hosting incident and the 20 September recovery have separate evidence records: see [the incident](INCIDENT_2026-09-19.md) and [current recovery results](RECOVERY_2026-09-20.md). Native AppDeploy crons remain removed. Code checks and fixture browser tests can run independently; the workflow summary explicitly discloses skipped production checks during a pause. A pause is not a successful source-health observation and does not update the production database.

Recovery must verify service restoration rather than assume a reset time guarantees it:

1. After the provider's limit reset or confirmed capacity restoration, run `node scripts/automation/runner.mjs platform-check`. This sends one public request, requires no GitHub credentials, and does not touch the database. It must exit zero with `AVAILABLE` and the expected backend version. A deployment marked ready is not sufficient.
2. Retain the user-selected economy schedules in GITHUB_ACTIONS.md. The provider reported a 100-credit free daily allowance and a 14-credit deployment minimum. Per-operation costs were not exposed; no safe sustained ingestion rate has been measured. Do not restore the old high-frequency schedules or assume a daily reset alone makes that workload sustainable.
3. Keep the five production-only workflows disabled, set the variable to `true`, and manually dispatch `deployment-qa.yml` on main. Verify the real API/browser and report writes. If they fail, restore the variable to `false` and diagnose the exact failure. Code acceptance alone is insufficient.
4. Re-enable and dispatch the production workflows individually after capacity and source issues are resolved; check persisted receipts and last-success timestamps. Re-enable the watchdog after the monitored jobs have completed. Existing failed runs remain available as incident evidence. Do not reset cursors, reseed evidence, or turn native crons back on.

Each runner checks the lightweight host endpoint before accessing production state. HTTP 402 with `APP_TEMPORARILY_UNAVAILABLE` stops a source scan immediately; it does not issue a failure write to the same unavailable host. Ordinary source failures still continue through the scan, persist the aggregate, and fail with bounded, redacted source diagnostics. This is per-run protection, not automatic global re-enablement or a hosting quota bypass.

## Cutover sequence

1. Run `pnpm typecheck`, `pnpm test`, `pnpm automation:check-schema`, the automation formatting/safety checks and `pnpm test:browser:automation`. The schema check is read-only static analysis; it must not be described as a live database migration.
2. Keep the new GitHub production mutation workflows disabled while the native platform writers are being replaced. Capture the existing AppDeploy cron configuration and stored checkpoint/health snapshot for the rollout record. Do not clear or reseed data.
3. Deploy through the native AppDeploy tooling with the new backend and an explicitly empty native cron configuration. Remove the existing `hirer-live-refresh-incremental` and `hirer-history-backfill` crons; verify the deployed platform configuration, not merely the local `cron.json`. Allow any already executing native run to finish before GitHub mutations begin.
4. Put the reviewed workflow files on the repository's default `main` branch and enable them. Their production guard requires the exact repository and `refs/heads/main`; dispatching on a feature branch does not authorize a production operation. Confirm Actions permissions allow short-lived OIDC tokens and watchdog Actions reads. No shared production API secret needs to be installed.
5. Dispatch Source Health, Source Validation and Historical Backfill through GitHub. The shared group serializes production writers. Observe their stored receipts and actual workflow conclusions. The first backfill runs can perform bounded legacy indexing with zero new source evidence until migration completes.
6. Dispatch Production QA after deployment. Verify `/api/automation/health` reports the intended automation version, API checks succeed, public browser smoke succeeds, and QA/E2E reports identify the actual commit/run. Check the independent watchdog after the monitored workflows have run at least once; missing initial runs must remain STALE.
7. Record the commit, deployment version, actual run links, source health and checkpoint observations in the completion report. If a step is unavailable or fails, report NOT VERIFIED or FAILED and the exact limitation. Do not substitute fixture results for production results.

GitHub controls run scheduling even when Codex is closed. It does not guarantee a precise start time. Shared concurrency serializes running writers; `queue: max` retains up to 100 pending jobs without canceling the running writer. Additional arrivals are canceled when that bounded queue is full. Keep backend work bounded, inspect queue buildup and canceled runs, and watch stored last-success timestamps. See [GitHub's queue limits](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency#example-queueing-multiple-pending-runs).

## Monitoring and interpretation

Use the machine-readable production health summary and the Actions run pages together. The summary contains stored source counts/states, source failures, live refresh/backfill timestamps, acknowledged rollout metrics, completed/remaining sources, QA/E2E results and workflow observations. It is not a synthetic uptime dashboard.

- ACTIVE describes an admitted/configured source. Read its individual checks and last success before claiming healthy data.
- DEGRADED can indicate repeated retrieval errors, stale observations or a structural hold. Check `collection_blocked`, `collection_hold_reason` and the exact failure.
- REVIEW_REQUIRED blocks collection when access, legal metadata or candidate requirements need review. Never bypass authentication, licences or subscription restrictions to clear it.
- NOT_VERIFIED is meaningful information. Unknown publication dates, freshness windows, parser/pagination checks and pre-rollout unique totals must remain unknown.
- A successful empty bounded smoke response reports `EMPTY`; it proves response handling, not the presence of opportunities.
- QA checks real production APIs and the anonymous public/authentication boundary. Authenticated workspace browser behavior is covered locally with synthetic fixtures and remains NOT VERIFIED in production without an authorized real browser identity.

## Failure handling

| Observation                                                         | Required response                                                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source HTTP or transient transport failure                          | Inspect stored failure and retry count. Let the bounded retry policy apply; previous checkpoint remains authoritative.                                                   |
| Schema/parser/pagination change                                     | Keep the hold, inspect original response and approved parser contract, then review and test an adapter change. Do not replace the source with an unrelated feed.         |
| Licence/access/authentication change                                | Keep REVIEW_REQUIRED and collection blocked until lawful access and approved configuration are documented.                                                               |
| Database quota or persistence acknowledgement failure               | Stop further manual writes, inspect platform capacity and the receipt/journal, and reconcile stored state before retrying.                                               |
| RUNNING automation receipt or WRITING archive journal after failure | Treat the operation as possibly applied. Inspect the stored receipt, batch and evidence identities; do not delete the receipt or reset the cursor to make a rerun green. |
| Multiple rows in a logical singleton table                          | Investigate concurrent writers. Preserve evidence; reconcile deliberately under a single writer.                                                                         |
| Missing or stale scheduled workflow                                 | Inspect Actions enablement, default branch, permissions, cancellation, timing and errors. Missing runs are not success.                                                  |
| Watchdog itself stops                                               | Inspect its GitHub runs and stored report timestamp, or use an external monitor. A GitHub-only watchdog cannot detect an outage that prevents itself from running.       |
| QA fails after a main push but before AppDeploy release             | Verify the deployment order. Deploy the reviewed native backend, then dispatch QA again; keep the earlier failure visible.                                               |

For source admission, update the compiled candidate/adapter and legal-review evidence through a reviewed repository change. There is no arbitrary-URL admission API and no API flag that makes an unreviewed candidate lawful. Keep provenance and inferred equipment labels intact throughout troubleshooting.

## Rollback and manual work

Disable GitHub production mutation workflows and wait for running jobs to finish before any manual reconciliation or deployment rollback. Keep all evidence, cursors, run receipts and migration markers. Do not restore old cron writers while the GitHub writers are enabled. A rollback must preserve the schema's compatibility and journal interpretation; unsupported schema versions intentionally fail closed.

Never reset checkpoints or delete indexes as a routine recovery step. Any deliberate reset requires a documented reason, a scope limited to the affected source, retained original state and reconciliation of already stored evidence. The shipped automation contains no reset, wipe or reseed workflow.
