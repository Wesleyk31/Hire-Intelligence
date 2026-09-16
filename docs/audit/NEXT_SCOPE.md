# Next scope — production release and trustworthy data

## Current execution status

Local implementation across these scopes is now delivered and verified (231 unit/API, 113 Chrome and 18 Edge checks). [Detailed status](SCOPES_1_TO_4_PROGRESS.md) records each implementation and remaining acceptance gate. The isolated staging request was rejected by automatic approval review's 200,000-byte limit; production is unchanged. Next: resolve that deployment review, real authentication/storage acceptance, actual-data reconciliation and scheduled canaries, then approved business/retention details. The acceptance targets below remain authoritative; they are not marked complete from local fixtures.


## 1. Close release blockers

- Restore the intact approved homepage artwork and pass its image-decode/visual check.
- Provision the real AppDeploy runtime, complete a production build and stage the local branch.
- Verify anonymous API denial, provider sign-in, expiry, revocation and sign-out.
- Prove two-account CRM/report ownership and actual persistence using explicit staging QA records.
- Repeat all 21 routes and critical workflows on staging, then release through the authorised deployment process.
- Resolve the automatic-review size limit; both staging requests were rejected before a platform capacity check. Explicit user approval is already recorded.

**Acceptance:** production build and staging checks pass; no anonymous operational data; artwork renders; rollback evidence exists. Never deploy the test-runtime verification output.

## 2. Connect historical evidence and repair stored data

**First local increment delivered:** a shared bounded current/archive view now powers dashboard and CRM; checked checkpoints, pinned provider context, UTF-8 page limits and coverage disclosures are tested. [Results and limits](HISTORICAL_EVIDENCE_PROGRESS.md).

- Build an indexed/paginated historical evidence store for complete coverage beyond the current read window.
- Implement controlled ingestion-time stage-baseline reconciliation; dashboard/CRM reads now use existing snapshots without advancing them.
- Reconcile physical duplicate pages and interrupted batches; add a single-writer guarantee or transactional checkpoint storage. Visible deduplication is implemented, but exactly-once physical storage is not.
- Run the implemented offline inventory and repair planner on actual reviewed full-storage exports. Inspect exact ID/hash proposals before any controlled reconciliation; no production data repair has run.
- Cover historical CKAN publications and explicitly selected WFS layers.
- Replace bounded dashboard/report windows with indexed queries or pagination, keeping bounds visible until then.

**Acceptance:** counts reconcile source → archive → evidence → projects; retries do not duplicate/omit rows; historical evidence appears with correct provenance and dates.

## 3. Recover existing feeds, then pilot new ones

- Keep Queensland granted resource authorities degraded while the latest workbook returns 202 and Stadiums degraded while its datastore is empty.
- Validate four recovered SA feeds, three corrected NSW mining layers, the national major-project workbook and two recovered NT MODAT archives before activation. Resolve the three NT title domains separately.
- Pilot **Logan development applications**, quarantining unexplained INVALID_INPUT quality flags and deduplicating property/application rows.
- Pilot **Queensland coordinated projects** as pipeline context; missing activity dates cannot become new-demand alerts.
- Resolve CER commercial-linking terms, WA EPA licence acceptance, NSW planning access, WA major-project download and national roadworks licensing before activation.

**Acceptance:** stable IDs, schema, provenance, permitted use, date/role tests, deduplication and observed scheduled ingestion for each feed.

## 4. Operational acceptance and performance

- Monitor per-source latency, rows, duplicates, date completeness, schema/body failures and partial writes.
- Add representative load tests and reduce the main JavaScript bundle through measured code splitting.
- Expand device/browser/accessibility checks and real-volume report review.
- Finalise business Privacy/Terms and retention/access policy before customer onboarding.

**Recommended order:** release blockers → historical/data repair → existing-feed recovery → two small source pilots. The live deployment remains older than the audited branch until a separate authorised release.
