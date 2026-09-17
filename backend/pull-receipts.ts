import { randomUUID } from "node:crypto";
import { db } from "@appdeploy/sdk";
import { evidenceHoldReasons } from "./evidence-eligibility";
import {
  buildSourceContract,
  type RegistrySource,
  type RegistryContract,
} from "./registry-contracts";

type ReceiptRow = {
  externalId: string;
  sourceObservedAt?: string;
  contextOnly?: boolean;
  promotionEligible?: boolean;
  qualityFlags?: unknown;
};
export type PullInput = {
  source: RegistrySource;
  mode: "REFRESH" | "BACKFILL";
  startedAt: string;
  finishedAt?: string;
  received?: number | null;
  rows?: ReceiptRow[];
  acknowledged?: number;
  writeAttempted?: boolean;
  uncertain?: boolean;
  failure?: string;
  checkpoint?: { start: number; end: number | null; resource?: unknown };
};
function sourceDate(value: unknown, at: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value))
    return null;
  const time = Date.parse(value),
    day = Date.parse(value.slice(0, 10) + "T00:00:00.000Z");
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(day) ||
    time > Date.parse(at) ||
    time < Date.UTC(1900, 0, 1) ||
    new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    return null;
  return new Date(time).toISOString();
}
export function createPullReceipt(input: PullInput) {
  const rows = input.rows;
  const identities = rows ? new Set(rows.map((row) => row.externalId)) : null;
  const held = rows
    ? new Set(
        rows
          .filter((row) => evidenceHoldReasons(row).length)
          .map((row) => row.externalId),
      ).size
    : null;
  const dates =
    rows
      ?.map((row) =>
        sourceDate(row.sourceObservedAt, input.finishedAt || input.startedAt),
      )
      .filter((value): value is string => value !== null)
      .sort() || [];
  const writeCandidates = rows
    ? input.mode === "REFRESH"
      ? identities!.size
      : rows.length
    : null;
  const acknowledged = !input.finishedAt
    ? null
    : (input.acknowledged ?? (input.writeAttempted ? null : 0));
  if (
    acknowledged !== null &&
    (!Number.isSafeInteger(acknowledged) ||
      acknowledged < 0 ||
      (writeCandidates !== null && acknowledged > writeCandidates))
  )
    throw new Error("INVALID_PULL_ACKNOWLEDGEMENT");
  const http = /(?:HTTP_|HTTP_STATUS_)(\d{3})(?:\D|$)/.exec(
    input.failure || "",
  );
  const httpStatus = http ? Number(http[1]) : null;
  // These codes originate after response content reaches a collector/parser.
  // Keep the numeric HTTP status unknown unless it was actually recorded.
  const parserFailed =
    !httpStatus &&
    /(?:SCHEMA_(?:INVALID|REVIEW_REQUIRED)|INVALID_BODY|KML_(?:ZIP_|TITLE_DOMAIN|TITLE_IDENTITY|IDENTITY_|FIELD_|FEATURES_|TITLE_ROWS_|ROW_LIMIT))/.test(
      input.failure || "",
    );
  const challenge =
    httpStatus !== null && input.failure?.includes("PROVIDER_CHALLENGE");
  return {
    schemaVersion: 1 as const,
    sourceKey: input.source.key,
    contract: buildSourceContract(input.source),
    contractVersion: buildSourceContract(input.source).version,
    mode: input.mode,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt || null,
    outcome: !input.finishedAt
      ? ("RUNNING" as const)
      : input.failure
        ? ("FAILED" as const)
        : ("COMPLETED" as const),
    transport: {
      status: rows
        ? "RESPONSE_PARSED"
        : challenge
          ? "PROVIDER_CHALLENGE"
          : parserFailed
            ? "RESPONSE_RECEIVED"
            : httpStatus === 202
              ? "INCOMPLETE_RESPONSE"
              : httpStatus
                ? "HTTP_ERROR"
                : input.failure
                  ? "UNCLASSIFIED_FAILURE"
                  : "NOT_OBSERVED",
      httpStatus,
    },
    parser: rows
      ? rows.length
        ? "PARSED"
        : "EMPTY"
      : parserFailed
        ? "FAILED"
        : "NOT_OBSERVED",
    counts: {
      received: input.received ?? null,
      normalised: rows?.length ?? null,
      unique: identities?.size ?? null,
      duplicate: rows ? rows.length - identities!.size : null,
      held,
      writeCandidates,
      acknowledged,
      unacknowledged:
        input.uncertain || writeCandidates === null || acknowledged === null
          ? null
          : writeCandidates - acknowledged,
      uncertain: !input.finishedAt
        ? null
        : !input.uncertain
          ? 0
          : writeCandidates !== null && acknowledged !== null
            ? writeCandidates - acknowledged
            : null,
    },
    countBasis:
      "Received is the collector-reported count after any provider filtering; raw transport row totals may be unknown. Held and duplicates are subsets. Acknowledged rows may include held evidence and are not commercial promotions.",
    reconciliation: input.uncertain
      ? "REVIEW_REQUIRED"
      : !input.finishedAt
        ? "PENDING"
        : "COUNTS_RECORDED",
    dates: {
      dated: rows ? dates.length : null,
      undated: rows?.filter((row) => !row.sourceObservedAt).length ?? null,
      invalid: rows
        ? rows.filter(
            (row) =>
              row.sourceObservedAt &&
              !sourceDate(
                row.sourceObservedAt,
                input.finishedAt || input.startedAt,
              ),
          ).length
        : null,
      oldest: dates[0] || null,
      newest: dates.at(-1) || null,
      semantics: "SOURCE_DATE_UNVERIFIED",
    },
    checkpoint: input.checkpoint || null,
    failure: input.failure || null,
    persistenceUncertain: input.uncertain === true,
    lastAcknowledgedIngestion:
      acknowledged !== null && acknowledged > 0
        ? input.finishedAt || null
        : null,
  };
}
export type PullReceipt = ReturnType<typeof createPullReceipt> & {
  receiptId: string;
};
const tableFor = (key: string) => "source_pull_receipts:" + key;

function isSavedReceipt(
  value: unknown,
  sourceKey: string,
): value is PullReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as PullReceipt;
  const validCount = (value: unknown) =>
    value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  const validDate = (value: unknown) =>
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)));
  return (
    row.schemaVersion === 1 &&
    row.sourceKey === sourceKey &&
    typeof row.startedAt === "string" &&
    validDate(row.startedAt) &&
    validDate(row.finishedAt) &&
    ["REFRESH", "BACKFILL"].includes(row.mode) &&
    ["RUNNING", "COMPLETED", "FAILED"].includes(row.outcome) &&
    Boolean(row.counts) &&
    [
      "received",
      "normalised",
      "unique",
      "duplicate",
      "held",
      "writeCandidates",
      "acknowledged",
      "unacknowledged",
      "uncertain",
    ].every((key) => validCount(row.counts[key as keyof typeof row.counts])) &&
    Boolean(row.dates) &&
    validDate(row.dates.newest) &&
    validDate(row.dates.oldest) &&
    validCount(row.dates.dated) &&
    validCount(row.dates.undated) &&
    validCount(row.dates.invalid) &&
    Boolean(row.transport) &&
    typeof row.transport.status === "string" &&
    (row.transport.httpStatus === null ||
      (Number.isInteger(row.transport.httpStatus) &&
        row.transport.httpStatus >= 100 &&
        row.transport.httpStatus <= 599)) &&
    typeof row.parser === "string" &&
    typeof row.reconciliation === "string" &&
    typeof row.persistenceUncertain === "boolean" &&
    validDate(row.lastAcknowledgedIngestion)
  );
}

/** Persist intent before collection/writes; a crash leaves visible RUNNING/unknown outcome. */
export async function beginPull(input: PullInput) {
  const receipt = { ...createPullReceipt(input), receiptId: randomUUID() };
  const [id] = await db.add(tableFor(input.source.key), [receipt]);
  if (!id) throw new Error("PULL_RECEIPT_START_UNCERTAIN");
  return { id, receiptId: receipt.receiptId };
}
export async function finishPull(
  handle: { id: string; receiptId: string },
  input: PullInput,
) {
  const receipt = { ...createPullReceipt(input), receiptId: handle.receiptId };
  const [saved] = await db.update(tableFor(input.source.key), [
    { id: handle.id, record: receipt },
  ]);
  if (!saved) throw new Error("PULL_RECEIPT_SAVE_UNCERTAIN");
  return receipt;
}
export function deriveSourceHealth(
  contract: RegistryContract,
  receipt: PullReceipt | ReturnType<typeof createPullReceipt> | null,
) {
  return {
    transport: receipt?.transport || {
      status: "NOT_OBSERVED",
      httpStatus: null,
    },
    parser: receipt?.parser || "NOT_OBSERVED",
    rights: contract.rights.status,
    activation: contract.activation,
    eventDates: receipt?.dates.newest
      ? "SOURCE_DATES_PRESENT_SEMANTICS_UNVERIFIED"
      : "UNKNOWN",
    newestSourceDate: receipt?.dates.newest || null,
    freshness: "UNVERIFIED_CADENCE_AND_EVENT_SEMANTICS",
    ingestion: !receipt
      ? "NO_RECEIPT"
      : receipt.outcome === "RUNNING"
        ? "OUTCOME_NOT_CONFIRMED"
        : receipt.persistenceUncertain
          ? "RECONCILIATION_REQUIRED"
          : receipt.counts.acknowledged &&
              receipt.counts.acknowledged === receipt.counts.writeCandidates
            ? "ACKNOWLEDGED"
            : receipt.parser === "EMPTY"
              ? "NO_ROWS"
              : "NOT_FULLY_ACKNOWLEDGED",
    lastAcknowledgedIngestion: receipt?.lastAcknowledgedIngestion || null,
  };
}
export async function readPullHistory(
  source: RegistrySource,
  mode: "REGISTRY" | "HISTORICAL_ONLY",
  cursor?: string,
) {
  if (cursor && cursor.length > 4096) throw new Error("INVALID_RECEIPT_CURSOR");
  const page = await db.list<PullReceipt>(tableFor(source.key), {
    limit: 100,
    nextToken: cursor,
  });
  const receipts = page.items
    .filter((row) => isSavedReceipt(row, source.key))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const contract = buildSourceContract(source, mode);
  const health = deriveSourceHealth(contract, receipts[0] || null);
  health.lastAcknowledgedIngestion =
    receipts
      .map((row) => row.lastAcknowledgedIngestion)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;
  return {
    contract,
    receipts,
    health,
    nextCursor: page.nextToken || null,
    coverage: {
      complete:
        !cursor && !page.nextToken && receipts.length === page.items.length,
      returned: receipts.length,
      omittedInvalid: page.items.length - receipts.length,
      scope: "THIS_PAGE_ONLY",
    },
    disclosure:
      "Health describes the most recent receipt on this page, not job success or complete ingestion. Follow remaining pages to inspect other pulls. Runs before receipt support have no receipt. Source dates do not establish a new project event.",
  };
}
