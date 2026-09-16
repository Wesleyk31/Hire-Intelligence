# Site and data audit implementation plan

> **For agentic workers:** Use systematic-debugging and test-driven-development for confirmed defects; use verification-before-completion before reporting results.

**Goal:** Execute every public and operational page, test data pathways and existing feeds, repair reproduced faults, research additional sources and define the next scope.
**Architecture:** Audit frontend flows, backend contracts, live feeds and source candidates as independent workstreams. Preserve the AppDeploy production boundary and original handoff material. Use fixture-backed browser tests for maintained local code and bounded read-only requests for external source health.
**Tech Stack:** React, TypeScript, Vitest, Playwright/Chrome, Vite, AppDeploy, official public data APIs.
**Spec:** User request of 16 September 2026: entire-site/pathway audit, every page, working feeds, more sources, next scope.

## Constraints
- Maintain the requested Hire Intelligence folder and existing development branch.
- Do not deploy, push or submit external demo/contact messages during an audit.
- Keep synthetic test data visibly separate from live evidence; preserve PREDICTED equipment labels.
- Record platform-only checks as unverified when real authentication or storage cannot be exercised.
- Treat source availability, parser correctness, freshness and scheduled ingestion as separate checks.

## Workstreams
- [x] UI: inventory and run all public pages and 12 internal modules, desktop/mobile, navigation, controls, forms, reports, errors and empty results; add regressions and repair reproduced frontend faults. Files: src/, tests/browser/, docs/audit/UI_AUDIT.md.
- [x] Backend: verify auth registration, scoped reads/writes, bounded pagination, normalisation, freshness, refresh/backfill resilience and reports. Add failure reproductions in tests/unit/ before editing backend/.
- [x] Feeds: probe every registry endpoint with bounded read-only requests, validate response shapes and collectors, record timestamped evidence in docs/audit/FEED_AUDIT*; fix confirmed collector faults and rerun affected probes.
- [x] Source research: verify incremental official feeds, licence/provenance, useful fields, availability and integration effort; record ranked candidates in docs/audit/NEW_SOURCE_RESEARCH.md.
- [x] Integration: run type checks, unit tests, browser suite, static audit and verification build; inspect changed files and preserve original handoff checksums.
- [x] Delivery: save an evidence-based audit report and next-scope priorities, mark live-platform limits explicitly, commit the verified local changes.
## Outcome

Audit workstreams completed. 52 unit tests pass; 88/89 browser cases pass. The remaining image decode failure is recorded as an open release blocker, along with live authentication/runtime and data architecture gaps. All 70 sources were probed; seven candidates researched. No deployment, push or live data mutation. See docs/audit/2026-09-16-SITE_AUDIT.md.
