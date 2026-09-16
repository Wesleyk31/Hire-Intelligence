# Hire Intelligence Commercial Intelligence Wave Design

## Goal
Move Hire Intelligence from broad public-feed aggregation toward a commercially useful, evidence-governed equipment-rental intelligence engine that identifies project movement, contractor involvement, likely equipment classes, timing and BDM priority without fabricating observed facts.

## Scope
1. Expand lawful machine-readable Australian feeds in mining, resources, energy, infrastructure, approvals, tenders, development, maintenance and shutdown-adjacent signals.
2. Keep broken collectors deferred until technically verified; never fabricate source records.
3. Continue bounded checkpointed historical backfill and expose processed/completed progress.
4. Detect evidence-backed project-stage transitions from observations over time.
5. Match contractors only when directly supported by public evidence; otherwise label verification required.
6. Generate equipment-demand predictions from work type and sector with an explicit PREDICTED label and confidence/explanation.
7. Compute a BDM Priority score from freshness, stage, source confidence, contractor evidence, equipment relevance and timing; CALL NOW remains zero unless a separate explicit evidence gate is satisfied.
8. Support a real pilot workflow for human-recorded outcomes. Never fabricate calls, contacts, quote values, won values or outcomes.

## Architecture
Keep the existing source registry and bounded collectors, but add a deterministic intelligence layer over persisted opportunity observations. A compact per-project canonical model groups source observations, derives current stage and stage-change evidence, contractor evidence, predicted equipment classes and BDM priority. Historical backfill remains isolated from live opportunity promotion where a source represents completed/historical work.

## Data governance
- Every source must retain owner, licence, endpoint and provenance URL.
- Only verified GREEN sources run in live refresh.
- Deferred sources remain visible with failure reason and provenance.
- Historical-only sources may calibrate patterns but must not become current CALL NOW opportunities.
- Equipment inference is always labelled PREDICTED and is never stored or displayed as an observed hire requirement.
- Contractor names are only attached when present in evidence.
- CALL NOW remains evidence-gated and defaults to zero.
- Commercial values come only from published evidence or human-entered measured outcomes.

## Stage model
Canonical stages: WATCH, APPROVAL, PROCUREMENT, AWARDED, MOBILISATION, CONSTRUCTION, MAINTENANCE, SHUTDOWN, COMPLETE. Stage changes require a new observation with a higher-confidence stage signal than the previously stored observation. The UI shows the transition and the evidence source/date.

## Equipment prediction
Map work-type evidence to broad rental classes such as excavators, loaders, graders, rollers, telehandlers, access equipment, generators, lighting towers, pumps/dewatering, cranes/material handling and support fleet. Prediction output includes confidence and a short deterministic reason based on observed work type/sector keywords.

## BDM Priority
Score 0-100 using: freshness 25, stage/timing 25, contractor evidence 15, equipment relevance 15, source confidence 10 and corroboration 10. Priority bands: 80-100 HIGH, 60-79 MEDIUM, below 60 WATCH. This score does not itself create CALL NOW.

## Pilot workflow
Human users may record CONTACTED, REQUIREMENT_CONFIRMED, QUOTED, WON, LOST or FALSE_POSITIVE outcomes. QA-marked records remain excluded from commercial metrics. No automated process creates or modifies real outcomes.

## Success criteria
- Live refresh and historical backfill remain scheduler-healthy or clearly surface failures.
- Source Admin reports live, deferred and historical sources distinctly.
- Opportunities show provenance, derived stage, stage-change evidence, contractor evidence state, PREDICTED equipment demand and BDM Priority.
- No fabricated contacts/outcomes/requirements/values.
- Deployment QA has no frontend/network/backend errors.
