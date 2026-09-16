# Data feed audit â€” 16 September 2026

## Results

All **70 source definitions** were probed: **53 enabled**, **13 disabled**, and **4 historical-only**. The enabled registry was not expanded or changed. Requests were read-only and bounded; no live ingestion, deletion or external account mutation was performed.

The initial complete probe returned rows from **51/53 enabled sources**. The final complete probe (09:31â€“09:32 Perth) returned rows from **49/53**: Queensland granted authorities errored, Stadiums Queensland was empty, and two WA live requests exceeded the 18-second audit timeout. WA Mining Tenements returned rows from the identical URL on the following historical request. This indicates intermittent availability.

| Group | Final live-collector result |
|---|---|
| 53 enabled | 49 ROWS, 3 ERROR, 1 EMPTY |
| 13 disabled | 5 ROWS, 8 ERROR; all remain disabled |
| 4 historical-only | 3 ROWS, 1 live-probe timeout; all four historical parsers returned rows |

See the [70-source table](FEED_AUDIT_2026-09-16T01-31-11-570Z.md) and adjacent JSON for timestamps, URLs, schemas and results. ROWS establishes parser output, not full dataset coverage or current opportunity activity. The audit queried five-row samples where supported; XLSX parsing required bounded workbooks.

## Persistent provider gaps

- **Queensland granted resource authorities:** the newest August workbook returns an empty HTTP 202 response. The checked active datastore was empty. Selecting an old month would conceal this failure.
- **Stadiums Queensland Julyâ€“December 2025 contracts:** active datastore contains zero records; workbook is also empty HTTP 202.
- **Five Northern Territory sources:** catalogue requests return HTTP 406.
- **Three NSW mining sources:** configured WFS type names fail. Replacement types returned features: titles_title_granted, titles_title_applications and mineral_occurrence_operating_mines, under the mining-and-exploration/mineral-occurrence namespaces. Keep disabled until mappings and ingestion are verified.
- **WA availability:** intermittent timeouts affected mining/tenement/exploration endpoints. Successful retries do not establish continuous reliability.

## Collector repairs made locally

- AEMO generation selects its real project worksheet/header instead of background/glossary rows.
- AEMO KCI uses exact stable IDs and the latest version per ID for live collection; history retains versions.
- Excel date conversion is explicit to AEMO date columns.
- ArcGIS identity matching recognises lower-case object IDs; fallback IDs are deterministic.
- CKAN selection orders publication resources correctly; metadata-only output cannot count as evidence.
- CKAN historical offsets retain the selected resource across batches/publication changes.
- AusTender follows provider pagination and retains a fixed date anchor across scheduler days.
- WFS capability parsing accepts namespace attributes; four disabled SA feeds now return real features.
- The disabled national Resources and Energy Major Projects workbook also parses.
- Melbourne newest-permit queries exclude future issue dates.
- Timeout covers response bodies; a 25 MiB limit is enforced while streaming.
- Unsupported historical adapters fail visibly; partial writes/degraded sources cannot be reported as complete success.

**Evidence:** 18 feed regression tests pass, including clock drift, resource switching, streaming limits and parser failures. A real read-only AusTender two-page check returned 100 + 100 rows.

## Remaining architecture work

1. Historical pages go into evidence_pages, but the dashboard reads opportunities. Archive completion does not establish dashboard coverage.
2. Live queries and the 1,500-evidence dashboard window are bounded. CKAN selects one historical resource; generic WFS selects a usable layer, not every publication/layer.
3. Missing upstream dates must remain unknown, not become fresh-demand alerts.
4. Parser changes do not remove old malformed AEMO/stale/duplicate production rows. Prepare a reviewable quarantine and re-ingestion migration first.
5. Offset datasets can change during collection. Snapshot/keyset designs, idempotent writes and replay reconciliation need broader platform work.
6. Monitor per-source quality and persistence; cron success alone is insufficient.

Candidate expansion is ranked in [NEW_SOURCE_RESEARCH.md](NEW_SOURCE_RESEARCH.md). No new feed was activated.
