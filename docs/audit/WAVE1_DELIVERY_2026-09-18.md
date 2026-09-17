# Hire Intelligence: first continuation batch

18 September 2026, Australia/Perth. Local branch `codex/hire-next50-wave1`, based on `36e2ab9`. This report records local implementation and read-only source checks. No new deployment, production ingestion, activation, schedule change or GitHub push occurred in this batch.

## Scope status

| Scope | Delivered locally | Remaining acceptance |
| --- | --- | --- |
| 2167 | Versioned contracts for all 70 registered sources, including four historical sources. Contracts preserve source/agency/attribution labels, endpoint and provenance, configuration, unknown rights, publisher cadence, publication version and source-date semantics. | Registry labels are not legal clearance. Actual rights, event semantics and publication versions still require source-specific acceptance. No activation changed. |
| 2168 | Refresh and historical pulls persist an initial receipt before collection and finalise it with checked storage acknowledgement. Contract snapshots and versions travel with receipts. Counts distinguish collector-reported rows, normalised rows, identities, duplicates, held identities, acknowledged rows and uncertain outcomes. | SDK/storage behavior needs real-runtime acceptance. Receipts do not create exclusive writers or repair existing duplicate history. Interrupted/ambiguous receipt finalisation remains visibly unconfirmed. |
| 2169 | Authenticated, read-only source-contract and receipt routes and a Source Admin panel. HTTP 202/challenge/406, empty data, parser/schema failure, rights state, source dates and storage uncertainty have separate representations. | Receipt reads show at most 100 records per page and explicitly describe only that page; they do not claim the globally latest pull when history is incomplete. Pre-feature runs have no receipts. Publisher cadence and date semantics remain unverified. |
| 2176 | QLD grant response accurately reports `HTTP_202:PROVIDER_CHALLENGE`. | Provider-supported workbook access remains blocked. No grant rows accepted. |
| 2177 | Empty Stadiums datastore checks its same-period workbook. Retry pins that resource before archival. Metadata/malformed sheets are rejected; all structurally matching fallback rows retain schema/context holds. | Actual workbook still returns a provider challenge and its schema remains unverified. Newer 2026 catalogue publications were identified but not substituted for July–December 2025. |
| 2178 | Correct NT archive negotiation and measured volume limit. | Mineral ZIP declares 117,447,591 expanded bytes, over the unchanged 32 MiB cap; bounded download also timed out. Source remains disabled. |
| 2179 | Petroleum/pipeline parser validated against a complete official archive: 608 distinct title/holder records, including 218 historical records. Domain/type, holder identity and context exclusions retained. | Separate complete-download diagnostic is not scheduled acceptance: the 18-second collector audit still timed out. Rights/date/identity review and runtime canary remain. Disabled and held. |
| 2180 | Geothermal actual collector check returns 40 live sample rows and 96 historical title/holder rows. Initial archive snapshot is pinned before writes, including ambiguous acknowledgement cases. | Rights/date/legacy-ID and scheduled canary acceptance remain. Disabled and held. |

Detailed provider evidence: [feed recovery report](FEED_RECOVERY_2176_2180_2026-09-18.md), [post-change bounded audit](FEED_AUDIT_2026-09-17T23-20-18-079Z.md), [official probes and archive parsing](FEED_RECOVERY_2176_2180_PROBES_2026-09-18.json).

## Five landing-page proposals

Open the local gallery at `http://127.0.0.1:4185/mockups/landing-pages/index.html` while the Vite preview is running. Source and restart instructions are in [the integration guide](../../mockups/landing-pages/INTEGRATION.md).

1. **Fieldnotes** — editorial project brief; recommended general homepage and smallest integration.
2. **Signal Room** — dark product workspace with switchable example views.
3. **Territory** — regional entry with an Australian map and WA/QLD/NSW selectors.
4. **Fleet Forward** — equipment planning with class filters and explicitly predicted relevance.
5. **Evidence to Action** — commercial evidence trail, workflow stepper and questions.

All five are complete responsive preview pages with existing workspace destinations, keyboard-operable dialogs and local demo simulations. They add no dependencies or new backend. Production integration replaces the simulated form with the existing `DemoRequestForm`, ports the chosen layout to React and scopes its CSS. No example is a live project, verified customer result or testimonial. The existing homepage is unchanged.

## Verification

- `pnpm test`: **254 tests passed in 21 suites**.
- `pnpm typecheck`: frontend and backend passed.
- `pnpm build:verification`: passed; this uses the isolated verification SDK boundary, not the real production runtime.
- `pnpm exec playwright test --config playwright.wave1.config.ts`: **11 Chrome checks passed**, covering source health/receipt counts, paging, retries, read-only diagnostics, evidence review and quarantined pilot disclosure.
- Five concepts checked in Edge at **320, 390, 768, 1024 and 1440px**, with no horizontal overflow. Forms, sample filters/selectors, links, mobile menus, dialogs, focus containment/restoration and Escape/backdrop dismissal passed; no non-GET requests or browser errors. [Render/form results](../../mockups/landing-pages/previews/qa-results.json), [interaction results](../../mockups/landing-pages/previews/interaction-results.json), [gallery capture](../../mockups/landing-pages/previews/gallery-desktop.png).
- Independent review found and resolved five issues: unknown interrupted counts, malformed saved receipts, parser/transport classification, fallback resource/snapshot pinning before ambiguous writes, and unverified Stadiums workbook promotion. Regressions reproduce those failures and pass with the fixes. Final review found no unresolved P1/P2 issues.
- Baseline Windows CRLF hashbang loading failure fixed using one narrow `.gitattributes` rule; no evidence-inventory behavior changed.

## Next work

The remaining [2151–2200 roadmap](../superpowers/specs/2026-09-18-scopes-2151-2200-design.md) is still a delivery backlog. Highest-value next items are source-specific schema/date contracts (2165–2166), publication-safe continuation (2164), and the remaining acceptance steps for the recovered feeds. Larger writer coordination and complete-history work depend on the inventory/storage decisions already stated in the roadmap. Real staging/authentication acceptance remains outside this local verification; the earlier platform upload review-size block is unresolved and was not retried here.
