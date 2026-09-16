# Hire Intelligence

Restored and continued locally on 16 September 2026 from `Hire-Intelligence-Codex-Ready.zip` and the exact AppDeploy baseline `1789467699311` for app `hirer-intelligence-mfj58p`.

The supplied archive was a hardening overlay, not a standalone application. All 31 baseline files were retrieved, the 21 supplied handoff checksums were verified, and the baseline was saved in commit `ee19a02`. Work continues on `codex/hire-production-hardening`.

## Current state

The historical-evidence continuation connects archived records to the dashboard and CRM, adds checked archive checkpoints and byte limits, and discloses coverage bounds. Verification: **70 unit/API tests pass; 92 of 93 browser tests pass**. The remaining browser failure is the corrupt approved homepage JPEG. TypeScript, 24 static checks, 21 handoff hashes and the verification build pass. Read the [continuation results](docs/audit/HISTORICAL_EVIDENCE_PROGRESS.md), [full-site audit](docs/audit/2026-09-16-SITE_AUDIT.md) and [next scope](docs/audit/NEXT_SCOPE.md).

The 28-item hardening overlay is integrated into the application. Additional tested repairs address project identity collisions, source-date and contractor-role accuracy, ingestion during dashboard reads, report history isolation, failed report saves, session recovery and mobile sign-in layout. See [build status](docs/BUILD_STATUS.md) for verification evidence and remaining work.

No deployment or GitHub push was performed. The live AppDeploy application does not acquire these local changes automatically.

## Install and verify

Use Node.js 22 or newer, pnpm 11.19.0, Python 3 and Chrome for the browser tests.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
python -X utf8 hardening/tests/audit_static.py .
pnpm test:browser
pnpm build:verification
```

If Chrome is unavailable, provision it or select an installed Playwright browser in `playwright.config.ts`.

### AppDeploy runtime boundary

The production application imports `@appdeploy/client` and `@appdeploy/sdk`. These private packages are injected by AppDeploy and are unavailable from the public npm registry. The restored source export does not contain their implementation. `types/appdeploy.d.ts` supplies compile-time declarations from the connector's SDK reference; it does not supply a runtime.

`pnpm dev` and `pnpm build` retain the original production configuration and require the real AppDeploy client runtime. A production build cannot complete in a plain local checkout until that runtime is supplied through the platform.

`pnpm build:verification` compiles the frontend with an explicitly isolated test client and writes `.local/verification-dist`. Browser tests use `vite.verification.config.ts`, synthetic QA fixtures and intercepted API calls; unit tests replace the SDK database boundary. These tests exercise application behavior but do not validate a live identity provider, platform token enforcement, deployed storage or cron. Do not deploy the verification output.

`pnpm dev:verification` starts the test configuration on `127.0.0.1:4175`. Its API responses are provided by Playwright during tests; it is not a standalone working backend.

## Source and handoff preservation

- Original handoff documents and `hardening/` are preserved byte-for-byte against `SHA256SUMS.txt`.
- `BASELINE_SOURCE_HASHES.json` records the exact baseline source hashes before integration.
- `scripts/apply-hardening.py` corrects a duplicate replacement in the supplied integration script in memory and applies it in a temporary directory before copying completed output. It checks the baseline hashes first. It is a one-time baseline integration tool and should not be rerun against the current edited application.
- The root `src/` and `backend/` directories are the maintained implementation. The immutable `hardening/` directory is the original handoff material.

## Continue production validation

Provide the real AppDeploy runtime in its supported build environment, run a production build, then repeat `tests/tests.txt` against a staging deployment with separate test accounts. Verify auth-provider behavior, database isolation, real source collection and scheduled refreshes there. Deployment capacity must be checked with the account owner; the handoff reports an exhausted deployment allowance, which has not been independently rechecked.
