# Production cutover and recovery

The workflow implementation and a live production rollout are separate milestones. The AppDeploy deployment must contain the restricted automation routes before GitHub production jobs can succeed. A local test pass or green fixture build does not verify that deployment.

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
