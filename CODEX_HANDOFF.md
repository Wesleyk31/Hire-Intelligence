# CODEX HANDOFF — HIRE INTELLIGENCE

## Mission

Take over Hire Intelligence from AppDeploy production snapshot `1789467699311` and finish the production-hardening programme without regressing the approved public design or the existing evidence-governed intelligence rules.

## Source of truth

- Production app id: `hirer-intelligence-mfj58p`
- Production baseline snapshot: `1789467699311`
- Production URL: `https://hirer-intelligence-mfj58p.v2.appdeploy.ai/`
- Hardening implementation: `hardening/`
- Integration script: `hardening/patches/apply_repairs.py`
- Audit mapping: `hardening/docs/MASTER_REPAIR_PLAN.md`
- Second-pass assessment: `hardening/docs/REASSESSMENT.md`

The AppDeploy account hit its 125/125 lifetime deploy limit before the hardening overlay could be applied. Do not assume the live URL contains the hardening changes.

## Non-negotiable product rules

1. Do not fabricate BDM outcomes, contacts, equipment requirements or commercial values.
2. Equipment-demand inference must remain explicitly labelled `PREDICTED`.
3. `CALL NOW` must remain evidence-gated; a high priority score alone is insufficient.
4. Preserve provenance and licence evidence for admitted public feeds.
5. Broken collectors must fail/degrade visibly or be disabled; never manufacture replacement data.
6. Personal contacts may only appear when separately verified from lawful public evidence.
7. Keep public marketing claims consistent with what the production data engine actually proves.
8. Do not reintroduce static/fake regional project counts.
9. Do not call the product functionally complete until browser interaction tests have actually run.

## Immediate Codex workflow

### A. Obtain the exact baseline

Use the AppDeploy connector, if available, to export/read snapshot `1789467699311` into the repository root. The expected production paths are listed in `BASELINE_MANIFEST.json`.

If AppDeploy is not available in Codex, obtain the same snapshot/source checkout from the user before integrating. Do not apply the overlay to an unrelated version.

### B. Apply hardening

From the repository root:

```bash
python hardening/patches/apply_repairs.py .
```

The patch is intentionally anchor-strict. If it fails, inspect the baseline difference rather than weakening the checks.

### C. Verify

```bash
npm install
npm run build
python hardening/tests/audit_static.py .
```

Run the domain test using `hardening/tsconfig.tests.json`, then execute the browser acceptance suite in `hardening/tests/tests.txt.replacement` on desktop and mobile.

### D. Re-audit

After all tests pass, audit the full site again for:

- every public header/footer pathway;
- all 12 internal modules;
- project drawer and evidence provenance;
- map filters, clusters, precision and drill-down;
- CRM validation and user isolation;
- report preview/PDF/history;
- source health/backfill;
- auth boundaries and anonymous denial;
- mobile navigation;
- misleading labels, stale copy or impossible actions.

Repair any regression before deployment.

## Current 1–28 hardening status

The implementation bundle contains code addressing all 28 audit findings. It is not a claim that the live AppDeploy deployment contains them. `hardening/docs/MASTER_REPAIR_PLAN.md` maps each item to the intended implementation.

## Deployment target

Preferred long-term flow:

`Codex -> Wesleyk31/Hire-Intelligence -> reviewed commit/PR -> deployment`

Do not overwrite the live production baseline until the rebuilt project compiles and the browser acceptance suite passes.
