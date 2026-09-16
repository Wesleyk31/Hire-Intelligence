# Hire Intelligence Production Hardening Bundle

Base: AppDeploy production snapshot `1789467699311`.

This bundle contains the engineering repair work for the 28-item audit. It is designed as an overlay on the current Hire Intelligence source tree.

## What is included

- `backend/domain-hardening.ts` — canonical project resolution, organisation-role separation, source-date handling, lifecycle recency, unique-project CRM funnel, CALL NOW gate, map de-duplication helpers and demo validation.
- `backend/data-access.ts` — bounded paginated reads with explicit truncation metadata.
- `backend/operations.ts` — validated demo-request persistence and authenticated user-scoped report history.
- `src/AuthGate.tsx` — secure workspace sign-in gate using AppDeploy auth.
- `src/DemoRequestForm.tsx` — real demo/contact form with validation and bot honeypot.
- `src/reporting.hardened.ts` — comprehensive executive PDF with CALL NOW, regional intelligence, source provenance, calibration and governance.
- `src/legal-content.ts` — substantive Privacy and Terms content for the public pages.
- `patches/apply_repairs.py` — deterministic integration overlay for the current AppDeploy source snapshot.
- `tests/domain-hardening.test.ts` — pure-domain red/green tests for the highest-risk analytical logic.
- `tests/tests.txt.replacement` — browser acceptance suite for AppDeploy/Codex QA.
- `tests/audit_static.py` — static regression guard against the specific failures found in the audit.
- `docs/MASTER_REPAIR_PLAN.md` — mapping of all audit items 1–28 to implementation changes.

## Apply to a source checkout

```bash
python patches/apply_repairs.py /path/to/Hire-Intelligence
```

Then run the project build and verification suite. The overlay deliberately fails when an expected base-snapshot anchor is missing rather than silently applying to the wrong code.

## Pure-domain verification already run in this workspace

```text
domain-hardening tests passed
```

The patch script itself also passes Python syntax validation.

## Required verification after applying to a complete checkout

```bash
npm install
npm run build
python tests/audit_static.py .
```

Then execute the browser acceptance suite in `tests/tests.txt` against desktop and mobile viewports.

## Important deployment state

The current AppDeploy account reached its 125/125 lifetime deploy limit before this hardening overlay could be applied to production. The code in this bundle is therefore a repaired source handoff, not a claim that the live URL already contains these changes.
