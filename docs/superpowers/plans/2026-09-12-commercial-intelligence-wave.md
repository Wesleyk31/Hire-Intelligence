# Hire Intelligence Commercial Intelligence Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing production feed system into a stronger evidence-governed rental-intelligence engine with stage changes, contractor evidence, predicted equipment demand, BDM priority and a real pilot framework.

**Architecture:** Extend the current backend source registry and normalization pipeline, persist compact observation metadata needed for stage comparison, derive canonical project intelligence deterministically in the dashboard API, and surface it through the existing React UI. Keep historical-only evidence separate from live promotion and preserve all provenance/licence labels.

**Tech Stack:** React + TypeScript + Vite frontend; AppDeploy router/database backend; scheduled cron collectors; public Australian CKAN/ArcGIS/WFS/JSON feeds.

**Spec:** `docs/superpowers/specs/2026-09-12-commercial-intelligence-wave-design.md`

## Global Constraints
- Never fabricate BDM outcomes, contacts, equipment requirements or commercial values.
- Equipment inference must remain explicitly PREDICTED.
- CALL NOW remains evidence-gated and defaults to zero.
- Add only feeds with verified lawful licensing, provenance and machine-readable access.
- Broken collectors must be repaired or deferred, not treated as successful.
- Historical backfill stays bounded and checkpointed.

---

### Task 1: Production source-health and feed expansion
**Files:** Modify `backend/index.ts`; modify `tests/tests.txt`.
**Produces:** Updated GREEN/deferred registry and successful bounded collectors.
- [ ] Verify scheduler health before changes.
- [ ] Research current lawful machine-readable high-value feeds.
- [ ] Add only sources with explicit licence/provenance and reliable API/CSV/JSON/ArcGIS/WFS access.
- [ ] Keep failed sources deferred with failure reason.
- [ ] Run production refresh and confirm no hard failures.

### Task 2: Historical backfill depth
**Files:** Modify `backend/index.ts` only when adding historical-only sources; preserve `backend/backfill.ts` checkpoint model.
**Produces:** Larger evidence history without live promotion.
- [ ] Add qualifying historical-only maintenance/project datasets.
- [ ] Confirm historical sources are excluded from live opportunity promotion.
- [ ] Confirm backfill cursor advances and scheduler remains healthy.

### Task 3: Deterministic stage intelligence
**Files:** Modify `backend/index.ts`; modify `tests/tests.txt`.
**Produces:** `stageLabel`, `stageConfidence`, `stageReason`, `stageChanged`, `stageEvidence` on canonical opportunities.
- [ ] Add keyword/source-class stage derivation.
- [ ] Compare current observation with prior persisted stage snapshot.
- [ ] Persist bounded per-project stage snapshot.
- [ ] Expose transition evidence in dashboard API.

### Task 4: Contractor evidence matching
**Files:** Modify `backend/index.ts`; modify `src/FunctionalApp.tsx`; modify `tests/tests.txt`.
**Produces:** Evidence-backed contractor state with explicit verification-required fallback.
- [ ] Use only observed supplier/holder/proponent/operator fields already normalized from source evidence.
- [ ] Aggregate contractor names across corroborating records.
- [ ] Never synthesize contacts or contractor identities.

### Task 5: Equipment prediction engine
**Files:** Modify `backend/index.ts`; modify `src/FunctionalApp.tsx`; modify `tests/tests.txt`.
**Produces:** PREDICTED equipment classes, confidence and reason.
- [ ] Map observed work/sector terms to broad equipment classes.
- [ ] Return confidence and reason.
- [ ] Keep all UI labels explicit that predictions are not observed hire requirements.

### Task 6: BDM Priority score
**Files:** Modify `backend/index.ts`; modify `src/FunctionalApp.tsx`; modify `tests/tests.txt`.
**Produces:** 0-100 `bdmPriority`, band and factor explanation.
- [ ] Score freshness, stage/timing, contractor evidence, equipment relevance, source confidence and corroboration.
- [ ] Keep CALL NOW independent and evidence-gated.
- [ ] Sort Decision Desk by BDM Priority.

### Task 7: Pilot/outcome framework hardening
**Files:** Modify `backend/index.ts`; modify `src/FunctionalApp.tsx`; modify `tests/tests.txt` only if required.
**Produces:** Human-entered measured outcomes only, with QA exclusion retained.
- [ ] Preserve validation for quoted/won values.
- [ ] Show that no outcomes are auto-generated.
- [ ] Keep commercial metrics based only on non-QA human entries.

### Task 8: Deployment QA and verification
**Files:** No unrelated refactors.
**Produces:** Production-ready deployment.
- [ ] Deploy all changes.
- [ ] Confirm frontend/network/backend QA errors are zero.
- [ ] Confirm live refresh and backfill schedulers are healthy after a completed run or explicitly report remaining scheduler state.
- [ ] Report source additions, rejections/deferred sources, evidence/backfill progress if exposed, and what still requires real human BDM activity.
