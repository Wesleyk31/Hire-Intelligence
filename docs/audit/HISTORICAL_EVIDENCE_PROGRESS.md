# Historical evidence continuation

## 16 September 2026 | Local implementation and verification

Archived evidence now participates in the operational dashboard and CRM lookup. This completes the bounded integration described in the [design](../superpowers/specs/2026-09-16-historical-evidence-design.md) and [implementation plan](../superpowers/plans/2026-09-16-historical-evidence.md). Full historical coverage and production acceptance remain open.

### Delivered

- A shared read-only evidence view merges current opportunities with stored archive pages. Duplicate source/external-ID pairs count once; the newest valid source date wins, with current evidence preferred on a date tie. Original archived versions remain stored.
- Archive-only projects can be linked to CRM outcomes. Original source dates are preserved; collection time does not establish current activity or a CALL NOW signal.
- Backfill records its CKAN resource or AusTender date anchor before fetching content. Retries keep this selection across provider updates and clock changes.
- Archive records are split by UTF-8 bytes, with a 224 KiB page limit and 1 MiB normalized batch limit. Oversized rows/batches fail before any page write. Page, cursor and control writes require acknowledgements; database quota failures propagate.
- Source Admin and reports disclose current/archive rows read, deduplicated evidence, bounds and excluded malformed data. Originals are retained for review.
- The mobile Public site button now sits in the account bar, clearing coverage warnings. Navigation back to the homepage remains tested.
- Corrected a prior audit cleanup's text-encoding damage in test expectations and backend display labels. Maintained status documents use intact punctuation.

### Verification

| Check | Result |
|---|---|
| Unit/API/parser tests | **70 passed**, 7 files; includes 18 archive ingestion and failure/replay cases |
| Full Chrome suite | **92 passed, 1 failed, 0 skipped**, 93 tests |
| New browser coverage | Desktop/mobile archive counts, report bounds and unobstructed mobile exit navigation pass |
| TypeScript | Frontend and backend pass |
| Static hardening audit | **24/24 pass** |
| Original handoff hashes | **21/21 match** |
| PDF layout | 15 pages, 0 out-of-margin glyphs, all 15 fleet notes and calibration retained |
| Verification build | Pass; main JS 911.54 kB, 284.56 kB gzip; bundle-size warning remains |

[Current browser inventory](HISTORICAL_EVIDENCE_BROWSER_RESULTS.json) records every case. Prior [site audit results](2026-09-16-SITE_AUDIT.md), [feed probes](FEED_AUDIT_SUMMARY.md) and [source research](NEW_SOURCE_RESEARCH.md) remain available. No feed was activated or re-probed in this continuation. Previously recovered feeds still require staging ingestion acceptance.

The sole browser failure is the existing truncated `public/resources/approved-homepage.jpg`: its image decode fails and the approved feature artwork cannot render. An intact original is still required. This failure stays visible in the suite.

### Limits and operational requirements

1. **Bounded coverage:** at most 1,500 current rows and 1,500 archived event slots are read, bounded further by 20 archive page records and 10 archive list calls. Counts/rankings describe this window. This is not a complete historical index; SDK ordering can determine which pages enter it. Malformed rows consume slots and are disclosed.
2. **Visible deduplication, not exactly-once storage:** uncertain acknowledgements can leave duplicate physical archive pages. The read view suppresses duplicate identities; it does not reconcile or delete stored pages. Duplicate pages may consume the bounded window.
3. **No distributed writer guarantee:** the SDK exposes no transaction/compare-and-swap primitive here. Staging must enforce a single backfill writer or provide transactional storage before concurrent ingestion. A pinned resource can still be modified in place upstream.
4. **No stored-data migration:** old malformed AEMO records, unstable legacy IDs and other stored-data defects still need a dry-run inventory and reviewed quarantine/re-ingestion process. Invalid rows/pages are excluded from the read view, not rewritten.
5. **Public summary remains current-feed-only.** Archive integration applies to authenticated operational pages and their reports/CRM.
6. **Platform acceptance remains open:** unit tests mock the SDK boundary; browser tests use synthetic intercepted APIs. The private AppDeploy runtime, actual authentication, two-account isolation, storage limits and scheduled ingestion require staging. Do not deploy the isolated verification build.

### Next scope

1. Restore approved artwork and validate the real platform runtime/authentication/storage in staging before release. The older live deployment still has the authentication exposure identified in the full audit.
2. Add an indexed or paginated historical store and reconciliation tooling, then inventory and repair legacy data. Preserve source dates, provenance and account ownership throughout.
3. Accept the recovered existing feeds, then pilot Logan development applications and Queensland coordinated projects subject to the quality/access conditions in the source research.

All changes are local on `codex/hire-production-hardening`. No push, deployment, live mutation, feed activation or external message/form submission was performed.
