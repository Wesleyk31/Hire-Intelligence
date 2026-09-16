# Isolated staging acceptance

Date: 2026-09-16 (Australia/Perth)

## Current status

**Deployment attempted and rejected by automatic approval review (request exceeded 200,000 bytes); no staging app was created. Staging acceptance has not been performed.** The source helper writes local artifacts only. It does not create/update an app, authenticate, install dependencies, contact providers, seed records, run cron or submit requests.

The new staging app must use the real AppDeploy runtime. Its scheduled jobs are deliberately disabled with `cron.json` containing `[]`. The existing production app and its `tests/tests.txt` contract remain unchanged.

Outstanding owner inputs: legal entity, accountable administrator/contact, retention policy, authorized staging account access for Actor A and Actor B, and authorized QA contact details. Do not replace missing values with invented identities, credentials, contact information or retention periods.

## Generate source artifacts

From the Hire Intelligence project root:

```powershell
node scripts/prepare-release.mjs --out .local/release-staging
```

Validate without writing artifacts:

```powershell
node scripts/prepare-release.mjs --check
```

Outputs:

- `.local/release-staging/files.json`: a bare array of `{ path, content }` objects containing complete UTF-8 source contents.
- `.local/release-staging/manifest.json`: ordered file list, source paths, byte counts, source/payload SHA-256 hashes, aggregate bundle digest, transformations and exclusion rules.

The artifact is **not a deploy-tool request**. Before creating the new staging app, the release owner must read current AppDeploy deployment instructions and validate the new-app test schema. After receiving the exact fresh scaffold, convert scaffold/template modifications to the required diffs. Do not guess the baseline, send full template contents where diffs are required, or use this new-app bundle as an update to the existing production app.

Run the helper after parallel source edits settle. Re-run after any code/test/config change; the digest records exactly what was read, not a promise that the working tree will stay unchanged. The helper uses stable ordering and no timestamps, so unchanged sources yield identical artifacts.

## Included source

- Maintained source files under `src/**` and `backend/**`, limited to source/text extensions; hidden folders, nested output folders, test/spec files and fixture directories are excluded.
- Direct `public/resources/*.svg` assets, including the six newly authored replacement illustrations.
- `index.html`, `package.json`, `pnpm-lock.yaml`, `postcss.config.js`, `tailwind.config.js`, `tsconfig.json`, `tsconfig.backend.json`, `vite.config.ts`.
- Generated `cron.json` with every scheduled job removed in the artifact only.
- `tests/staging/tests.json` mapped to **`tests/tests.json`** for the new staging app.

The source package/config files are captured as maintained, not silently rewritten. Existing package scripts for local tests/verification still name files excluded from the staging bundle; invoke only the production build flow prescribed by the platform. The TypeScript include lists may name the excluded local `types` directory; actual SDK typing/runtime comes from the platform. Do not install an `@appdeploy/*` package or copy local fake declarations/implementations to make staging pass.

The helper rejects `@appdeploy/*` entries in dependency buckets, synthetic runtime references in production source, linked source entries and SVG scripts/external resources. These targeted guards are not a general secret scanner or a substitute for reviewing source changes.

## Explicit exclusions

- `tests/runtime/**`, `tests/browser/**`, `tests/unit/**`, `types/**`.
- `vite.verification.config.ts`, `vitest.config.ts`, `playwright.config.ts`.
- Original corrupt `public/resources/approved-homepage.jpg`; it stays in the local project for traceability.
- `docs/**`, `hardening/**`, `scripts/**` and original handoff/audit files.
- `node_modules/**`, `dist/**`, `.local/**`, `tmp/**`, `test-results/**`.
- `.git/**`, `.agents/**`, `.codex/**`, environment files and anything outside the allowlist.
- Existing production-update `tests/tests.txt`. Its Markdown format is preserved; do not replace it with the new-app JSON contract.

No SDK implementation, test authentication session, local verification alias, generated build output or archived evidence is bundled.

## New-app workflow contract

`tests/staging/tests.json` is a bare JSON array of five independent tests. Each has nonempty name, description, covers, steps and expected fields plus a desktop/mobile viewport. Exactly one workflow has `sanity: true`. There is no shared setup, hidden seed route or credentials. The current SDK contract supports the explicit `qa_faults` GET/503/body_json case for the Logan read failure.

| Workflow | Capability coverage | Prerequisite and honest stopping point |
| --- | --- | --- |
| Public sanity | Homepage SVG decode, public navigation/summary, anonymous protected-read denial, provider sign-in gate | Runs without login; cannot establish successful authentication |
| Signed-in operations | Modules, stored evidence, provenance/export/pagination, source health, both read-only source pilot samples, read-failure/retry UI | Real authorized login; populated-pagination check needs actual continuation data; a live failure or supported bounded transport fault is needed for failure-state acceptance |
| Actor A/B durability | CRM validation and QA exclusion, report snapshots, session/reload persistence, account isolation, valid downloadable PDF | Two real accounts; report checks can use an empty dataset, but canonical CRM writes cannot |
| Demo/Contact | Invalid input rejection, storage-backed success/failure feedback, no external-delivery claim | Owner-authorized QA contact details for valid submissions; failure injection only if the platform runner supports it |
| Mobile/keyboard/legal | Mobile fit/artwork/navigation, focus trap, Escape/restore, Contact validation, legal routes and auth gate | Keyboard-capable runner or explicit manual follow-up; business legal facts remain pending owner approval |

Each workflow starts independently and does not depend on another test's records or login session. Actor names are roles only. Never inject browser storage tokens or synthetic accounts to turn a blocked real-auth check into a pass.

## API coverage

| Route | Staging workflow coverage |
| --- | --- |
| GET /api/public/summary | Public sanity: aggregate-only response and empty counts |
| GET /api/dashboard | Anonymous denial; authenticated modules, empty/error states and bounded evidence disclosure |
| GET /api/evidence/review | Anonymous denial; signed-in origin selection, row/provenance inspection, export, pagination when data exists |
| GET /api/sources/:key/diagnostic | Anonymous denial; authenticated read-only collector sample, zero/error interpretation and retry |
| GET /api/sources/pilots/:key | Anonymous denial; separate Logan/Queensland reads, actual provider outcome and bounded failure/retry behavior |
| GET /api/pilot/outcomes | Anonymous denial; Actor A/B account-scoped reads when canonical CRM data exists |
| POST /api/pilot/outcomes | UI canonical-project/positive-value validation, QA-excluded outcome persistence and account isolation when a canonical project exists |
| GET /api/reports/history | Anonymous denial; Actor A/B durable history isolation |
| POST /api/reports/history | Snapshot and PDF history save acknowledgement, reload persistence and separate accounts |
| POST /api/demo-request | Demo/Contact validation and truthful save success/failure feedback |
| Internal collectors, archive persistence, inventory and cron functions | Local behavioral tests and separate provider/storage acceptance; no new public test route is added and scheduled execution stays disabled |

Anonymous write rejection and malformed-cursor/quota/internal persistence behavior are also covered by the local regression suite; they must not be represented as new live-staging evidence without executing corresponding checks on the deployed runtime.

## Empty staging and QA data

A new database with cron disabled can legitimately contain no current evidence, archive pages or canonical projects. Read-only source-pilot previews **do not** populate that database.

The current UI can add CRM outcomes only for an existing canonical project; it does not offer canonical project creation/import. Therefore:

1. Test explicit empty states, zero-count reports and real report persistence where auth permits.
2. Mark populated evidence pagination and canonical CRM write/isolation/funnel checks blocked until legitimate staging records exist.
3. Do not invent IDs, add hidden QA endpoints, write the database directly, copy production records, or enable cron just to make tests pass.
4. A future explicit record-seeding setup may use an existing owner-authorized visible UI only. If no such UI exists, keep the prerequisite blocked.
5. If a canonical project is already legitimately present, enter test outcomes with the existing **QA excluded** control and clearly labelled QA notes. Do not claim real-measurement funnel behavior was accepted using QA-excluded records alone.

## Failure and provider acceptance

A source request returning success confirms only the observed bounded read. Capture provider status, checked row count, schema/quality findings, time and access/licence context. An empty or denied provider response is a real limitation, not successful ingestion.

A supported runner may fail one staging transport request to check visible error recovery, then restore transport. It must not alter a provider, fabricate a success response or mutate stored evidence. If the runner cannot perform this and no natural failure is observed, record the failure-state subcheck blocked.

PDF acceptance requires downloading and opening the actual generated PDF, checking nonempty bytes, substantive sections, readable layout, and its separately acknowledged report-history save. A screenshot of the preview alone is insufficient.

## Evidence and release decision

For the eventual staging run, record:

- Staging app identifier, URL and deploy version; no secrets or account credentials.
- Source bundle SHA-256 and exact deployed diff/manifest.
- Cron payload confirmed empty.
- Real anonymous responses, auth outcome and authorized Actor A/B separation evidence.
- Per-workflow status: passed, failed, blocked or not run; identify the exact blocked prerequisite.
- Report/history identifiers, reload results, generated PDF and layout results.
- Provider read results and limitations, separate from mocked local regression results.
- Legal entity/admin/retention approval status.
- Release/rollback decision and existing production rollback version.

Do not mark all scopes or production readiness accepted solely because a build or synthetic test suite passes.

## Local helper verification

- Behavioral check first failed because the helper was absent, then passed after implementation.
- Fixture-based checks verified deterministic output, allowlisted inclusion, forbidden-file exclusion, staging `cron.json = []`, new-app test path mapping, SDK dependency rejection, synthetic runtime rejection and exactly one sanity workflow.
- The initial actual-project artifact contained 51 files and five workflows; source edits can change its count/hash, so use the newly generated manifest for release.
- These are helper checks only. No deployment, real provider login, durable staging write or live-provider acceptance was performed by this preparation task.
