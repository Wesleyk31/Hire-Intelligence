# Persistent production automation implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to execute the independently testable tasks below. The user explicitly requests autonomous implementation, tests, commit and GitHub push.

**Goal:** Run source health, bounded historical ingestion, controlled admission and QA continuously through GitHub Actions with authoritative state retained in the existing production database.

**Architecture:** Extend the existing AppDeploy React/Vite/TypeScript backend and managed key-value database. GitHub Actions calls tightly scoped backend operations with verified GitHub OIDC tokens. Existing collectors, source IDs, archive/checkpoint tables and evidence gating remain in use. No SQL database or new synthetic dataset is introduced.

**Spec:** User-supplied production automation request, 18 September 2026 (requirements 1–20); implementation and acceptance details recorded in `docs/automation/`.

## Existing architecture and constraints

- `backend/index.ts`: compiled live/historical source registry, collectors, bounded refresh, protected dashboard/evidence APIs and public summary.
- `backend/backfill.ts`, `backfill-fetch.ts`, `archive-storage.ts`: persisted source cursors, provider resource/window pinning, byte-bounded evidence pages and pull receipts. Existing uncertain append replay needs stronger duplicate protection.
- `source-helpers.ts`, `source-pilots.ts`, `source-contracts.ts`, `registry-contracts.ts`: parser checks, reviewed pilot metadata and unreviewed legacy rights labels. No candidate is authorized merely by usefulness.
- `domain-hardening.ts`: CALL NOW requires a ready stage, named delivery contractor with confidence >=70, equipment class with confidence >=55, BDM priority >=80, quality A/B, freshness >=65, and no promotion hold. Retain these approved conditions and test negative cases. Inference remains PREDICTED.
- AppDeploy injects private SDK runtime. Local unit/API tests replace only that boundary; verification frontend builds are not production deployments.
- Production has two existing AppDeploy crons; HTTP 200 can currently conceal a degraded source result. GitHub runners must inspect semantic status and return nonzero on failure.
- Database SDK supports auto-ID CRUD only, no transactions, unique keys or compare-and-swap. All ingestion writers must therefore be serialized through one GitHub concurrency group after cutover. Never claim unsupported exactly-once semantics.
- Database limits: 256 KiB per row, 1 MiB per call, 500 items, bounded reads; never retry AppDatabaseQuotaExceeded.
- Preserve existing production data/checkpoints and unrelated local landing mockups. No fabricated counters, contacts, outcomes, commercial values or verification claims.

## Tasks

- [ ] Source registry/health/admission: durable per-source records, safe failure classification, bounded probes, compiled authoritative candidate catalog, fail-closed activation; tests for schema/auth/licence/freshness and isolation.
- [ ] Backfill: current-run metrics, checkpoint safety, bounded additive legacy indexing and duplicate journals, uncertain-write holds, provenance preservation; regression tests.
- [ ] Backend automation: GitHub OIDC trust bound to repository ID, owner ID, main ref, approved workflow and operation; durable run/job records; migration version; machine-readable production health and smoke endpoints; tests for auth, replay, stale/missing/failed jobs.
- [ ] GitHub workflows: staggered live refresh, hourly health, 15-minute backfill, daily candidate validation, PR/main/deployment QA, independent watchdog and browser smoke. Timeouts, manual dispatch, shared writer concurrency and nonzero acceptance failures.
- [ ] Verification: baseline suite (254 tests passed), new targeted tests, full unit/API suite, typecheck, structural lint, schema/migration assertions, local browser smoke, production read checks and deployment QA where available.
- [ ] Rollout: commit exact code, push repository, deploy only tested changed application files, cut over platform crons without competing writers, verify real GitHub runs and stored production status. Report any missing permission/runtime capability explicitly rather than marking unverified work successful.

## Deployment preflight

- [ ] Inspect exact current AppDeploy snapshot and deploy only changed files; use anchored diffs where safe.
- [ ] Match existing frontend+backend architecture; retain SDK router and private runtime injection.
- [ ] Internal automation routes are intentionally excluded from user-facing E2E and directly covered by API/auth tests; preserve existing user test contract.
- [ ] No secret values in source, logs, tool payloads or workflow files. OIDC avoids a long-lived production API token.
- [ ] No old cron and GitHub writer overlap; check actual platform cron state at cutover.
- [ ] Review terminal deployment, E2E and runtime error status; retain rollback version and report NOT VERIFIED wherever runtime proof is absent.
