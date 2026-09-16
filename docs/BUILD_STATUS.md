# Local build status — 16 September 2026

## Historical evidence continuation — latest results

Archived evidence now feeds the operational dashboard and CRM through a shared bounded view. Checked checkpoints, pinned provider context, byte-limited archive writes and coverage disclosures are implemented. Verification: **70 unit tests pass; 92 browser tests pass and 1 fails** for the existing corrupt homepage artwork. TypeScript, 24 static checks, 21 original hashes and the verification build pass; the 15-page PDF retains all tested content within margins. No deployment or live mutation occurred. See [continuation results and limitations](audit/HISTORICAL_EVIDENCE_PROGRESS.md). The sections below retain earlier integration/audit evidence.


## Full-site audit supersedes the initial counts below

The subsequent 16 September audit ran all 21 pages: 52 unit/API tests pass; 88 of 89 browser tests pass, with the corrupt approved homepage image still failing. Frontend/backend type checks, 24 static checks, 21 original checksums and the verification build pass. The dependency scan reports zero known advisories. The live site remains on the older unprotected version. See [the full audit](audit/2026-09-16-SITE_AUDIT.md) for final evidence, feed results and release blockers. The following original integration results are retained as history.

## Integrated changes

The supplied [repair matrix](../hardening/docs/MASTER_REPAIR_PLAN.md) is applied to the exact baseline. It adds authenticated operational access, scoped CRM/report history, bounded pagination, evidence-based prioritisation, provenance-aware reports, unique-project map statistics, demo/contact forms and truthful public labels.

Further issues reproduced and repaired during integration:

- The patch script renamed the same string twice and stopped midway. The wrapper validates the exact baseline and completes integration in a temporary directory first.
- Full localities now distinguish otherwise identical project names; input order and long title prefixes no longer change or overwrite groups.
- Snapshot reuse reserves canonical keys for direct matches and checks emitted keys as well as database row IDs, preventing duplicate IDs when groups split. A title-only change can retain a previous identity through source evidence.
- Source freshness uses validated source dates, not collection time, future expiry fields or ambiguous spreadsheet numbers.
- Only explicit named delivery roles populate delivery contractors; generic organisations and contractor counts cannot do so.
- Dashboard reads no longer start backfill/ingestion.
- Report history loads from the signed-in account's API. Shared browser storage is no longer a fallback. Save success is displayed only after server confirmation; failures are visible.
- Authentication restoration/sign-out failures are handled, and the mobile sign-in panel fits its container.

## Verification

| Check | Result and scope |
| --- | --- |
| Handoff integrity | All 21 SHA-256 entries match the supplied archive. |
| Static audit | 24/24 checks pass; baseline had 23 failures. Static checks alone do not prove runtime behavior. |
| TypeScript | Frontend and backend pass with documented platform SDK declarations. |
| Unit/API tests | 16 tests pass on the maintained root implementation. The platform SDK boundary is mocked. |
| Browser workflows | 5 Playwright tests pass in Chrome with isolated test fixtures, including desktop and 375px mobile flows. |
| Verification build | Vite succeeds with the explicit test configuration. Production runtime resolution remains unavailable locally. |
| Focused review | Independent review reproductions are fixed, including split-group IDs and duplicate snapshot keys; no remaining P1/P2 issue identified within that focused review. |

Browser coverage includes five public navigation pages, all 12 operational modules, sign-in gating, project provenance, unique mapped-project counts, map filtering, CRM validation, report preview/save/reload, a downloaded PDF, account switching, report API failures, demo validation, footer pages and expired-session recovery. Report and CRM fixtures are explicitly synthetic and exist only under `tests/`.

Browser output is written to the ignored `test-results/` directory, including `browser-results.json`, the downloaded QA PDF and a mobile screenshot. Vite reports a bundle-size warning (main JavaScript approximately 885 KB before gzip); code splitting remains a performance follow-up.

## Still requiring the real platform

- Successful production build with the actual AppDeploy client runtime.
- Provider sign-in, token expiry/revocation and anonymous API denial enforced by the real SDK.
- Actual database persistence and two-account data isolation under deployed authentication.
- Live source availability, provenance, scheduled ingestion/backfill and degraded-source recovery.
- Staging acceptance and authorised deployment. No changes have been pushed or deployed.

The supplied Privacy/Terms text still requires the business owner's final review. This local verification is not a claim that all production behavior or every external source has been validated.
