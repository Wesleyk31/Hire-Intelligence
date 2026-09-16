# START HERE

1. Read `CODEX_HANDOFF.md`.
2. Read `hardening/README.md`.
3. Read `hardening/docs/MASTER_REPAIR_PLAN.md` and `hardening/docs/REASSESSMENT.md`.
4. Restore AppDeploy baseline snapshot `1789467699311` into this workspace.
5. Apply `hardening/patches/apply_repairs.py`.
6. Build, run the static audit, domain tests and browser acceptance tests.
7. Re-audit before deployment.

This package intentionally preserves the distinction between the last live AppDeploy snapshot and the hardened source overlay so Codex does not mistake un-deployed work for production state.
