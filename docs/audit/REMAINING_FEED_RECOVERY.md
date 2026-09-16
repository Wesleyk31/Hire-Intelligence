# Remaining-feed investigation and bounded MODAT recovery

16 September 2026. Read-only official-source probes; no feed activation, database writes, licence acceptance or deployment.

## Result

Two parser failures are repaired locally: `nt-mines` and `nt-mineral-occurrences`. Both remain **disabled**, and every parsed row carries `CONTEXT_ONLY` and `SOURCE_RIGHTS_REVIEW_REQUIRED`. The [03:16 UTC collector audit](FEED_AUDIT_2026-09-16T03-16-23-762Z.md) confirms rows in the actual live and historical collectors. It does not establish scheduled ingestion or production acceptance.

| Feed | Verified cause and evidence | Status |
| --- | --- | --- |
| QLD granted resource authorities | Catalogue returned 200 at 03:08 UTC; the latest August workbook returned 202 in the final collector audit. Earlier catalogue requests also returned 202. | Provider access remains unresolved; do not treat 202 as data or fall back to an older period silently. |
| NT mineral titles | Catalogue works. ZIP download rejects XML-only Accept; accepting its actual MIME type returned 200. Compressed size 9,916,204 bytes; declared KML expansion 117,389,620 bytes. | Outside the 32MiB recovery bound. A scalable export and title-specific parser/identity review remain necessary. |
| NT petroleum/pipeline titles | Download returned 200, 7,587,155 bytes; expansion 26,394,009 bytes. 1,634 placemarks include title, release-block and regional/context schemas. | Disabled pending exact title-domain selection, identity/date semantics and ingestion checks. |
| NT geothermal titles | Download returned 200, 59,364 bytes; expansion 679,770 bytes. 114 placemarks; 35 distinct TITLEID values and 107 distinct UNIQ_ID values. | Disabled pending holder/multipart identity and date semantics. Counts alone cannot identify duplicates for deletion. |
| NT mines | Correct MIME returns ZIP, 17,174 bytes. Feature file has 61 placemarks; separate schema KML and icon are also present. | Actual collectors returned 40 live and 61 historical rows. Disabled with context/rights holds. |
| NT mineral occurrences | Correct MIME returns ZIP, 675,463 bytes. Feature file has 3,461 placemarks and expands 14,351,102 bytes; separate schema KML/icon are also present. | Actual collectors returned 40 live and the first 100 historical rows. Disabled with context/rights holds. |
| Stadiums Queensland July–December 2025 | The declared active datastore returns 200 with records `[]` and total `0`. The linked workbook returned 202 with `x-amzn-waf-action: challenge`, CloudFront, and zero bytes at 03:08 UTC. | Published datastore is empty. Whether the workbook contains omitted records remains unverified. No access-control workaround attempted. |

NT HTTP406 is at the linked resource download, **not the catalogue API**. The IIS response describes MIME negotiation. `application/zip` alone still fails because the provider serves `application/x-zip-compressed`; accepting that exact MIME type succeeds. The recovery sends the normal public-client user agent and the verified MIME type.

## Implementation and verification

- `backend/feed-recovery.ts` handles ZIP32 stored/deflated members using built-in Node zlib. No dependency was added. It checks central/local headers, member paths, duplicate names, overlapping members, CRC and actual decompression size; rejects encryption, unsupported formats, DTD/entity declarations and competing feature KML files. It never writes extracted files or follows network links.
- Bounds: existing 20-second request timeout and 25MiB download cap; 32MiB total declared expansion, a hard inflation output cap, 64 members and 20,000 rows. Large title archives are not routed through this recovery.
- Only the verified `MINESITES.kml` and `MINERALOCCURRENCES.kml` members supply records. Schema files and archive metadata never count as projects. `SimpleData` fields, descriptions and XML entities are retained/decoded. `MODAT_ID` replaces name/row-position identity. Missing or conflicting identifiers fail visibly.
- Live and historical collectors share the same parser. Historical continuation binds the normalized sorted record contents to a SHA-256 snapshot. Changed data or an old continued cursor without a snapshot requires an explicit reviewed restart; nothing rewinds automatically.
- Eleven regressions failed against the original implementation before the repair. Fifteen focused tests then passed, including live/historical parity, native IDs, MIME negotiation, review flags, malformed/ambiguous archives, expansion lies, encrypted data and changed continuation snapshots. Existing feed/source-field checks also passed: **37 tests across three files**. Backend TypeScript passed.

## Official references and remaining acceptance

The [NT mines catalogue](https://data.nt.gov.au/dataset/strike---northern-territory-mines) and [mineral occurrences catalogue](https://data.nt.gov.au/dataset/strike---northern-territory-mineral-occurrences) describe geological context compiled from reports and field work. Their [mines metadata](https://www.ntlis.nt.gov.au/metadata/export_data?type=html&metadata_id=FA9808BABD9D2375E040CD9B21442B6C) and [occurrences metadata](https://www.ntlis.nt.gov.au/metadata/export_data?type=html&metadata_id=FA9776DB9DFB9746E040CD9B2144298B) specify CC BY 4.0 with attribution to Northern Territory of Australia (Northern Territory Geological Survey), with exceptions where noted. The sampled mines production-comment field explicitly references S&P Global Market Intelligence. Commercial reuse of that included material therefore remains a review dependency; the transport repair does not resolve it.

Official title listings: [mineral titles](https://data.nt.gov.au/dataset/strike---northern-territory-mineral-titles), [petroleum and pipeline titles](https://data.nt.gov.au/dataset/strike---northern-territory-petroleum-and-pipeline-titles), [geothermal titles](https://data.nt.gov.au/dataset/strike---northern-territory-geothermal-title). The catalogues advertise Creative Commons Attribution; [geothermal metadata](https://www.ntlis.nt.gov.au/metadata/export_data?type=html&metadata_id=FB119D65BD6ACCF7E040CD9B214409BC) states Northern Territory Geological Survey acknowledgement. No published data dictionary was found on the consulted metadata pages; archive schemas are the observed field evidence, not an inferred activity-date contract.

The [Queensland granted-authorities catalogue](https://www.data.qld.gov.au/dataset/recently-granted-resource-authorities) advertises CC BY 4.0 and period reports when changes/approvals occur. The [Stadiums catalogue](https://www.data.qld.gov.au/dataset/stadiums-queensland-sq-contract-disclosure-july-to-december-2025) and existing API metadata point to the challenged workbook. Access must be resolved through a provider-supported route; absence of accessible rows is not proof of no contracts.

Before either repaired source is enabled: review third-party rights and attribution; reconcile prior name-based IDs to MODAT_ID under an exclusive writer; explicitly review any old KML cursor restart; verify real scheduled canaries and preservation of the context/rights holds. These records have no established project-activity dates and must not become demand alerts based on collection time.

Detailed technical receipts: [bounded probe metadata](REMAINING_FEED_PROBES.json) and [actual collector JSON](FEED_AUDIT_2026-09-16T03-16-23-762Z.json). Probes were sequential observations, not a simultaneous uptime measurement.
