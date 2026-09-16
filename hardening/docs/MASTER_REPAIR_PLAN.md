# Hire Intelligence 1–28 Production Hardening

Base production snapshot: `1789467699311`.

## Repair matrix

1. **Authentication** — add `AuthGate`, protect CRM/report writes with AppDeploy `requireAuth()`, remove unauthenticated operational mutation paths from the public experience.
2. **100/50 data ceilings** — use bounded paginated reads with explicit `universe.loaded/truncated/pagesRead`; never label a truncated window as the entire universe.
3. **Contractor role contamination** — persist `organisationRole`; only `DELIVERY_CONTRACTOR` feeds contractor workload. Keep owner/proponent/applicant/operator separately visible as organisations.
4. **Canonicalisation** — replace name-only grouping with token/location similarity plus source/external-ID fallback for generic records.
5. **Melbourne backfill 400** — OpenDataSoft historical fetch removes brittle `order_by` and retries the base records endpoint with only supported pagination parameters; failed cursor remains retryable instead of poisoning the cron.
6. **Stage recency** — choose the strongest stage inside a recent evidence window; stale COMPLETE/SHUTDOWN cannot dominate fresh current evidence indefinitely.
7. **Snapshot scaling** — page snapshot reads and persist new snapshot records beyond the original 100-row ceiling.
8. **CRM scaling** — bounded pagination to 1,000+ outcome rows with truncation disclosure; no silent 100-row history ceiling.
9. **CALL NOW** — explicit gate: active commercial stage + priority >=80 + A/B signal + freshness >=65 + evidence-backed delivery contractor + meaningful predicted equipment class.
10. **Companies & Contacts** — rename to `Organisations & Delivery Teams`; only show verified contacts if/when a verified contact ingestion field exists.
11. **Report preview** — render a real on-screen report preview with executive metrics, CALL NOW, source health and governance before download.
12. **PDF depth** — use `reporting.hardened.ts`: CALL NOW, regional analysis, sources/provenance, deferred sources, calibration and governance appendix.
13. **Map unresolved points** — unresolved locations are not plotted at the centre of Australia; show them in an `Unmapped` count/list.
14. **Map double counting** — KPI/equipment summaries use unique projects, not project+event point duplicates.
15. **Public claim accuracy** — change “public and private” to lawful public-source + user-entered commercial outcomes; change “real-time” to scheduled/current refresh language.
16. **Static WA/QLD/NSW counts** — calculate preview counts from dashboard project locations; never show invented fixed regional totals.
17. **Demo workflow** — replace modal-only redirect with validated `DemoRequestForm`; persist legitimate requests, honeypot bot submissions.
18. **Contact pathway** — same validated form on Contact page, with visible success/failure state.
19. **Privacy/Terms** — replace placeholder cards with structured policy content from `legal-content.ts`; final legal review remains a business/legal-owner responsibility.
20. **Dead LinkedIn mark** — remove it until a real company LinkedIn URL exists.
21. **Decision Desk events** — make recent event rows clickable to the canonical project drawer.
22. **Source Admin jargon** — replace GREEN/AMBER/internal build jargon with `Active`, `Degraded`, `Failed`, `Deferred`, `Candidate`.
23. **Scope 2150 customer UI** — remove internal scope numbering; show `Engine capability status` only.
24. **Confidence semantics** — label equipment score `Heuristic confidence`; add copy that it is not a calibrated probability.
25. **CRM funnel correctness** — unique-project funnel via `aggregateOutcomeFunnel`; quote/won value uses project maxima rather than duplicate row summation.
26. **Refresh resilience** — one source failure no longer throws the entire hourly cron; persist failed source status and finish the cycle as degraded.
27. **Report history** — persist authenticated user-scoped report metadata server-side; localStorage may remain only as transient fallback.
28. **Verification** — add pure-domain tests plus explicit AppDeploy browser acceptance suite. Do not claim browser E2E while AppDeploy returns `e2e_tests:null`.

## Integration order

1. Add `backend/domain-hardening.ts` and `backend/data-access.ts`.
2. Refactor `backend/intelligence.ts` to call `groupCanonicalEvidence`, `chooseCurrentStage`, evidence source dates and role-filtered delivery contractors.
3. Refactor `backend/index.ts` to use bounded lists, unique-project funnel, CALL NOW gate, demo/report routes, protected writes and resilient cron status.
4. Fix `backend/backfill-fetch.ts` OpenDataSoft pagination and `backend/backfill.ts` retry/error scheduling.
5. Add `src/AuthGate.tsx`; wrap the platform in `App.tsx`.
6. Integrate `DemoRequestForm` and truthful public copy in `LandingPage.tsx`.
7. Refactor `GeoMap.tsx` to omit unresolved coordinates and use unique-project map statistics.
8. Update `FunctionalApp.tsx` labels, decision-desk actions, source status language, report preview and server report history.
9. Replace `src/reporting.ts` with `src/reporting.hardened.ts`.
10. Run the domain tests, `tsc --noEmit`, Vite build, then browser acceptance tests before deployment.
