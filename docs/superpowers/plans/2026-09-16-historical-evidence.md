# Historical Evidence Integration Implementation Plan

> For agentic workers: execute inline using the executing-plans and test-driven-development skills; keep changes in the user-requested Hire Intelligence folder on the existing codex branch.

**Goal:** Make archived evidence visible in operational pages and CRM, with bounded reads and replay-safe visible results.
**Architecture:** Shared read model over current and archived evidence; append-only size-bounded archive writes with acknowledged checkpoints.
**Tech Stack:** TypeScript, React, AppDeploy SDK boundary, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-09-16-historical-evidence-design.md

## Constraints
No live mutations, feed activation, push or deployment. Preserve original handoff. Do not claim exactly-once persistence or full-archive coverage.

## Task 1 — shared evidence window
Files: create backend/evidence-store.ts; modify backend/index.ts; tests/unit/archive-ingestion.test.ts.
- [x] Write route-level failing tests: legacy archive-only project appears, duplicates count once, latest source revision wins, historical-only project accepts CRM, malformed rows are disclosed, window bounds are truthful.
- [x] Run pnpm exec vitest run tests/unit/archive-ingestion.test.ts; verify failures against the current implementation.
- [x] Implement loadEvidenceUniverse(): normalize archive rows conservatively, merge stable identities, return items and coverage. Use it in dashboard and CRM project lookup.
- [x] Run targeted tests and all unit tests; check frontend/backend TypeScript.

## Task 2 — safe archive checkpoints
Files: backend/backfill.ts, backend/backfill-fetch.ts, backend/source-helpers.ts; same regression file.
- [x] Write failures for oversized UTF-8 page splitting, rejected page/cursor/control writes, retry deduplication, pinned CKAN resource across failure and quota propagation.
- [x] Add prepareBackfillContext and persist it before collection. Split/check page writes by bytes. Check all state write results and propagate quota failures.
- [x] Verify each failure becomes green; re-run existing feed regression tests.

## Task 3 — coverage disclosure
Files: src/FunctionalApp.tsx, src/reporting.ts, tests/browser/archive-coverage.spec.ts.
- [x] Add failing browser checks for merged evidence counts, archive truncation and report data-window language.
- [x] Display current/archive counts, duplicate suppression and invalid archive rows in Source Admin; use current-and-archived wording in reports.
- [x] Run focused browser tests; full browser suite retains the known original-artwork failure.

## Task 4 — validation and delivery
- [x] Run typecheck, all unit tests, affected browser/PDF checks, static checks, verification build and handoff hashes.
- [x] Review diff for source-date leaks, silent checkpoint failures, unbounded reads, live mutations and duplicate inflation.
- [x] Update build/next-scope status with measured evidence and limitations. Save a local commit.

## Execution outcome

Completed locally on 16 September 2026. Added 18 archive regression tests and four browser checks, including a mobile navigation obstruction reproduced during visual QA. Fresh results: 70 unit tests pass; 92/93 browser tests pass, with the pre-existing corrupt approved homepage image remaining a documented release blocker. Types, static checks, handoff hashes, PDF bounds and verification build pass. [Delivery report](../../audit/HISTORICAL_EVIDENCE_PROGRESS.md) records coverage and storage limitations. Local commit saved after final diff review; no push or deployment.
