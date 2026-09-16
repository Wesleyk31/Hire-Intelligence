# Next scope â€” production release and trustworthy data

## 1. Close release blockers

- Restore the intact approved homepage artwork and pass its image-decode/visual check.
- Provision the real AppDeploy runtime, complete a production build and stage the local branch.
- Verify anonymous API denial, provider sign-in, expiry, revocation and sign-out.
- Prove two-account CRM/report ownership and actual persistence using explicit staging QA records.
- Repeat all 21 routes and critical workflows on staging, then release through the authorised deployment process.
- Check current deployment capacity; the handoff described an exhausted allowance, and this audit did not retry deployment.

**Acceptance:** production build and staging checks pass; no anonymous operational data; artwork renders; rollback evidence exists. Never deploy the test-runtime verification output.

## 2. Connect historical evidence and repair stored data

- Materialise historical evidence_pages into the normalised opportunity/project index.
- Add idempotent writes, durable checkpoints, retry/replay reconciliation and coverage counts.
- Prepare a dry-run inventory of malformed AEMO rows, duplicate/position IDs and stale dates before quarantine/re-ingestion.
- Cover historical CKAN publications and explicitly selected WFS layers.
- Replace bounded dashboard/report windows with indexed queries or pagination, keeping bounds visible until then.

**Acceptance:** counts reconcile source â†’ archive â†’ evidence â†’ projects; retries do not duplicate/omit rows; historical evidence appears with correct provenance and dates.

## 3. Recover existing feeds, then pilot new ones

- Keep the two empty Queensland feeds degraded until real rows return.
- Validate four recovered SA feeds, three corrected NSW mining layers and the national major-project workbook before activation.
- Pilot **Logan development applications**, quarantining unexplained INVALID_INPUT quality flags and deduplicating property/application rows.
- Pilot **Queensland coordinated projects** as pipeline context; missing activity dates cannot become new-demand alerts.
- Resolve CER commercial-linking terms, WA EPA licence acceptance, NSW planning access, WA major-project download and national roadworks licensing before activation.

**Acceptance:** stable IDs, schema, provenance, permitted use, date/role tests, deduplication and observed scheduled ingestion for each feed.

## 4. Operational acceptance and performance

- Monitor per-source latency, rows, duplicates, date completeness, schema/body failures and partial writes.
- Add representative load tests and reduce the main JavaScript bundle through measured code splitting.
- Expand device/browser/accessibility checks and real-volume report review.
- Finalise business Privacy/Terms and retention/access policy before customer onboarding.

**Recommended order:** release blockers â†’ historical/data repair â†’ existing-feed recovery â†’ two small source pilots. The live deployment remains older than the audited branch until a separate authorised release.
