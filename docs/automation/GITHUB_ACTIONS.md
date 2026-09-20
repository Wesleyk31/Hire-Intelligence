# Production automation in GitHub Actions

GitHub Actions schedules the work. The AppDeploy backend and its production database own source status, validation results, checkpoints, evidence and execution history. Closing Codex does not stop these GitHub schedules.

| Workflow            | UTC schedule                                                             | Work per run                                                                                                   |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Live Source Refresh | Every two hours at minute 03                                             | Backend selects at most three admitted live sources                                                            |
| Source Health       | Daily at 01:11                                                           | Sequential probes of every ACTIVE or DEGRADED registry source; aggregate result persisted                      |
| Historical Backfill | Every six hours at minute 07                                             | One bounded source page from its stored checkpoint                                                             |
| Source Validation   | 02:41 daily                                                              | Validate the controlled candidate catalog; no arbitrary URL discovery or automatic admission without all gates |
| Production QA       | Main pushes, PRs, successful eligible deployment events, and 00:26/12:26 | Local acceptance; trusted main runs also check production APIs and public browser behavior                     |
| Workflow Watchdog   | Every six hours at minute 39                                             | Read GitHub's actual latest 100 main-branch runs for the five workflows above and persist observations         |

The user selected economy mode on 20 September 2026. This configures 24 scheduled workflow runs per day, down from 269; manual and event-triggered runs are additional. Backend and watchdog cadence thresholds match these schedules. This reduces requests but is not a measured guarantee of staying within AppDeploy's allowance; a full source scan still probes every eligible source.

Every workflow also supports manual dispatch. GitHub schedules execute the default branch and are best effort: delayed, dropped, disabled, or missing runs are operational problems. The watchdog cannot detect its own scheduler stopping; inspect its GitHub badge/run history or monitor the stored watchdog timestamp externally for that failure mode. GitHub may disable schedules after repository inactivity; restore them in the Actions tab if needed. See [GitHub schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Authentication and permissions

No stored production API credential is needed. Production jobs request a short-lived GitHub OIDC token with audience `hirer-intelligence-production` using the runner-provided `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, then send it only as `X-Hirer-Automation-Token`. Tokens are never written to files, outputs, logs, or browser contexts. They are refreshed for each authenticated request.

The backend verifies GitHub's JWT signature, issuer, audience, expiry, repository `Wesleyk31/Hire-Intelligence`, repository ID `1371025079`, owner identity, `refs/heads/main`, and the allowlisted workflow file identity. It accepts the explicitly verified legacy and immutable repository subject formats. Workflows deliberately do not declare a GitHub environment, which would change the OIDC subject. Repository variables cannot select arbitrary production URLs.

All workflows start with `permissions: {}`. Production jobs grant `contents: read` and `id-token: write`; the watchdog additionally grants `actions: read` and receives the ephemeral `GITHUB_TOKEN`. Checkout disables persisted git credentials. Pull requests receive no OIDC permission and never run production mutation/report steps. Third-party actions are pinned to immutable commits verified against their official GitHub repositories.

No `DATABASE_URL`, deployment token, source API key, or shared API secret belongs in these workflow files. Any future credentialed source must be admitted and configured in the backend's secret store first. These workflows collect only from already configured production sources. Missing GitHub OIDC or Actions permissions cause a failed run.

## Endpoints and trust boundaries

- Public frontend: `https://hirer-intelligence-mfj58p.v2.appdeploy.ai`.
- API base: `https://api-v2.appdeploy.ai/app/hirer-intelligence-mfj58p`.
- `GET /api/automation/health`: stored machine-readable operational summary.
- `GET /api/automation/registry`: persisted source IDs and states for health probes.
- `POST /api/automation/run`: bounded work, identified by job, optional source key, GitHub run ID, attempt and commit SHA.
- `POST /api/automation/report`: source-health aggregate, QA, E2E and watchdog outcomes.
- `GET /api/automation/smoke`: authenticated, bounded real source/opportunity/evidence samples and coverage disclosure.
- `GET /api/public/summary`: anonymous production API availability and schema.

The public frontend serves the SPA shell at unknown paths, including `/api/...`; do not use that origin for API health. The runner rejects non-JSON responses even when HTTP status is 200. It follows no redirects when sending credentials.

## Production enable control

All six production jobs require repository variable `HI_PRODUCTION_AUTOMATION_ENABLED` to be exactly `true`. Missing or false means skipped, including manual dispatch. PR/main acceptance remains available while production is paused. The workflow summary states when a passing code check excludes production. For a prolonged incident, disable the five production-only workflows to prevent empty scheduled runs, and retain `deployment-qa.yml` for code checks. See the hosting outage recovery procedure in OPERATIONS.md. The schedules below are configured cadence, not a claim that paused jobs are executing.

## Failure and concurrency behavior

Every job has a timeout. Every production job that can mutate stored state uses `hirer-production-automation` with `cancel-in-progress: false` and `queue: max`, including QA reports and watchdog reports. The shared group runs one writer at a time and retains up to 100 pending jobs; arrivals beyond that limit are canceled. This prevents ordinary scheduled arrivals from replacing one another while a health scan runs. See [GitHub concurrency queue behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency#example-queueing-multiple-pending-runs). Backend jobs remain bounded; queue overflow, canceled, stale and missing runs still need attention. Concurrency does not provide transactional database guarantees; checkpoint commits and idempotency remain backend responsibilities.

The runner does not retry mutations after a timeout or HTTP failure, because the backend may already have processed the request. Backend retry policy controls source requests. HTTP failures, malformed JSON, invalid response schemas, failed/degraded/unknown job statuses and report-persistence failures exit nonzero. A completed historical source returns `COMPLETE` without resetting its checkpoint. Health probes continue through isolated source failures, then persist and fail the aggregate run. A registry with no eligible sources is an explicit failed health check, not manufactured success.

Health scans start with sources whose last check is unknown, then oldest checked first. After an interrupted run, the next daily scan therefore gives unchecked or older sources priority. Successful production smoke output includes a compact snapshot of stored source counts, unobserved-source count, rollout backfill metrics, redacted source/job failure reasons and job statuses/timestamps. It omits raw source records, evidence, arbitrary report details and cursor tokens; unknown metrics remain null. Local browser acceptance excludes the production smoke test; production smoke requires explicit selection.

The watchdog records raw GitHub run metadata, last observed success, consecutive failures in its bounded run-history window, expected frequency, and a classification. Missing runs are STALE. Recent completed failures are FAILED. Running work without a recent successful history or with unresolved failures is DEGRADED. A run older than twice its cadence plus ten minutes is STALE. API observation failures are FAILED, never success. The backend independently validates observations before storing health.

Candidate validation has a different success criterion from admitted-source health: successful execution means the current probes and their admission decisions were completed and persisted. An unsuitable candidate can correctly remain `REVIEW_REQUIRED`, with parser `FAIL` and collection blocked, while the validation job succeeds. Its output explicitly reports `VALIDATION_EXECUTION_AND_PERSISTED_DECISIONS`, current execution outcomes, held candidates and zero activations. Failed retrieval/access, thrown probes, failed discovery, failed persistence and candidates that were not actually probed still fail the job. A green validation workflow never grants admission.

## What QA proves

PR and main acceptance checks run targeted automation safety lint, Prettier parsing/format checks, both TypeScript projects, all Vitest unit and collector contracts, schema/migration checks, a frontend verification build using the isolated SDK adapter, and Chromium browser tests against synthetic fixtures. The private AppDeploy SDK is supplied by AppDeploy's deployment environment, so the GitHub verification build does not claim to reproduce the native production build. Selected local browser suites cover workspace navigation, opportunities, evidence display, source health/diagnostics, and held evidence. Those fixtures are not claims about production source availability.

Trusted main production checks use the real API and real anonymous browser session. They check health version/schema, public summary, bounded opportunities and evidence references, PREDICTED labels, backend error indicators, the home page, frontend runtime errors and the authentication boundary. They do not impersonate an authenticated user. Production authenticated workspace browser testing is NOT VERIFIED without a real, authorized browser identity; actual stored opportunity and evidence loading is checked through the restricted OIDC smoke API instead. Empty stored opportunity data is reported as `EMPTY` with zero observed rows, rather than populated with fixtures.

QA and E2E reports store each step's actual outcome. A failed or skipped acceptance check cannot become a successful deployment QA report. Browser traces and screenshots are retained as Actions artifacts for seven days on failed tests. The README badges show the latest GitHub workflow conclusion, which is distinct from the detailed stored source and evidence health.

## Deployment and operations

Merging/pushing these files to the default `main` branch makes GitHub schedules available when the workflows are enabled and repository Actions permissions allow them. Production jobs additionally require `HI_PRODUCTION_AUTOMATION_ENABLED=true`. The backend must also be deployed through the existing native AppDeploy deployment tooling. A GitHub push does not deploy AppDeploy automatically; this repository contains no fabricated deployment token or unsupported deployment API invocation.

The `deployment_status` hook runs when an actual successful GitHub deployment event names `main`. AppDeploy may not emit this GitHub event, so main-push checks and the six-hour canary remain independent triggers. Dispatch Production QA after the AppDeploy deployment to verify the new backend is actually present. During deployment order transitions the API version check should fail until the production automation routes are deployed.

Useful manual commands inside an authorized main-branch GitHub job:

```sh
node scripts/automation/runner.mjs source-health
node scripts/automation/runner.mjs historical-backfill
node scripts/automation/runner.mjs live-refresh
node scripts/automation/runner.mjs source-validation
node scripts/automation/runner.mjs production-smoke
node scripts/automation/runner.mjs watchdog
```

Local verification requires no production credential:

```sh
pnpm test
node scripts/automation/check-workflows.mjs
node scripts/check-automation-schema.mjs
pnpm exec playwright install chromium
pnpm exec playwright test --config playwright.automation.config.ts
```

The automation Playwright configuration defaults to downloaded Chromium, so GitHub does not depend on a preinstalled Chrome channel. A local `PLAYWRIGHT_CHANNEL=chrome` override can use an existing Chrome installation. Production browser smoke can run with `HI_SMOKE_TARGET=production`; this makes only anonymous read requests.

Action pin sources verified during implementation: [checkout v4](https://api.github.com/repos/actions/checkout/git/ref/tags/v4), [setup-node v4](https://api.github.com/repos/actions/setup-node/git/ref/tags/v4), [pnpm action v4](https://api.github.com/repos/pnpm/action-setup/git/ref/tags/v4), [upload-artifact v4](https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v4). Re-verify official release commits when upgrading pins.
