/** Offline review only: no SDK, network, database writer, marker clearing, or file writes. */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inventoryEvidence } from "./inventory-evidence.mjs";

const limits = {
  files: 64,
  bytes: 64 * 1024 * 1024,
  pages: 5000,
  rows: 100000,
  nesting: 64,
  indexBytes: 224 * 1024,
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) =>
  typeof value === "string" && value.length > 0 && value === value.trim();
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalHash = (row) => sha256(JSON.stringify(stable(row)));
const timestamp = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));

function decode(input) {
  if (
    !input ||
    !identifier(input.name) ||
    !(typeof input.bytes === "string" || Buffer.isBuffer(input.bytes))
  )
    throw new Error("Every input must supply a name and original UTF-8 bytes.");
  const bytes = Buffer.isBuffer(input.bytes)
    ? input.bytes
    : Buffer.from(input.bytes, "utf8");
  if (bytes.length > limits.bytes)
    throw new Error("Input exceeds the 64 MiB byte limit.");
  const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // Native JSON.parse accepts duplicate object keys; reject that ambiguous evidence before parsing.
  const stack = [];
  let previous;
  for (const match of json.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]/g)) {
    const token = match[0];
    if (token === "{" || token === "[") {
      stack.push(token === "{" ? new Set() : null);
      if (stack.length > limits.nesting)
        throw new Error("Input exceeds the 64-level JSON nesting limit.");
    } else if (token === "}" || token === "]") stack.pop();
    else if (token === ":" && stack.at(-1) instanceof Set) {
      const key = JSON.parse(previous);
      if (stack.at(-1).has(key)) throw new Error("Duplicate JSON key: " + key);
      stack.at(-1).add(key);
    }
    previous = token;
  }
  return {
    name: input.name,
    bytes: bytes.length,
    fileHash: sha256(bytes),
    data: JSON.parse(json),
  };
}

function pagesFor(input) {
  const pending = [input.data],
    pages = [];
  while (pending.length) {
    const data = pending.shift();
    if (object(data) && Array.isArray(data.pages)) {
      if (pending.length + pages.length + data.pages.length > limits.pages)
        throw new Error("Input exceeds the 5,000-page limit.");
      pending.unshift(...data.pages);
    } else pages.push({ file: input.name, page: pages.length, value: data });
    if (pending.length + pages.length > limits.pages)
      throw new Error("Input exceeds the 5,000-page limit.");
  }
  return pages;
}

function chainComplete(pages) {
  if (!pages.length) return false;
  const byCursor = new Map();
  for (const { value } of pages) {
    if (
      !object(value) ||
      !Object.hasOwn(value, "requestCursor") ||
      !Object.hasOwn(value, "nextCursor")
    )
      return false;
    const validCursor = (cursor) => cursor === null || identifier(cursor);
    if (
      !validCursor(value.requestCursor) ||
      !validCursor(value.nextCursor) ||
      byCursor.has(value.requestCursor)
    )
      return false;
    byCursor.set(value.requestCursor, value.nextCursor);
  }
  const visited = new Set();
  let cursor = null;
  while (byCursor.has(cursor) && !visited.has(cursor)) {
    visited.add(cursor);
    cursor = byCursor.get(cursor);
    if (cursor === null) return visited.size === pages.length;
  }
  return false;
}

/** Inputs are {name, bytes}; only caller-supplied bytes are inspected. Snapshot claims remain attestations. */
export function planEvidenceRepair(inputs, options = {}) {
  if (!identifier(options.sourceKey))
    throw new Error("An exact, non-empty sourceKey is required.");
  if (
    !Array.isArray(inputs) ||
    !inputs.length ||
    inputs.length + Number(!!options.indexExport) + Number(!!options.snapshot) >
      limits.files
  )
    throw new Error("Supply evidence files within the 64-file limit.");
  const evidence = inputs.map(decode),
    indexInput = options.indexExport ? decode(options.indexExport) : null,
    snapshotInput = options.snapshot ? decode(options.snapshot) : null;
  const allInputs = [
    ...evidence,
    ...(indexInput ? [indexInput] : []),
    ...(snapshotInput ? [snapshotInput] : []),
  ];
  if (allInputs.reduce((sum, input) => sum + input.bytes, 0) > limits.bytes)
    throw new Error("Inputs exceed the 64 MiB combined byte limit.");
  if (new Set(allInputs.map((input) => input.name)).size !== allInputs.length)
    throw new Error("Each supplied file name must be unique.");
  const pages = evidence.flatMap(pagesFor),
    indexPages = indexInput ? pagesFor(indexInput) : [];
  const rowCount = (page) =>
    Array.isArray(page.value)
      ? page.value.length
      : (page.value?.records ?? page.value?.items ?? page.value?.events)
          ?.length || 0;
  if (
    pages.length + indexPages.length > limits.pages ||
    [...pages, ...indexPages].reduce((sum, page) => sum + rowCount(page), 0) >
      limits.rows
  )
    throw new Error("Inputs exceed the 5,000-page or 100,000-row limit.");
  const blockers = [];
  const block = (code, detail, refs = []) =>
    blockers.push({ code, detail, refs });
  const snapshot = object(snapshotInput?.data) ? snapshotInput.data : {};
  const sourceKey = options.sourceKey;
  const now = options.now === undefined ? Date.now() : Date.parse(options.now);
  if (!Number.isFinite(now)) throw new Error("Use a valid --now timestamp.");
  if (
    !identifier(snapshot.snapshotId) ||
    !timestamp(snapshot.capturedAt) ||
    Date.parse(snapshot.capturedAt) > now ||
    !identifier(snapshot.reviewedBy) ||
    snapshot.writerState !== "PAUSED"
  ) {
    block(
      "UNREVIEWED_OR_UNSTABLE_SNAPSHOT",
      "A reviewed snapshot identifier, capture time, reviewer and PAUSED writer attestation are required. These claims cannot be verified offline.",
    );
  }
  const archivePage = (page) =>
    object(page.value) &&
    (page.value.origin === "ARCHIVE" || Object.hasOwn(page.value, "events"));
  const livePages = pages.filter((page) => !archivePage(page));
  if (!chainComplete(livePages))
    block(
      "INCOMPLETE_LIVE_COVERAGE",
      "The complete opportunities collection needs one unambiguous cursor chain from null to null.",
    );
  if (!chainComplete(indexPages))
    block(
      "INCOMPLETE_INDEX_COVERAGE",
      "The complete opportunity_indexes collection needs one unambiguous cursor chain from null to null.",
    );
  for (const page of [...livePages, ...indexPages]) {
    const value = page.value;
    if (
      !object(value) ||
      value.exportKind !== "FULL_STORAGE" ||
      !Array.isArray(value.records) ||
      Object.hasOwn(value, "items") ||
      Object.hasOwn(value, "events") ||
      (livePages.includes(page) && value.origin !== "LIVE")
    ) {
      block(
        "FULL_STORAGE_EXPORT_REQUIRED",
        "Review projections and unlocated arrays cannot establish complete original physical rows.",
        [{ file: page.file, page: page.page }],
      );
    }
    if (
      value?.snapshotId !== snapshot.snapshotId ||
      !identifier(value?.snapshotId)
    )
      block(
        "SNAPSHOT_ID_MISMATCH",
        "Each full-storage page must belong to the same reviewed snapshot.",
        [{ file: page.file, page: page.page }],
      );
    if (
      ["pageIssues", "issues"].some(
        (key) =>
          object(value) &&
          Object.hasOwn(value, key) &&
          (!Array.isArray(value[key]) || value[key].length),
      )
    )
      block(
        "EXPORT_PAGE_ISSUES",
        "Resolve reported export-page issues before proposing a repair.",
        [{ file: page.file, page: page.page }],
      );
  }
  function verifyCollection(name, selectedPages, selectedInputs) {
    const claim = snapshot.collections?.[name];
    if (
      !object(claim) ||
      claim.complete !== true ||
      !Number.isSafeInteger(claim.rowCount) ||
      claim.rowCount < 0
    ) {
      block(
        "INCOMPLETE_SNAPSHOT_ATTESTATION",
        "The snapshot must explicitly attest full collection coverage and an exact physical row count for " +
          name +
          ".",
      );
    }
    const actualRows = selectedPages.reduce(
      (sum, page) => sum + rowCount(page),
      0,
    );
    if (claim?.rowCount !== actualRows)
      block(
        "SNAPSHOT_COUNT_MISMATCH",
        name + " row count differs from the supplied snapshot attestation.",
      );
    const files = claim?.files;
    if (
      !Array.isArray(files) ||
      files.length !== selectedInputs.length ||
      new Set(files.map((file) => file?.name)).size !== files.length ||
      selectedInputs.some(
        (input) =>
          !files.some(
            (file) =>
              file?.name === input.name && file?.sha256 === input.fileHash,
          ),
      )
    ) {
      block(
        "SNAPSHOT_FILE_MISMATCH",
        name +
          " requires the exact names and SHA-256 file-byte hashes of every supplied collection export.",
      );
    }
  }
  verifyCollection(
    "opportunities",
    livePages,
    evidence.filter((input) =>
      livePages.some((page) => page.file === input.name),
    ),
  );
  verifyCollection(
    "opportunity_indexes",
    indexPages,
    indexInput ? [indexInput] : [],
  );

  const inventory = inventoryEvidence(
    evidence.map((input) => ({
      name: input.name,
      data: input.data,
      fileHash: input.fileHash,
    })),
    { now: new Date(now).toISOString() },
  );
  const live = [],
    byPhysicalId = new Map(),
    byIdentity = new Map();
  for (const page of livePages) {
    const values = Array.isArray(page.value?.records) ? page.value.records : [];
    values.forEach((row, rowIndex) => {
      const ref = {
        file: page.file,
        page: page.page,
        row: rowIndex,
        origin: "LIVE",
        storageId: row?.id ?? null,
        reviewId: identifier(row?.id) ? "LIVE:" + row.id : null,
        eventIndex: null,
      };
      if (
        !object(row) ||
        !identifier(row.id) ||
        !identifier(row.sourceKey) ||
        !identifier(row.externalId)
      ) {
        block(
          "INVALID_LIVE_IDENTITY",
          "Every physical row must retain exact non-empty id, sourceKey and externalId values without trimming or invented IDs.",
          [ref],
        );
        return;
      }
      if (
        (Object.hasOwn(row, "origin") && row.origin !== "LIVE") ||
        (Object.hasOwn(row, "storageId") && row.storageId !== row.id) ||
        (Object.hasOwn(row, "reviewId") && row.reviewId !== "LIVE:" + row.id) ||
        (Object.hasOwn(row, "eventIndex") && row.eventIndex !== null)
      ) {
        block(
          "AMBIGUOUS_STORAGE_REFERENCE",
          "Supplied storage references conflict with the full physical row ID.",
          [ref],
        );
      }
      const item = { row, ref, originalHash: originalHash(row) };
      const previous = byPhysicalId.get(row.id);
      if (previous)
        block(
          previous.row.sourceKey !== row.sourceKey ||
            previous.row.externalId !== row.externalId
            ? "PHYSICAL_IDENTITY_COLLISION"
            : "REPEATED_PHYSICAL_ROW",
          "One physical row ID appears more than once; export overlap or changed rows must be resolved.",
          [previous.ref, ref],
        );
      else byPhysicalId.set(row.id, item);
      live.push(item);
      if (row.sourceKey === sourceKey) {
        const group = byIdentity.get(row.externalId) || [];
        group.push(item);
        byIdentity.set(row.externalId, group);
      }
    });
  }
  for (const [externalId, group] of byIdentity)
    if (group.length > 1)
      block(
        "AMBIGUOUS_LIVE_IDENTITY",
        "Multiple live physical rows have external ID " +
          externalId +
          "; no preferred duplicate or revision is selected.",
        group.map((item) => item.ref),
      );
  if (!byIdentity.size)
    block(
      "NO_SOURCE_ROWS",
      "No located full-storage rows for the requested source are supplied.",
    );

  const indexEvidence = [],
    indexIds = new Set();
  for (const page of indexPages)
    for (const [rowIndex, row] of (Array.isArray(page.value?.records)
      ? page.value.records
      : []
    ).entries()) {
      const ref = { file: page.file, page: page.page, row: rowIndex };
      if (
        !object(row) ||
        !identifier(row.id) ||
        !identifier(row.sourceKey) ||
        !object(row.ids)
      ) {
        block(
          "INVALID_SOURCE_INDEX",
          "Every source-index record needs an exact physical ID, source key and ids object.",
          [ref],
        );
        continue;
      }
      if (indexIds.has(row.id))
        block(
          "AMBIGUOUS_INDEX_STORAGE_ID",
          "An index physical ID is repeated.",
          [ref],
        );
      indexIds.add(row.id);
      if (row.sourceKey === sourceKey)
        indexEvidence.push({
          ref,
          storageId: row.id,
          originalHash: originalHash(row),
          original: row,
          ...(Object.hasOwn(row, "pendingAddIntent")
            ? { pendingAddIntent: row.pendingAddIntent }
            : {}),
        });
    }
  if (indexEvidence.length > 1)
    block(
      "AMBIGUOUS_SOURCE_INDEX",
      "Multiple index records exist for the requested source.",
      indexEvidence.map((item) => item.ref),
    );
  const index = indexEvidence.length === 1 ? indexEvidence[0] : null;
  const previousIds = index?.original.ids || {};
  for (const [externalId, storageId] of Object.entries(previousIds)) {
    if (!identifier(externalId) || !identifier(storageId)) {
      block(
        "INVALID_INDEX_MAPPING",
        "Index mappings need exact non-empty external and physical IDs.",
        [index.ref],
      );
      continue;
    }
    const physical = byPhysicalId.get(storageId);
    if (!physical)
      block(
        "DANGLING_INDEX_MAPPING",
        "An existing mapping has no confirmed physical row; mappings are never silently dropped.",
        [index.ref],
      );
    else if (
      physical.row.sourceKey !== sourceKey ||
      physical.row.externalId !== externalId
    )
      block(
        "INDEX_IDENTITY_COLLISION",
        "An existing index mapping points to a different source identity.",
        [index.ref, physical.ref],
      );
  }
  const pendingIds = new Set();
  if (index && Object.hasOwn(index.original, "pendingAddIntent")) {
    const intent = index.original.pendingAddIntent;
    if (
      !object(intent) ||
      !Array.isArray(intent.externalIds) ||
      !intent.externalIds.length ||
      intent.externalIds.some((id) => !identifier(id)) ||
      new Set(intent.externalIds).size !== intent.externalIds.length ||
      !timestamp(intent.preparedAt) ||
      Date.parse(intent.preparedAt) > Date.parse(snapshot.capturedAt)
    ) {
      block(
        "INVALID_PENDING_INTENT",
        "The existing pending-add marker is ambiguous; preserve it and review its exact original representation.",
        [index.ref],
      );
    } else
      for (const externalId of intent.externalIds) {
        pendingIds.add(externalId);
        if (byIdentity.get(externalId)?.length !== 1)
          block(
            "PENDING_ID_UNRESOLVED",
            "Pending external ID " +
              externalId +
              " has no unique confirmed live row; it is not assumed absent or retried.",
            [index.ref],
          );
      }
  }
  const mappings = [...byIdentity]
    .filter(([, group]) => group.length === 1)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([externalId, [item]]) => ({
      externalId,
      previousStorageId: Object.hasOwn(previousIds, externalId)
        ? previousIds[externalId]
        : null,
      storageId: item.row.id,
      reason: Object.hasOwn(previousIds, externalId)
        ? "CONFIRMED_EXISTING"
        : pendingIds.has(externalId)
          ? "RECOVER_PENDING_ADD"
          : "DISCOVERED_PHYSICAL_ROW",
      evidence: { ref: item.ref, originalHash: item.originalHash },
    }));
  const ids = Object.fromEntries(
    mappings.map((item) => [item.externalId, item.storageId]),
  );
  if (
    Buffer.byteLength(JSON.stringify({ sourceKey, ids }), "utf8") >
    limits.indexBytes
  )
    block(
      "INDEX_CAPACITY_REVIEW_REQUIRED",
      "The proposed source index exceeds the persistence 224 KiB record bound.",
    );
  const preconditions = [
    {
      code: "REVIEW_PROPOSAL",
      requirement:
        "A human must review and separately authorize any later database repair. This proposal is never executable or applicable by itself.",
    },
    {
      code: "EXCLUSIVE_WRITER",
      requirement:
        "Establish and maintain a verified exclusive writer with all collectors paused during snapshot validation, any separately authorized repair and acknowledgement. The SDK offers no CAS or transaction lock.",
    },
    {
      code: "RECHECK_SNAPSHOT",
      requirement:
        "Verify complete current opportunities and opportunity_indexes collection coverage against this snapshot immediately before any repair; an offline PAUSED attestation is not a live guarantee.",
    },
    {
      code: "MATCH_ORIGINAL_HASHES",
      requirement:
        "Match current original physical row and index hashes and the exact pending marker to the reviewed originals. Any drift invalidates this proposal.",
    },
    {
      code: "PRESERVE_ROLLBACK",
      requirement:
        "Retain full original rows, original index and export file bytes, hashes and rollback references; do not delete historical evidence or physical duplicates.",
    },
    {
      code: "ACKNOWLEDGE_INDEX_BEFORE_RESUME",
      requirement:
        "Any separately implemented repair must acknowledge and read back the reviewed index mapping before an explicitly reviewed marker resolution and writer resume; this tool never clears pendingAddIntent.",
    },
  ];
  return {
    schemaVersion: 1,
    mode: "OFFLINE_REVIEW_ONLY",
    generatedAt: new Date(now).toISOString(),
    sourceKey,
    status: blockers.length ? "BLOCKED" : "REVIEW_REQUIRED",
    applicable: false,
    inputs: allInputs.map((input) => ({
      file: input.name,
      fileHash: input.fileHash,
      hashOrigin: "FILE_BYTES",
      bytes: input.bytes,
    })),
    snapshot: {
      file: snapshotInput?.name ?? null,
      fileHash: snapshotInput?.fileHash ?? null,
      attestation: snapshot,
      independentlyVerified: false,
    },
    coverage: {
      scope:
        "Supplied opportunities and opportunity_indexes full-collection snapshot attestations only; archive findings do not establish complete archive coverage.",
      liveRows: live.length,
      completeLiveChain: chainComplete(livePages),
      completeIndexChain: chainComplete(indexPages),
    },
    blockers,
    inventory,
    indexEvidence,
    proposal: blockers.length
      ? null
      : { sourceKey, indexStorageId: index?.storageId ?? null, ids, mappings },
    preconditions,
    limitations: [
      "No database, provider, credentials or network is accessed. No inputs or markers are changed.",
      "Snapshot completeness, paused writers and reviewer identity are supplied attestations, not independently established facts.",
      "Original row hashes cover canonical full-row JSON. Input file hashes cover exact bytes. Review projections cannot establish full original row contents.",
      "Historical revisions remain findings. No duplicate deletion, preferred revision, automatic retry, marker-clearing payload, or database apply operation is produced.",
    ],
    limits,
  };
}

const usage = `Usage: node scripts/plan-evidence-repair.mjs --source-key SOURCE [--snapshot manifest.json] [--indexes indexes.json] [--now ISO] FILE.json [FILE.json ...]
Offline JSON findings on stdout. No network, file writes, apply option, or marker clearing.
Exit 0: reviewable proposal; 1: blockers (JSON report); 2: invalid arguments/input (stderr).
`;
async function main(args) {
  const names = [],
    options = {};
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === "--help") {
      process.stdout.write(usage);
      return;
    }
    if (argument === "--") {
      names.push(...args.slice(i + 1));
      break;
    }
    if (
      ["--source-key", "--snapshot", "--indexes", "--now"].includes(argument)
    ) {
      const key = {
        "--source-key": "sourceKey",
        "--snapshot": "snapshot",
        "--indexes": "indexExport",
        "--now": "now",
      }[argument];
      const value = args[++i];
      if (!value || value.startsWith("--") || Object.hasOwn(options, key))
        throw new Error("Missing or repeated option: " + argument);
      options[key] = value;
      continue;
    }
    if (argument.startsWith("--"))
      throw new Error("Unknown option: " + argument);
    names.push(argument);
  }
  if (!identifier(options.sourceKey) || !names.length)
    throw new Error("Provide --source-key and explicit local evidence files.");
  const allNames = [
    ...names,
    ...[options.snapshot, options.indexExport].filter(Boolean),
  ];
  if (
    allNames.length > limits.files ||
    new Set(allNames.map((name) => resolve(name))).size !== allNames.length
  )
    throw new Error("Supply at most 64 distinct local files.");
  let byteCount = 0;
  async function load(name) {
    if (/^[a-z]+:\/\//i.test(name) || /^[\\/]{2}/.test(name))
      throw new Error("Only local file paths are accepted.");
    const info = await stat(resolve(name));
    byteCount += info.size;
    if (!info.isFile() || byteCount > limits.bytes)
      throw new Error(
        "Supply regular files within the 64 MiB combined byte limit.",
      );
    return { name, bytes: await readFile(resolve(name)) };
  }
  const inputs = [];
  for (const name of names) inputs.push(await load(name));
  if (options.snapshot) options.snapshot = await load(options.snapshot);
  if (options.indexExport)
    options.indexExport = await load(options.indexExport);
  const report = planEvidenceRepair(inputs, options);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.status === "BLOCKED") process.exitCode = 1;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }) + "\n",
    );
    process.exitCode = 2;
  });
