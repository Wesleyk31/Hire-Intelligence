# Reassessment after the 1–28 repair design

## Second-pass findings that were repaired in the bundle

The first hardening design exposed additional weaknesses. These were folded into the overlay rather than left for later:

1. **UI-only authentication was insufficient** — the repaired design protects `/api/dashboard`, leaves only an aggregate-only `/api/public/summary` public, and keeps public pages from receiving canonical project rows.
2. **Shared CRM data would still allow cross-user contamination** — CRM outcome storage is moved to per-user logical tables and dashboard calibration loads only the authenticated user's outcomes.
3. **Report history needed the same tenant boundary** — report history is stored in a per-user logical table and restored after reload/login.
4. **Manual source refresh/backfill was too powerful for ordinary authenticated users** — the overlay removes public/internal manual mutation controls and leaves ingestion/backfill to scheduled handlers. Source Admin becomes observational.
5. **Public summary must not trigger full project-intelligence writes** — the public summary is built directly from bounded stored source/opportunity state rather than calling the protected canonical-project engine.
6. **Supplier did not always mean contractor** — supplier is now a separate `SUPPLIER` role. Only explicit contractor fields become `DELIVERY_CONTRACTOR` by default.
7. **Canonical IDs needed migration stability** — the project engine attempts to retain an existing snapshot identity through known project-name aliases before minting the newer canonical key.
8. **Backfill fallback could duplicate page zero** — OpenDataSoft no-offset fallback is permitted only for cursor zero; later pagination failures remain explicit rather than duplicating records.
9. **Public high-priority/canonical labels were too strong for aggregate raw-signal counts** — public copy is changed to `Priority-Stage Signals` and `Project signals in current public window`.
10. **Bounded reads needed visible disclosure** — the operational workspace displays a data-window warning if additional stored records exist outside the current bounded view.
11. **Report preview was still only a message** — Reports gets a real visible current-report preview and the button is renamed to `Save report snapshot`.
12. **Map source wording still claimed real-time** — changed to current/scheduled language.
13. **Equipment percentage semantics still looked probabilistic** — UI and report copy now use `heuristic confidence` / `heuristic demand index`.

## Expected position after integration

If the overlay applies cleanly and passes build/browser verification:

- Security and tenant integrity: strong beta-grade baseline.
- Data semantics/governance: materially stronger; owners/applicants/suppliers are no longer automatically contractors.
- Commercial metrics: unique-project funnel rather than raw-row arithmetic.
- Data-scale honesty: bounded and disclosed instead of silently capped.
- Map integrity: no false Australia-centre placement and no event-driven multiplication of project KPIs.
- Reporting: substantially closer to a genuine customer-facing intelligence report.
- Public website: claims and conversion pathways aligned with what the system actually does.

## Remaining product-grade evolution beyond the original 28 items

These are not hidden faults in the repaired overlay, but the next engineering tier for a commercial multi-tenant SaaS:

- subscription/entitlement billing rather than authentication alone;
- explicit organisation/workspace membership and administrator roles;
- source-specific semantic parsers for major feeds instead of mostly generic field matching;
- materialized dashboard/index tables once current data exceeds the disclosed bounded-window thresholds;
- statistical calibration of prediction confidence after enough genuine BDM outcomes exist;
- counsel-reviewed final Privacy Policy and Terms of Use with the operating legal entity and contact details;
- independent browser E2E execution because AppDeploy currently reports `e2e_tests:null`.
