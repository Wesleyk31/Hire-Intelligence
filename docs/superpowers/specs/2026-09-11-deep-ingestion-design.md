# Hirer Intelligence Deep Ingestion Design

## Goal
Replace shallow source sampling as the only population mechanism with bounded, checkpointed historical ingestion that continuously builds a provenance-preserving evidence lake while the existing live refresh continues to update current intelligence.

## Design
The existing 21-source live collector remains the current-signal path. A second backfill worker processes one source per invocation using a persistent per-source cursor and a bounded batch of up to 100 records. Paginated APIs use offsets; AusTender uses backward date windows; finite XLSX/KML sources use row offsets. Completed finite sources are skipped on later cycles.

Historical records are stored as compact evidence-page records rather than blindly promoted into the sales opportunity table. Each evidence event retains source key, external ID, project/title, company/holder, location, description, observed timestamp, provenance and EXPLICIT evidence class. This prevents historical backfill from flooding the Decision Desk while preserving data for future entity resolution and backtesting.

A persistent backfill control record rotates across sources. Source cursor records retain cursor position, records processed, completion state, last run and last error. A scheduled backfill job runs every 15 minutes; the live-source refresh remains hourly. Manual backfill execution and status are exposed in Source Admin.

## Safety and data-quality constraints
- Only sources already classified GREEN are backfilled.
- No historical evidence is automatically labelled CALL NOW.
- No contact, contractor, equipment requirement or commercial outcome is invented.
- Each cron invocation is bounded to one source and at most 100 evidence events.
- Evidence pages are kept below database item-size limits.
- Cursor state advances only after a page is persisted successfully.
- Failed source batches retain their cursor and error for retry.
- Live and historical ingestion are separate so historical work cannot block current-signal refresh.
