# Two-source pilot acceptance

Checked 16 September 2026 (Australia/Perth). Implementation is local and read-only; neither source is activated or scheduled. Public samples establish successful extraction in this environment, not production reliability.

## Result

| Source | Bounded sample | Usable context | Quarantine | Qualified events |
|---|---:|---:|---:|---:|
| Logan undecided development applications | 6 rows, 2 pages | 0 | 6 | 0 |
| Queensland coordinated projects, Current status | 6 rows, 2 pages | 6 | 0 | 0 |

Probe completed at **2026-09-16T02:23:27.577Z**. Logan took 1,364 ms; Queensland took 2,709 ms. Both reads reached their six-row bound and correctly reported `completed=false, truncated=true`. No full-coverage claim is made.

Logan examples included `MCUC/127/2026` (Warehouse; lodgement 11 September 2026), `MCUI/60/2026` (Warehouse and Showroom; lodgement 31 August 2026), and a withdrawn 2020 application. Every sampled row carried `INVALID_INPUT`. These are quarantined evidence, not accepted opportunities. The layer reported data last modified **2026-09-15T18:47:23.399Z**; that timestamp is not substituted for lodgement.

Queensland examples included Big Rocks Weir, Burdekin Falls Dam Raising, Inland Rail segments and Port of Gold Coast ocean-side terminal. All six returned Current EIS status, usable official project-detail links, no activity date, unknown organisation role and `UNDATED_CONTEXT`. A separate three-row schema inspection also returned generic directory links for completed EIS projects; the adapter flags those links and includes the title in identity so unrelated projects cannot collapse into one directory URL.

The probe prints selected project facts and summaries, omits applicant identities, and writes no operational records.

## Verified contracts and remaining rights review

- **Logan:** [official ArcGIS item](https://www.arcgis.com/sharing/rest/content/items/50489a44f46b45b5857bcc7f9aa95f20?f=json) states nightly refresh and Creative Commons Attribution 3.0 Australia. The [layer metadata](https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Logan_City_Undecided_Development_Applications/FeatureServer/0?f=json) confirms fields, date type and ordered pagination support. Attribution prepared: “Source: Logan City Council. Licensed under Creative Commons Attribution 3.0 Australia.”
- **Queensland:** [official catalogue metadata](https://www.data.qld.gov.au/api/3/action/package_show?id=coordinated-projects-the-coordinator-general) names CC BY 3.0 Australia. [StatePlanning layer 25](https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer/25?f=json) supplies the department attribution and ordered pagination support. Attribution prepared: “Source: State of Queensland (State Development, Infrastructure and Planning). Licensed under Creative Commons Attribution 3.0 Australia.”
- Both contracts preserve the [licence link](https://creativecommons.org/licenses/by/3.0/au/), exact terms/metadata URLs, owning agency, resource reference, review date, transformation notice, quality gates and cadence. Queensland's publisher cadence remains unverified; weekly polling is a proposal, not a verified publishing commitment.
- Public metadata review is not legal certification. Product attribution display, privacy treatment and permitted-use review remain activation gates. No personal-contact enrichment is performed.

## Adapter integration

Files: `backend/source-contracts.ts`, `backend/source-pilots.ts`.

- `SOURCE_PILOT_CONTRACTS`: keys `logan-development-applications` and `qld-coordinated-projects`; both `activationEnabled=false`.
- `normalizeLoganApplications(rows, { retrievedAt, sourceLastModifiedAt? })` and `normalizeQldCoordinatedProjects(rows, context)` accept raw attribute arrays.
- Return `{ evidence, quarantine, excluded, summary }`. Each accepted record is structurally compatible with intelligence evidence and includes provenance, attribution, licence, quality flags, upstream IDs/links and source status.
- **Only `evidence` is usable context.** Preserve `contextOnly=true` and `promotionEligible=false` in storage and all downstream scoring. Quarantine entries can contain an evidence object for diagnosis; that object is not accepted context and must never be copied into the intelligence store. Excluded rows are outside the commercial pilot view.
- Logan identity uses application system ID plus amendment, never OBJECTID. Multiple parcels merge within the fetched batch; one rejected/conflicting parcel quarantines its whole fetched group. A null amendment denotes the base application. Applicants map only to `APPLICANT_HOLDER`; absent applicant remains `UNKNOWN`.
- Logan commercial selection is conservative text filtering. Domestic home offices and unclassified descriptions are excluded; industrial developments and warehouse/caretaker combinations remain candidates. This is relevance screening, not demand qualification.
- Lodgement remains `sourceObservedAt` with `eventDateKind=LODGEMENT`. Null remains undefined; invalid/future/serial dates quarantine. Retrieval and source modification are separate.
- Queensland identity combines normalised title and decoded authoritative project URL. HTML is never rendered. Missing/malformed/non-government links quarantine; generic official directory links are flagged. Assessment completion is not construction completion.
- `fetchSourcePilot(key, options?, requestJson?)` adds `fetch` metrics and schema checks. Defaults: 50 rows/page, four pages, 200 rows. Hard bounds: 100 rows/page, 20 pages, 1,000 rows. Ordered offsets use OBJECTID solely as a paging cursor; repeat/non-increasing IDs, malformed pages, missing schema fields and source errors fail the read. Short pages with transfer-limit flags continue.
- `summary.duplicateRows` counts input rows grouped into another application/project, including additional parcels; it is not solely exact duplicate rows. Quality-flag counts are per grouped record. `datedEvidence` counts accepted context only, so quarantined dated Logan samples do not inflate it.

## Validation

The focused suite has **18 passing tests**, following witnessed failures before implementation/fixes. It covers IDs changing, duplicate parcels, amendments, applicant roles, lodgement/null/malformed/future dates, domestic filtering, type-changed quality fields, upstream rejection, conflicting dispositions, HTML entities/links, missing identity, assessment status, ordered bounded paging, truncated/short pages, repeated IDs, schema errors and closed activation contracts. Backend typecheck passed during implementation.

Reproduce:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/source-pilots.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.backend.json
node --experimental-strip-types scripts/probe-source-pilots.ts
```

The probe uses Vite's TypeScript loader with dependency discovery disabled; it does not require the AppDeploy runtime.

## Gates before ingestion or promotion

1. Resolve Logan's upstream `INVALID_INPUT` meaning with authoritative documentation or publisher clarification; do not clear the flag merely because parsing succeeds.
2. Complete product attribution/rights review and validate organisation/privacy handling.
3. Run canary reads in the real production runtime, then observe scheduled ingestion, latency, schema drift and source refresh behavior. Local successful samples do not satisfy these gates.
4. Review a fixed representative relevance sample. Six warehouse-filtered rows and six Current EIS rows are deliberately biased, not coverage/precision estimates.
5. Establish cross-batch grouping and publisher snapshot consistency before claiming complete ingestion. Ordered offsets cannot prevent omission when the publisher replaces/reorders data mid-read; this pilot reports bounds and does not claim exactly-once coverage.
6. Corroborate Queensland project-page status and any future demand event using separately dated evidence. These adapters never independently create qualified leads or fresh call-now alerts.

CER, WA EPA, NSW planning, WA major-project and national-roadworks adapters remain outside this pilot; their research/access/licensing gates are unchanged.
