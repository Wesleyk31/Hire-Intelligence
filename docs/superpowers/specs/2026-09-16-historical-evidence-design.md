# Historical evidence integration design — 16 September 2026

Approved scope: continuation of the full-site audit and its NEXT_SCOPE.md, as requested by the user.

## Approach
Use a shared bounded read model over existing opportunities and evidence_pages. This fixes the disconnect immediately without duplicating the archive into a second mutable table. A separately materialised, globally indexed store is deferred until a transactional/indexed platform is available.

The alternatives were copying each archived row into opportunities (creates dual writes and needs atomic uniqueness that this SDK lacks) or reading the full archive on every request (unbounded cost). The bounded merged model is chosen for this phase.

## Behavior
- Dashboard and CRM project validation use the same merged evidence loader. The public current-feed summary remains current-feed only.
- Merge by the tuple sourceKey/externalId; select the latest valid source activity date, prefer current evidence on equal dates, then deterministic collection/revision tie breaks. Retain all archive versions physically.
- Archived records keep provenance, organisation role and sourceObservedAt; collection time cannot become activity time. Historical records use conservative WATCH defaults before normal intelligence classification.
- Default read bounds: 1,500 live rows, 1,500 archived event slots and 20 archive page records, with at most 10 archive API calls. Disclose truncation, malformed rows and duplicate suppression.
- No dashboard GET performs backfill or source collection. No feed activation or deployment is part of this local implementation.

## Persistence
- Pin CKAN resource and AusTender anchor before fetching page content, and persist that context before any archive writes.
- Split archive pages by actual UTF-8 JSON byte size, allowing 224 KiB per page (below the 256 KiB SDK item cap); write one chunk per call. Reject a single oversized record or a normalized batch exceeding 1 MiB before archive writes.
- Give chunks a stable checkpoint batch key and content hash. Preserve append-only evidence. Physical duplicate pages are possible after uncertain writes; the read model suppresses duplicate evidence. No claim of transactional exactly-once persistence.
- Check every cursor/control/page write acknowledgement. Never advance the cursor until every page chunk succeeds. Keep the checkpoint on ordinary failures; propagate database quota failures without hidden retry.
- Parallel distributed writers are not guaranteed by this SDK. Deployment acceptance must configure a single backfill writer or introduce a transactional store.

## Verification
Exercise actual route handlers, collectors and backfill with only fetch/database boundaries replaced. Cover archive-only project/CRM, duplicate and revised evidence, unknown dates, malformed/oversized pages, partial writes, failed checkpoint acknowledgement, CKAN publication change, frozen AusTender anchors and quota propagation. Browser coverage checks the user-visible archive/truncation disclosure and report language.

## Deferred dependencies
The approved image original is absent from the project; its existing decode failure remains open. Actual AppDeploy auth, database quotas/concurrency and production build require staging. No live storage is migrated or deleted.
