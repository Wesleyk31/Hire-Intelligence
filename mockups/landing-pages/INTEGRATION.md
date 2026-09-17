# Hire Intelligence: five landing-page concepts

These are working, local design previews. The current homepage and production application have not been replaced. Nothing has been published.

## Open the previews

With the existing Vite verification server running on port 4185, open:

`http://127.0.0.1:4185/mockups/landing-pages/index.html`

To start that preview later from the repository root:

```powershell
node node_modules/vite/bin/vite.js --config vite.verification.config.ts --host 127.0.0.1 --port 4185 --strictPort
```

The verification configuration is only a local runtime. A production integration must keep the production SDK and configuration. These HTML files are development entry points; the existing default Vite production build does not automatically package this gallery.

## The five directions

| Concept | Intended entry point | Working interaction | Integration size |
| --- | --- | --- | --- |
| **01 — Fieldnotes** | General homepage; broad project-intelligence story | Filter three sample briefs; open their details | Smallest: existing hero, assets, feature cards and demo pattern |
| **02 — Signal Room** | Visitors evaluating the software workflow | Switch project, equipment and evidence views; open sample rows | Small: local tab state and reusable sample rows |
| **03 — Territory** | Branch leaders and regional teams | Switch WA, QLD and NSW sample context and map emphasis | Small–medium: selector state; separate illustration from real geographic data |
| **04 — Fleet Forward** | Fleet and equipment planning audience | Switch equipment classes; inspect predicted relevance | Small: category state, reusable cards and demand links |
| **05 — Evidence to Action** | Commercial teams evaluating evidence and follow-up | Three-step workflow; detail dialog; expandable questions | Small: step state and native disclosure controls |

**Recommendation:** start with Fieldnotes for the main homepage. Its editorial hierarchy explains the proposition clearly, retains the red mark, and reuses the existing resource illustrations. Territory and Fleet Forward would make focused solution pages. Signal Room is the strongest alternative when the objective is to demonstrate the software immediately. Evidence to Action works well when visitors need to understand how public evidence and commercial outcomes connect.

All five include current-site navigation, a responsive mobile menu, a local demo simulation, keyboard-visible focus, native modal dialogs, Escape dismissal and focus restoration. Forms validate required fields but never send or store details. Equipment examples remain **PREDICTED** and all illustrative records are labelled.

## Files and dependencies

- `index.html`: comparison gallery linking to all five complete pages.
- `01-fieldnotes.html`, `02-signal-room.html`, `03-territory.html`, `04-fleet-forward.html`, `05-evidence-to-action.html`: full page layouts.
- `shared.css`: common styles, five palettes, layout variants, breakpoints and reduced-motion support.
- `shared.js`: shared shell, sample content, local interaction state and dialog/form behaviour.
- `australia.svg`: outline paths reused from the existing `AustraliaGraphic` in `src/LandingPage.tsx`.
- `previews/`: desktop/mobile captures, gallery thumbnails and verification results.

The previews add no packages, API calls, fonts, external services, analytics or storage. They reuse `/resources/industrial-landscape.svg`, `/resources/project-signals.svg`, `/resources/shutdown-intelligence.svg` and `/resources/fleet-demand.svg` from `public/resources/`. System sans-serif and Georgia provide the typography.

The scripts render trusted local sample strings only. Do not route API or user-provided content through their `innerHTML` rendering; use React text nodes when integrating.

## Reusable production pieces

| Existing piece | Reuse in the selected design |
| --- | --- |
| `src/LandingPage.tsx`, `LandingPage({ onExplore })` | Keep the existing entry component contract and public-page hash handling; replace the selected home layout within it. |
| `src/DemoRequestForm.tsx`, `<DemoRequestForm compact />` | Replace the preview-only form completely with the existing production form. |
| `src/useDialogFocus.ts`, `useDialogFocus(open, onClose)` | Reuse the current React modal focus/keyboard pattern if continuing the existing dialog implementation. Do not run both independent focus traps. |
| `src/FunctionalApp.tsx`, `VIEW_SLUGS` | Keep the established workspace routes and authentication entry behaviour. |
| `src/legal-content.ts` and the current public views | Keep the approved privacy, terms and contact flows. |
| `public/resources/*.svg` | Reuse the existing artwork with the same descriptive alternative text. |

Suggested component boundaries for a React port:

- Shared: `MarketingHeader`, `MarketingFooter`, `DemoRequestDialog`, `SectionHeading`, `SampleDetailDialog`.
- Fieldnotes: `EditorialHero`, `BriefFilter`, `BriefCard`.
- Signal Room: `WorkspacePreview`, `WorkspacePreviewRow`.
- Territory: `TerritoryHero`, `TerritorySelector`, `TerritorySummary`.
- Fleet Forward: `FleetHero`, `EquipmentSelector`, `PredictedRelevancePanel`.
- Evidence to Action: `EvidenceChain`, `WorkflowStepper`, `EvidenceQuestions`.

These are suggested names for new React components, not claims that they already exist. Each stateful preview needs only one selected-value state. Brief filtering needs one category state; the modal needs an open/detail state. Native buttons with `aria-pressed` can retain the demonstrated selection semantics without introducing a tab library.

## A practical integration sequence

1. Select a visual direction and approved copy. Extract its HTML sections into React JSX, converting `class` to `className` and `data-*` handlers to React events/state.
2. Scope the CSS to the new landing-page root or CSS module. The standalone preview stylesheet contains global resets and **must not be imported unchanged into the application**. Keep only the chosen theme and responsive rules.
3. Reuse the existing `LandingPage({ onExplore })` and public route flow. Use `onExplore` for the general workspace entry; preserve established `#platform/...` deep links where a specific destination is intended.
4. Replace the entire simulated demo flow with `<DemoRequestForm compact />`. Its existing submission is `api.post('/api/demo-request', Object.fromEntries(new FormData(form).entries()))` through `@appdeploy/client`.
5. Preserve the production field contract: `name`, `company`, `email`, optional `phone`, `message`, and the hidden `website` honeypot. Retain loading, success and error states. Confirm real submission in the proper integration environment; these previews intentionally do not exercise that API.
6. Keep sample product panels expressly illustrative, or supply approved public evidence through a defined backend response. Do not expose protected workspace records to the anonymous page. If public summary counts are used, reuse `/api/public/summary` with explicit loading/unavailable states instead of invented figures.
7. Remove the concept switcher and preview-only copy from the chosen production layout; retain all labels needed to distinguish illustrative records and predicted demand. Keep approved legal links.
8. Run the existing typecheck/build and relevant browser workflows; verify deep links, real demo error/success cases, keyboard focus and mobile layout. Publish only through the normal authorised release process.

For a developer familiar with this app, an indicative implementation allowance is roughly half to one working day for one static concept port and integration, plus review and any backend/content changes. This is a planning estimate, not a delivery promise. Live regional coverage, authenticated record previews or new analytics would be additional scope; none is required to use these designs.

## Routes used

The actual-platform CTAs use existing destinations:

`/#platform/decision-desk`, `/#platform/projects`, `/#platform/opportunities`, `/#platform/map`, `/#platform/equipment-demand`, `/#platform/source-admin`, `/#platform/crm`.

Public links use `/#products`, `/#about`, `/#privacy`, `/#terms` and `/#contact`. Local `#explore` and `#approach` anchors move within each concept. The territory selector changes local sample content only; the map CTA opens the existing map and does not claim to apply a region filter.

## Verification record

See `previews/qa-results.json` for the latest desktop/mobile render and form checks, and `previews/interaction-results.json` for all concept controls, links and keyboard/dialog checks. Screenshots are local QA artefacts and comparison previews, not evidence of production data.

The previews were checked in installed Microsoft Edge at 1440×1080 and 390×844. Additional responsive boundary checks use 320, 768 and 1024 pixels. These checks establish preview behaviour; they do not establish a production API integration or a complete accessibility audit.
