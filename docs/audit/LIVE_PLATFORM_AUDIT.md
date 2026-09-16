# Live deployment audit — 16 September 2026

Read-only checks against the existing AppDeploy deployment. This is the older deployed baseline; the repaired local branch has not been deployed.

## Release blocker: anonymous operational access

A fresh Chrome context opened the public homepage and requested `https://api-v2.appdeploy.ai/app/hirer-intelligence-mfj58p/api/dashboard` without signing in. The API returned HTTP 200 with `projects`, `opportunities`, `commercial`, `pilot`, `sources` and `backfill`. All 12 operational module pages were subsequently reachable anonymously. The unauthenticated CRM outcome GET also returned HTTP 200 (no outcome records were printed or retained).

The local code uses SDK `requireAuth()` for these operational routes and an aggregate-only public summary, but that correction is not present in the deployed version. Staging validation and release of the repaired branch are the first next-scope priority.

## All 21 deployed pages opened

The nine public pages (Home, Products, Solutions, Industries, Insights, About, Contact, Privacy, Terms) and 12 internal modules rendered visible main content with their expected headings. No JavaScript page errors occurred during this read-only navigation. See [navigation evidence](LIVE_PAGE_NAVIGATION.json).

This proves navigation/rendering, not that the old deployment's forms, authentication, persistence, exports or business rules are correct. No public demo/contact submissions, CRM writes, deployments or data deletions were performed.

## Stored feed and scheduler state

At 01:17 UTC (09:17 Perth), the live dashboard reported 53 enabled sources, 51 SUCCESS, and two DEGRADED sources: Queensland granted resource authorities and Stadiums Queensland July–December 2025 contracts. Both had zero rows. The dashboard still returned the old 50-project window.

The AppDeploy status response reported both cron jobs enabled and last runs successful: historical backfill at 01:05:17 UTC and live refresh at 00:20:11 UTC. Cron success does not establish that every feed succeeded. The platform reported no recent frontend/backend errors, and `e2e_tests` was null. Its screenshot QA timestamp was 15 September 10:22:16 UTC.

Direct requests to `/api/...` on the website hostname return the HTML application shell; the actual SDK API uses `api-v2.appdeploy.ai/app/<app-id>/api/...`. Health checks were evaluated on the observed API host rather than counting HTML HTTP 200 as API success.

`GET /api/public/summary` and `GET /api/reports/history` returned 404 on the deployed API, confirming that the new public-summary and report-history pathways are not released. See [API check evidence](LIVE_PLATFORM_CHECK.json).

## Remaining live checks

After the real runtime is provisioned and the repaired application is staged: verify anonymous API denial, identity-provider sign-in/expiry/sign-out, two-account CRM/report isolation, real database persistence, and scheduled collector behavior. Fixture-backed local tests cannot establish those platform behaviors.