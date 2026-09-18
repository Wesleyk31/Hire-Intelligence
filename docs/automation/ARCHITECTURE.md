# Automation architecture and data integrity

The existing application is a React/Vite frontend and an AppDeploy TypeScript backend. AppDeploy injects its private client/server SDKs and owns the managed document database. The backend's compiled `SOURCES`, `HISTORICAL_SOURCES`, collectors and existing source IDs remain the source definitions. GitHub workflows call restricted backend operations; they do not implement collectors, select arbitrary endpoints, store checkpoints in runner files, or connect directly to the database.

## Execution boundary

GitHub Actions provides the durable scheduling service. The backend verifies a short-lived GitHub OIDC identity bound to this repository, its immutable identity, main branch, permitted workflow, job, run ID, attempt and commit. The run receipt makes the same delivery idempotent. A completed receipt can replay its stored result; an incomplete receipt requires investigation and never repeats an ambiguous write automatically.

The installed AppDeploy SDK exposes no compare-and-swap operation, transaction, conditional insert or unique-key constraint. Database receipts and read-before-write checks are not distributed locks. **Every ingestion, checkpoint, registry and automation-report writer must be externally serialized.** The six workflows share the `hirer-production-automation` concurrency group, with `cancel-in-progress: false` and `queue: max`. One writer runs while up to 100 jobs wait; queue overflow cancels additional arrivals. Native AppDeploy refresh/backfill crons must be removed at cutover so they cannot write alongside GitHub Actions. Manual tools and other repositories do not participate in this GitHub concurrency group; do not use them as simultaneous production writers.

Logical singleton tables read two rows and fail when duplicate state exists. This exposes conflicting writers instead of silently choosing one record. Journal states and checked SDK acknowledgements protect resumability under partial failure; they do not upgrade the datastore's transaction guarantees.

## Additive persisted state

| State                                                                       | Purpose                                                                          | Existing data treatment                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `automation_schema`                                                         | Version 1 migration marker and application time                                  | Created once; unsupported versions fail closed                               |
| `automation_source:<source_id>`                                             | Registry, legal/technical review state, health observations and collection holds | Initialized from compiled source definitions; existing rows and IDs retained |
| `automation_run:<hash>`                                                     | One receipt per job/run/attempt/source                                           | Completed results are replayable; incomplete results require review          |
| `automation_report:<hash>`                                                  | QA, E2E, watchdog and aggregate health report journal                            | Report persistence can resume without overwriting a newer run                |
| `automation_job:<job>`                                                      | Latest run, success, failure count and details                                   | Missing observations remain missing rather than invented successes           |
| `archive_identity_migration`                                                | Resumable legacy evidence indexing checkpoint                                    | Reads existing evidence pages without rewriting them                         |
| `archive_identities:<source-hash>:<shard>`                                  | Bounded evidence fingerprints per source                                         | Added alongside legacy records; shards split when necessary                  |
| `archive_batch:<hash>`                                                      | Durable archive batch and acknowledgement journal                                | Prevents blind retries after ambiguous writes                                |
| Existing `backfill_cursors` and `backfill_control`                          | Per-source cursor, completion and round-robin progress                           | Existing cursors remain in use; optional metrics are additive                |
| Existing `evidence_pages`, `opportunities`, source states and pull receipts | Original evidence, active application records and diagnostics                    | Preserved; no wipe or reseed                                                 |

The schema check command parses TypeScript syntax trees. It validates required registry fields, schema version and lifecycle types; unique source identities across compiled catalogs; candidate key/type agreement; workflow/job/OIDC mapping; and the two additive migration functions. It rejects destructive database operations in automation/storage modules and migration writes aimed at existing checkpoint tables. It neither connects to production nor proves a live migration succeeded. Unit tests exercise migration idempotency and checkpoint preservation against an isolated SDK boundary.

## Backfill and evidence

A scheduled run processes one bounded provider page, or one bounded legacy identity-indexing step before new archive ingestion. Legacy indexing advances through at most one existing evidence page and 500 rows per run. New archive inserts wait until indexing is complete. During this phase, a successful maintenance run can legitimately report zero newly ingested evidence; that does not mean a source backfill is complete.

Backfill retains the source checkpoint until processing and required evidence writes are acknowledged. Every run records its before/after cursor, page/record/evidence counts, duplicate suppression, timestamps, retry count, completion and failure reason. Failures rotate through sources safely and do not reset an unrelated source's cursor. Unsupported or repeated pagination stops collection; an HTTP error is not an exhausted page.

Archive fingerprints exclude collection time while retaining factual source content, so retrieving unchanged evidence again does not manufacture a revision. Changed source evidence remains distinguishable. Publisher/dataset/source identifiers, URLs, publication or update dates when available, retrieval time, source text and structured fields remain provenance. Inferences never replace that evidence.

**Unique evidence, page and duplicate totals are measured from acknowledged automation runs since rollout.** Pre-rollout global unique counts are unknown. Legacy `processed` counts and source completion flags retain their original meaning; they must not be relabeled as verified all-time unique evidence. Bounded samples and indexing progress are disclosed separately.

## Source health and admission

Health records include source identity, state, check/success/failure timestamps, consecutive failures, reason, latency, schema version, source record timestamp, freshness status and individual checks. The checks cover accessibility, response type, schema, parser, authentication, pagination and freshness. Anything not supported by an actual observation is `NOT_VERIFIED`; HTTP reachability alone is not proof that every check passed. An ACTIVE legacy configuration is not a legal certification or a claim that its latest retrieval succeeded.

One retry is allowed for recognized transient source probe failures. Repeated failures and structural errors degrade health; structural schema/parser/pagination failures hold collection. Authentication, licence or access changes require review and block collection. Automatic health recovery cannot remove a disabled/rejected/admission hold. Disabled source configuration remains disabled, with its recorded reason.

Discovery enumerates only the compiled candidate catalog. The current legal approval map is deliberately empty. A useful URL, successful JSON response, existing metadata licence or validation request cannot authorize admission. Candidate activation requires a reviewed repository change containing actual authoritative-publisher, lawful machine-access, licence/attribution, rate-limit, freshness and reproducibility evidence, reviewer identity and an approved collection adapter. Candidate validation is separate from evidence ingestion. The controlled lifecycle is CANDIDATE → VALIDATING → VERIFIED → ACTIVE; incomplete or ambiguous checks remain REVIEW_REQUIRED or REJECTED with reasons. A verified candidate still awaits the separate activation transition and production collector wiring.

## Equipment inference and commercial controls

Equipment derived from project context remains `PREDICTED`. The automation does not invent quantities, exact models, rental duration, rates or customer intent. CALL NOW continues through the separately approved evidence gate; a high score, generic announcement or equipment inference alone is insufficient. Missing contact data remains missing. Any change to those commercial eligibility rules requires its own review and regression coverage.

See [workflow schedules and authentication](GITHUB_ACTIONS.md) and the [cutover and recovery runbook](OPERATIONS.md). None of this document's architecture descriptions assert that a particular deployment, production retrieval or scheduled run has succeeded; use stored observations and actual GitHub run results for operational status.
