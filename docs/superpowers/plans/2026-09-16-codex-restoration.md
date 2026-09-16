# Hire Intelligence restoration and hardening plan

Goal: Continue the supplied 28-item hardening programme in the requested Hire Intelligence folder.
Architecture: Restore AppDeploy snapshot 1789467699311, preserve it in Git, apply the supplied overlay, then repair verified failures. Keep platform SDK integration and the approved public design.
Tech stack: React 19, TypeScript, Vite 6, AppDeploy SDK, Leaflet, jsPDF, Python integration script.
Spec: CODEX_HANDOFF.md and hardening/docs/MASTER_REPAIR_PLAN.md.

## Constraints
- Equipment inference remains PREDICTED; CALL NOW requires evidence.
- No fabricated contacts, outcomes, values or source data.
- Public summary is aggregate-only; CRM and report history are authenticated and user-scoped.
- Preserve all original handoff files and exact baseline provenance.

## Work
- [x] Restore and verify all 31 baseline files and the handoff checksums.
- [x] Run the supplied static audit against the baseline; 23 failures reproduce the documented gaps.
- [ ] Apply hardening/patches/apply_repairs.py with UTF-8 mode.
- [ ] Install dependencies; run TypeScript, Vite, static and domain checks.
- [ ] Repair reproducible build or runtime defects with regression coverage.
- [ ] Run desktop/mobile browser workflows and document any platform-only verification limits.
- [ ] Review the resulting changes and save a reproducible local handoff.

## Verification
Run python -X utf8 hardening/tests/audit_static.py ., compile the domain suite with hardening/tsconfig.tests.json, run TypeScript and npm run build, then exercise the five workflows in tests/tests.txt.
External deployment remains a separate step after verification.
