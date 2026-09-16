# Hirer Intelligence Deep Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build continuous checkpointed historical ingestion and a provenance-preserving evidence lake for the existing GREEN sources.

**Architecture:** Keep the existing live refresh path unchanged. Add a separate bounded backfill module with per-source cursors, evidence-page persistence, round-robin scheduling, manual execution and dashboard status.

**Tech Stack:** TypeScript, React/Vite, AppDeploy API/database/cron SDK, XLSX parser.

**Spec:** `docs/superpowers/specs/2026-09-11-deep-ingestion-design.md`

## Global Constraints
- One backfill source per invocation.
- Maximum 100 evidence events per batch.
- No unsupported CALL NOW promotion.
- Preserve provenance and EXPLICIT evidence labels.
- Keep all database reads and writes bounded.

### Task 1: Backfill acceptance workflow
**Files:** Modify `tests/tests.txt`.
- [ ] Extend Source Admin acceptance coverage to require historical-backfill status, evidence count and a manual bounded backfill action.
- [ ] Verify the existing application does not yet expose that workflow.

### Task 2: Checkpointed backfill engine
**Files:** Create `backend/backfill.ts`; modify `backend/index.ts`.
- [ ] Define source cursor, control and evidence-page records.
- [ ] Implement paginated batches for ArcGIS, CKAN datastore, OpenDataSoft and WFS.
- [ ] Implement backward date windows for AusTender.
- [ ] Implement bounded row-offset backfill for CKAN package XLSX/KML and project XLSX sources.
- [ ] Persist one evidence page before advancing the source cursor.
- [ ] Rotate to the next incomplete source after each successful or failed attempt.
- [ ] Expose `GET /api/backfill/status` and `POST /api/backfill/run`.

### Task 3: Continuous scheduling
**Files:** Modify `cron.json`.
- [ ] Retain hourly live refresh.
- [ ] Add a 15-minute historical backfill cron invoking one bounded source batch.

### Task 4: Source Admin visibility
**Files:** Modify `src/FunctionalApp.tsx`.
- [ ] Add backfill status to the dashboard response type.
- [ ] Show total historical evidence processed, completed sources, current/next source and last error.
- [ ] Add a manual Run backfill batch action and refresh dashboard state afterward.

### Task 5: Verification
- [ ] Deploy and wait for terminal status.
- [ ] Confirm frontend and backend error logs are empty.
- [ ] Confirm both cron jobs are enabled.
- [ ] Confirm Source Admin acceptance workflow is represented by the deployed test suite.
