# Recovered feed acceptance and registry repairs

Checked 16 September 2026. All eight sources remain **disabled**. These checks establish public reachability and local parser behavior; production-runtime canaries and scheduled ingestion remain unverified.

## Fresh evidence

The existing collector audit ran at 02:26 UTC, with five-row network limits, an 18-second request timeout and a 25 MiB body limit: [machine report](FEED_AUDIT_2026-09-16T02-26-08-965Z.json), [summary](FEED_AUDIT_2026-09-16T02-26-08-965Z.md). SA live/backfill emitted 5/5, 5/5, 3/3 and 5/5 rows; the national workbook emitted the existing live/backfill limits of 40/100. Those counts alone did not prove stable identity or correct sheet selection.

Direct WFS 2.0 checks followed at 02:27 UTC using two pages of three features, then repeat SA requests at 02:28 UTC. **All four SA services regenerated feature.id for the same domain records on repeat.** The existing preference for GeoJSON feature.id therefore duplicated projects across refreshes. Domain reference fields remained equal in this repeated sample.

After implementing shared helpers, the following local canary ran on **2026-09-16 at 02:33 UTC**:

| Source key | Started UTC | Duration ms | Usable rows | Identity |
|---|---|---:|---:|---|
| sa-mining-projects | 02:33:15.232 | 1,166 | 3 | SITE_NO |
| sa-mineral-tenements | 02:33:16.399 | 158 | 3 | APPLICATION_TYPE + FILE_REFERENCE |
| sa-petroleum-tenements | 02:33:16.557 | 151 | 3 | TENEMENT_NO |
| sa-power-generation | 02:33:16.708 | 153 | 3 | STATION_NAME + SUBURB + TECHNOLOGY; review flag |
| nsw-current-mining-titles | 02:33:16.861 | 1,590 | 3 | tas_id |
| nsw-mining-title-applications | 02:33:18.451 | 328 | 3 | tas_id |
| nsw-major-operating-mines | 02:33:18.779 | 323 | 3 | occurrence_id |
| au-resources-energy-major-projects | 02:33:19.102 | 2,788 | 432 | Project + State; checked natural key |

Power records explicitly carry `NATURAL_ID_REVIEW_REQUIRED`; a publisher-stable station ID was not found. A name/technology/location change can change that key. Keep this feed disabled until identity collision and change handling are accepted.

WFS matched counts during the bounded probe were 31, 173, 3, 140, 2,300, 113 and 52 respectively. These are publisher-reported totals, not audited complete ingestion. Sorting title applications by ID returned old applications from 2002 onward, and current titles included grants from 1917 onward: current tenure does not imply a fresh project event.

Reproducible machine evidence is retained locally in `.local/recovered-feed-probe.json` and `.local/recovered-source-helper-acceptance.json`. No applicant names or personal contacts are recorded in these reports.

## Exact disabled registry patch

The machine-readable changes are in `.local/recovered-source-patches.json`. Apply only the named fields; preserve other registry metadata. Every change has `enabled: false`.

All seven WFS sources use `method: 'WFS_DIRECT'` and this query shape:

```text
<base>?service=WFS&version=2.0.0&request=GetFeature&typeNames=<URL-encoded typeName>&outputFormat=application%2Fjson&sortBy=<sort field>
```

The helper supplies bounded `count` and `startIndex`.

| Source key | Base | Exact typeName | sortBy |
|---|---|---|---|
| sa-mining-projects | https://services.sarig.sa.gov.au/vector/south_australia_mining_projects/wfs | south_australia_mining_projects:major_mines___minerals | OBJECTID |
| sa-mineral-tenements | https://services.sarig.sa.gov.au/vector/mineral_tenements/wfs | mineral_tenements:mineral_and_or_opal_exploration_licence_applications | OBJECTID |
| sa-petroleum-tenements | https://services.sarig.sa.gov.au/vector/petroleum_tenements/wfs | petroleum_tenements:associated_facility_and_infrastructure_licence_applications | OBJECTID |
| sa-power-generation | https://services.sarig.sa.gov.au/vector/renewable_energy_and_storage/wfs | renewable_energy_and_storage:power_generation___all | OBJECTID |
| nsw-current-mining-titles | https://public-gs.geoscience.nsw.gov.au/geoserver/ows | mining-and-exploration:titles_title_granted | tas_id |
| nsw-mining-title-applications | https://public-gs.geoscience.nsw.gov.au/geoserver/ows | mining-and-exploration:titles_title_applications | tas_id |
| nsw-major-operating-mines | https://public-gs.geoscience.nsw.gov.au/geoserver/ows | mineral-occurrence:mineral_occurrence_operating_mines | occurrence_id |

The SA pinning intentionally makes the currently sampled subset explicit. Recommended source names are **South Australia Major Mineral Mines**, **South Australia Mineral and Opal Exploration Licence Applications**, **South Australia Associated Facility and Infrastructure Licence Applications**, and **South Australia Power Generation Projects**. It does not claim that one selected tenement layer covers all tenements. Additional layers require separate explicit source contracts; the generic first-layer fallback must not silently broaden or switch scope.

Replace the old SA disable reason with: “Public WFS2 pages verified 2026-09-16; stable domain identity, field semantics, production canary and scheduled ingestion gates remain.”

Replace the NSW disable reason with: “Corrected public WFS2 layer verified 2026-09-16; field semantics, exact attribution/licence, production canary and scheduled ingestion gates remain.”

The national workbook endpoint is unchanged. Set its licence to **CC BY 4.0 International**, and its disable reason to: “2025 workbook read verified 2026-09-16; dedicated Consolidated sheet parsing, stable project identity, attribution exceptions and production canary gates remain.”

## Fields and evidence semantics

| Source | Verified useful fields | Interpretation |
|---|---|---|
| SA major mines | SITE_NO, PROJECT_NAME, OPERATING_COMPANY, PROJECT_STATUS, DEVELOPMENT_STATUS, PROJECT_DESCRIPTION, COMMODITIES, LOCATION, MINING_START_DATE | Operator is OPERATOR; mine start is historical operational context, not new procurement. Sample dates include empty values and Australian day/month/year strings. |
| SA mineral applications | APPLICATION_TYPE, FILE_REFERENCE, APPLICANTS, APPLICATION_RECEIVED_DATE, LOCATION, OUTCOME, OUTCOME_DATE, RESULTING_TENEMENT | Applicant is APPLICANT_HOLDER. Application received is lodgement evidence; outcome is separate. |
| SA petroleum applications | TENEMENT_NO, FILE_REFERENCE, APPLICANT, APPLICATION_DATE, DATE_TO, STATUS | Applicant is APPLICANT_HOLDER; application date is not commencement. |
| SA power | STATION_NAME, OWNER_DEVELOPER, TECHNOLOGY, FUEL_SOURCE, DEVELOPMENT_STATUS, SUBURB, SOURCE, COLLECTION_DATE, ESTIMATED_COMMERCIAL_OPERATION | Owner/developer is OWNER_PROPONENT. Collection date is publisher data collection, not a project event. Commercial operation is often a year/quarter string and remains text. |
| NSW titles | tas_id, title, holder, company, grant_date, expiry_date, last_renewed, resource, operation, location_distance | Holder/company fields do not prove delivery contractor. Grant, renewal and expiry retain distinct meanings. |
| NSW applications | tas_id, application, appl_code, appl_no, applicant, appl_date, resource, operation, location_distance | Applicant is APPLICANT_HOLDER. Preserve old lodgement dates. |
| NSW operating mines | occurrence_id, comm_type, operation, deposit_name, operation_state, number_of_mines | Undated operational context. No owner or contractor field is supplied. |

The shared identity/page helpers do not invent event dates or role labels. These source-specific role mappings still need integration/acceptance in the main normalizer before ingestion. Existing stored transport IDs require dry-run reconciliation before re-ingestion.

## National workbook correction

The 2025 workbook is **1,961,926 bytes**, fetched successfully in 814–845 ms during the initial reads. Its `Consolidated` sheet contains 433 source rows representing **432 unique Project + State keys**. Woodlawn Restart appears twice with equivalent values encoded as strings versus numbers. The dedicated parser merges that duplicate, checks for conflicting duplicate keys and returns 432 rows, including 21 records explicitly marked Completed.

Commodity tabs and `Critical minerals` repeat Consolidated content. `Completed Stage` is a longer historical series (117 rows) that overlaps current Consolidated records. The current source now selects **Consolidated only**. A separate historical completed-project source would need an explicit release/event identity; it is not silently mixed into the current source.

Project + State is a reviewed natural key, not a publisher-issued ID. Conflicting duplicates fail the read. Status and cost changes no longer produce a new ID. Year/quarter commercial-operation estimates remain source text/numbers and are not converted to invented daily event dates.

## Rights and attribution

- The [official SA service documentation](https://www.energymining.sa.gov.au/industry/geological-survey/products-and-services/map-viewers-databases-and-services/data-services) lists these services and specifies [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Retain Government of South Australia / Department for Energy and Mining attribution, licence link and transformation notice; review any dataset-specific exceptions before activation.
- The NSW [titles](https://data.nsw.gov.au/data/en/dataset/nsw-mining-titles), [applications](https://data.nsw.gov.au/data/en/dataset/nsw-exploration-and-mining-titles-applications) and [operating-mines](https://www.data.nsw.gov.au/data/dataset/nsw-major-operating-mines) catalogues establish official provenance. Catalogue Creative Commons Attribution labels do not establish the exact licence version or an approved attribution string. Resolve these before activation.
- The [2025 publication and workbook](https://www.industry.gov.au/publications/resources-and-energy-major-projects-2025) carry **CC BY 4.0 International**, verified directly in the workbook's About sheet and the [publication rights page](https://www.industry.gov.au/sites/default/files/2025-12/resources-and-energy-major-projects-2025.pdf). The workbook requests attribution to the Department of Industry, Science and Resources, Commonwealth of Australia, Resources and Energy Major Projects 2025. Retain its non-endorsement statement and exceptions for third-party material, logos, trademarks and the Coat of Arms. The older catalogue's CC BY 3.0 label should not override the supplied 2025 workbook notice.

Rights metadata review is not legal certification. Customer-facing attribution display and relevant exceptions remain acceptance work.

## Shared integration

`backend/source-helpers.ts` now exports:

- `RECOVERED_WFS_LAYERS`: exact verified layer names and order fields.
- `wfsPageUrl(source, offset, limit)`: pinned WFS2 URL; rejects conflicting configured layers and invalid bounds.
- `sourceWfsRows(sourceKey, features)`: domain IDs, duplicate/collision checks and identity quality flags.
- `sourceWfsPage(source, offset, limit, requestJson?)`: bounded fetch; returns `{ rows, next, completed }`. Cursor advances by transport features, not the deduplicated count.
- `projectRecordIdentity(sourceKey, raw)`: stable REMP Project/State ID, existing identity behavior for other workbooks.
- `projectWorkbookRows`: source-specific Consolidated selection for REMP.

Historical WFS/REMP paths in `backend/backfill-fetch.ts` use these helpers. Main collector integration requires these exact changes:

```typescript
// Extend the existing source-helpers import:
import { sourceWfsPage, RECOVERED_WFS_LAYERS, projectRecordIdentity } from './source-helpers';

// At the start of collectWfs:
if (RECOVERED_WFS_LAYERS[source.key] || /[?&]typeNames?=/i.test(source.endpoint)) {
  return (await sourceWfsPage(source, 0, 40)).rows;
}

// Replace collectWfsDirect body:
return (await sourceWfsPage(source, 0, 40)).rows;

// In the XLSX_PROJECT branch:
rows = rs.map(raw => ({ externalId: projectRecordIdentity(source.key, raw), raw }));
```

Preserve returned qualityFlags in canary reports and downstream review. Keep all sources disabled; successful samples do not clear promotion gates. Ordered offsets are bounded reads, not transactional snapshots.

## Tests and remaining acceptance

Eleven new recovery behavior tests witnessed failure before fixes, then passed for regenerated feature IDs, domain IDs, missing keys, natural-key review/collisions, explicit layer binding, duplicate-aware cursors, backfill routing, preservation of identity review flags, and workbook sheet/identity rules. The pilot suite remains 18 tests. Backend typecheck passed after implementation.

Remaining gates: main-normalizer date/role mapping, stored-ID reconciliation, natural-key change/collision review, exact rights/attribution, real-runtime canary, and observed scheduled ingestion. None is implied by a successful local source read.

## Live persistence restriction after an uncertain insert

The per-source opportunity index now stores an acknowledged `pendingAddIntent` containing the external IDs before any new opportunity is inserted. The final acknowledged index write stores returned database IDs and clears that intent. A partial add acknowledgement, add exception/quota error, or failed final index acknowledgement leaves the intent in place. Later refreshes stop with `OPPORTUNITY_PENDING_ADDS_RECONCILIATION_REQUIRED`; they do not repeat the adds. This favors a visible stopped source over duplicate physical rows. Source failure counters do not certify that no earlier writes occurred.

There is no automatic reconciliation or endpoint that clears this marker. A reviewed repair must enumerate the affected source's physical rows completely, map the intent's external IDs to confirmed database IDs, resolve any collisions and acknowledge the repaired index before resuming. The current SDK has no compare-and-swap operation, so one scheduled writer is required; the intent is a retry guard, not a concurrency lock. Existing duplicates are not deleted by this change.

Initial index discovery reads at most 100 index rows and two opportunity pages of 500 rows. If the source index is not found and the index list is truncated, or legacy opportunity discovery still has a continuation after 1,000 rows, bootstrap stops with `OPPORTUNITY_INDEX_RECONCILIATION_REQUIRED`. It cannot safely infer that an unobserved record is absent. A larger existing deployment therefore needs a separately reviewed, resumable index migration before scheduled ingestion; silently seeding an incomplete index is disallowed. Production quota/canary and scheduler acceptance remain outstanding; tests use an in-memory database only.