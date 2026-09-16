# Additional source research

Checked: 16 September 2026 (Australia/Perth). Research only: no feed was added, activated, deployed or scheduled.

## Recommendation

Implement a small, source-specific pilot for **Logan development applications** and **Queensland coordinated projects** first. Prepare the **Clean Energy Regulator project pipeline** adapter against its verified CSVs, but resolve the commercial-linking term before product activation. Run the WA EPA licence and NSW planning-data access work alongside that pilot. This is a recommendation, not evidence of production ingestion.

The seven ranked source families below were compared with `backend/index.ts`, including disabled sources. They are incremental to the registry read during this audit. The national roadworks source overlaps the existing WA and NSW feeds; its potential value is the other jurisdictions and historical snapshots, not another count of the same projects.

Readiness means suitable for adapter development with stated conditions. A successful public sample is not a production reliability, legal or data-quality certification.

| Rank | Source | Useful addition | Readiness |
|---|---|---|---|
| 1 | Logan undecided development applications | Current commercial building and warehouse applications, dated status evidence | Ready for an adapter pilot; investigate the upstream quality flag before promotion |
| 2 | Queensland coordinated projects | Major infrastructure/mining/energy assessment pipeline | Ready for a context adapter; no dated procurement trigger |
| 3 | CER committed and probable renewable projects | National investment-stage evidence, including WA | CSVs verified; commercial-linking term needs clarification |
| 4 | WA EPA significant proposals, DWER-120 | Named proponents and regulatory stages across major projects | Public sample verified; custom licence/active acceptance unresolved |
| 5 | NSW Online DA, CDC and PCC open-data family | Statewide building pipeline and later consent milestones | Official catalogues verified; Data Broker access path, no row sample |
| 6 | WA Major Resources Projects | Proposed/operating/care-and-maintenance project context | CC BY 4.0 catalogue; machine download/sample still needs validation |
| 7 | National harmonised roadworks and closures | Other-state coverage and historical roadwork observations | Public sample verified; reuse licence unresolved and overlap significant |

## 1. Logan City Council: undecided development applications

**Evidence.** The [official service](https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Logan_City_Undecided_Development_Applications/FeatureServer) describes nightly updates. Its [ArcGIS item](https://www.arcgis.com/sharing/rest/content/items/50489a44f46b45b5857bcc7f9aa95f20?f=json) states CC BY 3.0 Australia. Attribute Logan City Council, link the licence and record transformations. Council also identifies application data in its [planning tools documentation](https://www.logan.qld.gov.au/planning-and-building/planning-and-development/development-enquiry-tool).

**Sample.** Public JSON returned two ordinary rows and a separate three-row warehouse query. Examples: `MCUC/127/2026` (Warehouse), `MCUC/126/2026` (Warehouse x 3), `MCUI/60/2026` (Warehouse and Showroom), all in Slacks Creek. The service supports pagination; `dataLastEditDate` was `1789498043399`.

**Useful fields.** Application system ID/number/amendment, lodgement date, decision due date, status, description, development type, suburb, property key, coordinates and project link. Use `Application_Applicant` only as `APPLICANT_HOLDER`; an applicant may be an agent, trustee or individual. Do not label it a delivery contractor. Exclude private-person contact enrichment.

**Limitations.** Samples carried `fme_rejection_code=INVALID_INPUT`; its meaning is unverified. Preserve that flag and quarantine uncertain records before opportunity promotion. Nightly replacement may change OBJECTIDs; use application ID plus amendment and deduplicate multiple property rows. Preserve null dates; lodgement is not commencement. Filter small domestic applications from the commercial opportunity view.

Sample endpoint:

```text
https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Logan_City_Undecided_Development_Applications/FeatureServer/0/query?where=Application_Description%20like%20%27%25Warehouse%25%27&outFields=Application_Number,Application_Description,Application_Status,Application_Lodgement_Date,Application_Applicant,Application_Property_Suburb,fme_rejection_code&returnGeometry=false&resultRecordCount=3&orderByFields=Application_Lodgement_Date%20DESC&f=json
```

## 2. Queensland: coordinated projects

**Evidence.** The [official catalogue](https://www.data.qld.gov.au/dataset/coordinated-projects-the-coordinator-general) specifies [CC BY 3.0 Australia](https://creativecommons.org/licenses/by/3.0/au/). The supported [StatePlanning service](https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer/25) exposes the replacement layer. The old CoordinatedProjects service's notice gives a June 2026 decommissioning date. Attribute State of Queensland (State Development, Infrastructure and Planning), retain licence and change notices.

**Sample.** Three public current-project rows returned: Inland Rail - Gowrie to Helidon, Port of Gold Coast ocean-side terminal, and Burdekin Falls Dam Raising. Status enumeration returned Current/Completed EIS and Current/Completed IAR. Query/schema inspection succeeded without credentials.

**Useful fields.** `name`, `projectstatus`, `description`, `weblink`, `objectid` and geometry. Extract the URL from the HTML link and preserve the original. Use name + authoritative project URL for canonical matching rather than assuming OBJECTID is permanent.

**Cadence/provenance.** No dependable row event date or fixed update cadence was verified. Catalogue resource metadata dates are not approval dates. Missing organisation stays `UNKNOWN`; no contractor is supplied.

**Limitations.** Assessment completion is not construction completion or commencement. This is a WATCH/approval context source; it must not independently create a fresh call-now event. Some links are generic, and status freshness needs validation against the named project page.

Sample endpoint:

```text
https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer/25/query?where=projectstatus%20like%20%27Current%25%27&outFields=*&returnGeometry=false&resultRecordCount=3&f=json
```

## 3. Clean Energy Regulator: committed/probable renewable pipeline

**Evidence.** The [pipeline publication](https://cer.gov.au/markets/reports-and-data/large-scale-renewable-energy-data) says monthly publication; the inspected release is current to 31 July 2026. Separate [committed](https://cer.gov.au/document_page/power-station-projects-committed) and [probable](https://cer.gov.au/document_page/power-stations-projects-probable) CSV resources are available.

**Sample.** Both CSV requests returned HTTP 200. Committed: 2,410 bytes, with project/state/MW/fuel and commitment month. Probable: 3,454 bytes and 80 parsed rows; examples included Baldon Wind Farm (NSW) and Banana Range Wind Farm (QLD). Probable rows had no project event date or organisation. Strip the trailing space from the `State ` header and parse thousands separators in MW values.

**Rights gate.** The [copyright page](https://cer.gov.au/about-us/our-policies/copyright) applies CC BY 4.0 to most material, but also states a commercial-use restriction in its linking conditions. Clarify the intended commercial product use/linking before activation. For derived content its prescribed attribution is: “Based on Clean Energy Regulator material licensed under a Creative Commons Attribution 4.0 licence.” Retain the applicable notice and indicate changes.

**Interpretation.** Commitment month is investment evidence, not a work-start date. Probable status is not approval. Match to existing AEMO and EPBC projects; do not create duplicate projects or invent contractor names. Public announcements can be incomplete or revised retrospectively.

Verified resource URLs:

```text
https://cer.gov.au/document/power-stations-and-projects-committed
https://cer.gov.au/document/power-stations-and-projects-probable
```

## 4. WA EPA: referred significant proposals (DWER-120)

**Evidence.** The [official catalogue](https://catalogue.data.wa.gov.au/dataset/epa-referred-significant-proposals) links a public ArcGIS layer. Its [current CKAN metadata](https://catalogue.data.wa.gov.au/api/3/action/package_show?id=epa-referred-significant-proposals) reported **Custom (Active Acceptance)**, not CC BY. API resources are public; downloadable spatial files require a free SLIP account. Public reachability does not settle commercial reuse.

**Sample.** A two-row JSON query succeeded. Fields include proposal title/description, proponent, project/proposal/application numbers, assessment stage/number, decision date, ministerial/report numbers, proposal link, boundary status/type, activity label, area and creation date.

**Provenance.** Map `proponent` to `OWNER_PROPONENT`. `decision_date` is a decision date; `create_date` is a source creation date. The sample included null identifiers/dates and empty links. Separate multiple boundaries belonging to one proposal from separate project events.

**Cadence/limits.** Catalogue cadence was unknown; resource modification showed September 2026. The layer excludes proposals without boundaries. It includes historical decisions; neither feed refresh nor boundary creation proves a new hire requirement. The linked metadata TXT timed out at 25 seconds, so the custom terms were not resolved. Obtain/record the licence terms and required attribution before activation. DWER-103 pending proposals are government-use-only and are excluded.

Sample endpoint:

```text
https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Environment/MapServer/115/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json
```

## 5. NSW Planning Portal: Online DA / CDC / PCC data

**Evidence.** Official [DA](https://www.planningportal.nsw.gov.au/opendata/dataset/online-da-data-api), [CDC](https://www.planningportal.nsw.gov.au/opendata/dataset/online-cdc-data-api), and [PCC](https://www.planningportal.nsw.gov.au/opendata/dataset/online-pcc-data-api) catalogues describe daily feeds. These are distinct lifecycle datasets: applications, complying development certificates, and post-consent certificates. Coverage begins in 2019, with incomplete earlier council adoption before July 2021.

**Verified access state.** A live [DA package metadata request](https://www.planningportal.nsw.gov.au/opendata/api/3/action/package_show?id=online-da-data-api) succeeded. It supplied a data-quality document, an API data dictionary and `data.broker@environment.nsw.gov.au`, but no direct row endpoint. No email was sent, credentials requested, or council workflow API used. No row/schema sample was obtained; older public endpoint names should not be assumed supported.

**Rights/cadence.** Catalogue licence label is Creative Commons Attribution; confirm exact version and issued API agreement with the broker. CDC's catalogue gives attribution to the State Government and NSW Department of Planning, Housing and Infrastructure. Record the approved attribution verbatim when access is established.

**Adapter scope after access.** Verify stable application/certificate linkage, status, project description, development cost, location and distinct lodgement/determination/certificate dates against the supplied dictionary. These fields are requirements to validate, not claims that this audit sampled them. Certification is not a contractor award, and an applicant is not necessarily the builder.

## 6. WA Major Resources Projects, separate from full MINEDEX

**Evidence.** The [specific catalogue product](https://catalogue.data.wa.gov.au/en/dataset/major-resources-projects) is **CC BY 4.0** and describes proposed, operational, and care-and-maintenance projects above selection thresholds. It excludes petroleum fields. This is a separate product from full [MINEDEX DMIRS-001](https://catalogue.data.wa.gov.au/en/dataset/minedex-dmirs-001), whose catalogue states CC BY-NC 4.0; do not substitute the latter in a commercial app.

**Access.** [CKAN metadata](https://catalogue.data.wa.gov.au/api/3/action/package_show?id=major-resources-projects) succeeded and exposed a [DASC download landing page](https://dasc.dmirs.wa.gov.au/home?productAlias=MINEDEXMajorResProj) with CSV/SHP/KMZ/TAB/GDB formats. DASC documents automated download URLs and business-day nightly refreshes, but the linked URL document did not resolve through this browser session. A direct archive and row sample were not validated. Catalogue's old data timestamp conflicts with its daily cadence, so verify the actual archive timestamp.

**Next gate.** Resolve the official GDA2020 archive, inspect its embedded licence, dictionary, size and sample before writing an adapter. DASC says GDA94 outputs ceased in March 2026. Preserve the department's required source/derived attribution and licence notices.

**Value/limits.** Useful for mine/project identity, operating status and territory planning; it cannot supply a current shutdown, hire requirement, delivery contractor or a reliable project event date without additional evidence.

## 7. National Freight Data Hub: harmonised roadworks and closures

**Evidence.** The [official catalogue](https://catalogue.data.infrastructure.gov.au/dataset/harmonised-national-roadworks-and-road-closures) says daily updates and explicitly says **licence not specified**. Its [ArcGIS item](https://spatial.infrastructure.gov.au/portal/sharing/rest/content/items/95dc85472748470ebe9b93241756f5bb?f=json) contains a disclaimer and third-party material notice, but no positive reuse grant. Clarify redistribution rights and source attribution before activation.

**Sample.** Two default rows and two latest-snapshot rows returned JSON. Default rows were historical 2020 Queensland records. Sorting by capture date returned current September 2026 ACT observations, both hazards rather than roadwork. Fields include unique identifier, state, category/type, descriptions, planned start/end, actual from/to dates, modified/capture dates, source URL and vehicle access.

**Value/limits.** State-managed road coverage; Tasmania includes planned works only. Columns vary by jurisdiction. Filter genuine planned works, retain date meaning, and separate snapshot capture from a newly announced event. Deduplicate repeated snapshots by source ID and meaningful changes. Reconcile WA/NSW with existing feeds; use other states for incremental coverage. No contractor/owner role is supplied.

Sample endpoint:

```text
https://spatial.infrastructure.gov.au/server/rest/services/Hosted/RADAR_Curated_Prod_roadworks/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json
```

## Recommended next implementation scope

1. **Source contracts before activation.** Store exact licence/version/terms URL, required attribution, rights-review date, owning agency, resource version, pagination strategy and expected cadence. Separate metadata reachability, usable-row extraction and promotion health.
2. **Two-source pilot.** Build Logan and Queensland coordinated-project adapters with explicit field mappings and bounded deterministic pagination. Resolve Logan's quality flag; begin QLD coordinated data as context only. Preserve upstream IDs and project URLs; quarantine malformed rows and report exclusions.
3. **Evidence semantics.** Store `retrievedAt`, source last-modified time and labelled event dates separately. Preserve organisational roles and missing values. Never turn a fresh fetch into a fresh project event, an applicant into a contractor, or an EIS status into an awarded contract.
4. **Canonical matching.** Match on authoritative IDs/URLs and corroborated names/locations. Handle one application spanning several parcels and one proposal spanning multiple boundaries. Retain source-specific evidence after merging.
5. **Gated pipeline.** Develop CER CSV parsing fixtures now; resolve its linking term before launch. Pursue WA EPA custom-licence terms and NSW Data Broker access next. Revalidate WA Major Resources Projects archive and national roadworks rights after those higher-value gates.
6. **Acceptance evidence.** Test renamed/missing fields, null dates, HTML links/entities, decimal/thousands formats, duplicate parcels, changed OBJECTIDs, pagination, archived statuses and stale rows. Use production-runtime canary reads before enabling ingestion. Review a fixed commercial relevance sample and track useful new projects/qualified events, not just feed count.

### Shutdown and maintenance coverage

None of the above proves a planned plant shutdown. The [legacy AEMO WA outage directory](https://data.wa.aemo.com.au/public/public-data/datafiles/outages/) is historical through 2023, and [AEMO's historic-market documentation](https://developer-portal-prd.aemo.com.au/historic-markets) distinguishes reports that persist only for old data. It was not proposed as a live shutdown feed. A later bounded investigation should identify the current published outage product, future start/end times, facility/operator keys and redistribution terms; then cross-check against an official maintenance notice. An operating mine or reduced power availability alone must not become a shutdown opportunity.

### Procurement scope

The registry already has substantial Queensland disclosure coverage and AusTender contract notices. Additional generic contract directories would add overlap. The next procurement improvement should validate award/contractor role and start/end dates in existing sources, then seek an explicitly licensed current NSW/WA tender or forward-works export. No unverified portal scraper is recommended here.

## Audit limitations

All probes were public, read-only and bounded (typically two or three rows; small CER CSVs were downloaded to memory). Default sandbox networking was unavailable, so approved read-only external requests were used. An official page returning 403 was not bypassed. This report stores selected commercial project examples and schema facts, not personal contact data. Availability was measured from the audit environment on one day; production-region availability, sustained rate limits, complete coverage and legal interpretation remain unproven. No registry or application files were modified by this research task.
