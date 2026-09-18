import { afterEach, beforeEach, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  sequence: 0,
  failCursor: false,
  appendFailure: "" as "" | "unknown" | "rejected" | "quota",
  operations: [] as string[],
}));
vi.mock("@appdeploy/sdk", () => ({
  db: {
    list: async (table: string, options: any = {}) => {
      memory.operations.push("list:" + table);
      const rows = memory.tables[table] || [],
        start = Number(options.nextToken || 0);
      const end = start + (options.limit || 100);
      return {
        items: structuredClone(rows.slice(start, end)),
        nextToken: end < rows.length ? String(end) : undefined,
      };
    },
    get: async (table: string, ids: string[]) =>
      ids.map((id) =>
        structuredClone(
          memory.tables[table]?.find((row) => row.id === id) || null,
        ),
      ),
    add: async (table: string, rows: any[]) => {
      memory.operations.push("add:" + table);
      if (table === "evidence_pages" && memory.appendFailure === "quota")
        throw Object.assign(new Error("AppDatabaseQuotaExceeded"), {
          statusCode: 429,
        });
      if (table === "evidence_pages" && memory.appendFailure === "rejected") {
        memory.appendFailure = "";
        return rows.map(() => null);
      }
      const ids = rows.map((row) => {
        if (Buffer.byteLength(JSON.stringify(row)) > 256 * 1024)
          throw new Error("TEST_ITEM_TOO_LARGE");
        const id = String(++memory.sequence);
        (memory.tables[table] ||= []).push({ ...structuredClone(row), id });
        return id;
      });
      if (table === "evidence_pages" && memory.appendFailure === "unknown") {
        memory.appendFailure = "";
        throw new Error("CONNECTION_CLOSED_AFTER_COMMIT");
      }
      return ids;
    },
    update: async (table: string, updates: any[]) => {
      memory.operations.push("update:" + table);
      return updates.map(({ id, record }) => {
        if (
          table === "backfill_cursors" &&
          memory.failCursor &&
          record.cursor > 0
        ) {
          memory.failCursor = false;
          return false;
        }
        const rows = memory.tables[table] || [],
          index = rows.findIndex((row) => row.id === id);
        if (index < 0) return false;
        rows[index] = { ...structuredClone(record), id };
        return true;
      });
    },
  },
}));

import {
  getBackfillAutomationMetrics,
  runBackfillBatch,
} from "../../backend/backfill";
import {
  persistArchiveBatch,
  reconcileArchivePage,
} from "../../backend/archive-storage";
import {
  collectBackfillPage,
  normalizeEvidence,
  type BackfillSource,
} from "../../backend/backfill-fetch";

const source: BackfillSource = {
  key: "test-archive",
  territory: "WA",
  method: "ARCGIS",
  endpoint: "https://example.test/query",
  provenance: "https://example.test/dataset",
};
const row = (id: number, description = "Published bridge works") => ({
  externalId: String(id),
  raw: { objectid: id, name: "Bridge " + id, description, date: "2026-01-01" },
});
const evidence = (id: number, date = "2026-09-18T00:00:00Z") =>
  normalizeEvidence(source, row(id), date);
const feed = (rows: any[], more = false) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            features: rows.map((attributes) => ({ attributes })),
            exceededTransferLimit: more,
          }),
        ),
    ),
  );
const storedEvidence = () =>
  (memory.tables.evidence_pages || []).flatMap((page) => page.events);
beforeEach(() => {
  memory.tables = {};
  memory.sequence = 0;
  memory.failCursor = false;
  memory.appendFailure = "";
  memory.operations = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("persists current-run metrics and advances just one provider page per invocation", async () => {
  const offsets: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const offset = new URL(url).searchParams.get("resultOffset")!;
      offsets.push(offset);
      return new Response(
        JSON.stringify({
          features: [
            { attributes: { objectid: Number(offset) + 1, name: "Bridge" } },
          ],
          exceededTransferLimit: offset === "0",
        }),
      );
    }),
  );
  const first = await runBackfillBatch([source]);
  expect(first.run).toMatchObject({
    status: "SUCCESS",
    source_id: source.key,
    checkpoint_before: { cursor: 0 },
    checkpoint_after: { cursor: 1 },
    pages_processed: 1,
    records_processed: 1,
    evidence_processed: 1,
    duplicates_skipped: 0,
    retry_count: 0,
    source_completed: false,
    failure_reason: null,
  });
  const second = await runBackfillBatch([source]);
  expect(second.run).toMatchObject({
    status: "SUCCESS",
    checkpoint_before: { cursor: 1 },
    checkpoint_after: { cursor: 2 },
    source_completed: true,
  });
  expect(offsets).toEqual(["0", "1"]);
  const complete = await runBackfillBatch([source]);
  expect(complete.run.status).toBe("COMPLETE");
  expect(memory.tables.backfill_cursors[0].lastRunMetrics.completed_at).toEqual(
    expect.any(String),
  );
  expect(
    Object.values(memory.tables)
      .flat()
      .filter((record) => record.run_id && record.status === "SUCCESS"),
  ).toHaveLength(2);
});

it("reports the current successful source independently of another source historical failure", async () => {
  memory.tables.backfill_cursors = [
    {
      id: "old",
      sourceKey: "other",
      cursor: 70,
      processed: 70,
      completed: false,
      lastRun: "2026-09-17",
      lastError: "HTTP_503",
    },
  ];
  feed([{ objectid: 1, name: "Bridge" }]);
  const result = await runBackfillBatch([source, { ...source, key: "other" }]);
  expect(result.lastError).toContain("HTTP_503");
  expect(result.run.status).toBe("SUCCESS");
  expect(
    memory.tables.backfill_cursors.find(
      (record) => record.sourceKey === "other",
    ).cursor,
  ).toBe(70);
});

it("preserves the checkpoint and records a failed HTTP attempt without claiming a page was processed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  const result = await runBackfillBatch([source]);
  expect(result.run).toMatchObject({
    status: "FAILED",
    checkpoint_before: { cursor: 0 },
    checkpoint_after: { cursor: 0 },
    pages_processed: 0,
    records_processed: 0,
    evidence_processed: 0,
    source_completed: false,
  });
  expect(result.run.failure_reason).toContain("HTTP_503");
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
});

it("replays an acknowledged batch without appending evidence again after cursor rejection", async () => {
  memory.failCursor = true;
  feed([{ objectid: 1, name: "Bridge" }]);
  const failed = await runBackfillBatch([source]);
  expect(failed.run.status).toBe("FAILED");
  const retry = await runBackfillBatch([source]);
  expect(retry.run).toMatchObject({
    status: "SUCCESS",
    evidence_processed: 0,
    duplicates_skipped: 1,
    retry_count: 1,
  });
  expect(storedEvidence()).toHaveLength(1);
  expect(memory.tables.backfill_cursors[0].cursor).toBe(1);
});

it("suppresses identical evidence both within a page and on later pages while retaining changed facts", async () => {
  await persistArchiveBatch(source.key, 0, 2, [evidence(1), evidence(1)], {});
  const second = await persistArchiveBatch(
    source.key,
    2,
    4,
    [evidence(1, "2026-09-19"), evidence(2)],
    {},
  );
  expect(second).toMatchObject({
    acknowledgedRecords: 2,
    insertedRecords: 1,
    duplicatesSkipped: 1,
  });
  const changed = normalizeEvidence(
    source,
    row(1, "Publisher corrected the project description"),
    "2026-09-20",
  );
  await persistArchiveBatch(source.key, 4, 5, [changed], {});
  expect(storedEvidence()).toHaveLength(3);
  expect(storedEvidence().map((row) => row.description)).toContain(
    "Publisher corrected the project description",
  );
});

it("stops replay after an ambiguous append until the stored page is explicitly reconciled", async () => {
  memory.appendFailure = "unknown";
  await expect(
    persistArchiveBatch(source.key, 0, 1, [evidence(1)], {}),
  ).rejects.toThrow("CONNECTION_CLOSED_AFTER_COMMIT");
  await expect(
    persistArchiveBatch(source.key, 0, 1, [evidence(1)], {}),
  ).rejects.toThrow("EVIDENCE_RECONCILIATION_REQUIRED");
  expect(storedEvidence()).toHaveLength(1);
  expect(
    memory.operations.filter((item) => item === "add:evidence_pages"),
  ).toHaveLength(1);
  const persisted = memory.tables.evidence_pages[0];
  await expect(
    reconcileArchivePage(persisted.batchKey, 0, "missing"),
  ).rejects.toThrow("EVIDENCE_RECONCILIATION_MISMATCH");
  await reconcileArchivePage(persisted.batchKey, 0, persisted.id);
  const retry = await persistArchiveBatch(source.key, 0, 1, [evidence(1)], {});
  expect(retry).toMatchObject({
    acknowledgedRecords: 1,
    insertedRecords: 0,
    duplicatesSkipped: 1,
  });
  expect(storedEvidence()).toHaveLength(1);
});

it("refuses a provider batch that changes while its checkpoint is awaiting acknowledgement", async () => {
  await persistArchiveBatch(source.key, 0, 1, [evidence(1)], {});
  await expect(
    persistArchiveBatch(source.key, 0, 2, [evidence(2)], {}),
  ).rejects.toThrow("EVIDENCE_BATCH_CHANGED_REVIEW_REQUIRED");
  expect(storedEvidence().map((row) => row.externalId)).toEqual(["1"]);
});

it("does not classify a schema drift response as a successful empty page", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ rows: [] }))),
  );
  const result = await runBackfillBatch([source]);
  expect(result.run).toMatchObject({
    status: "FAILED",
    pages_processed: 0,
    source_completed: false,
    failure_reason: "ARCGIS_SCHEMA_INVALID",
  });
  expect(storedEvidence()).toHaveLength(0);
});

it("rejects an oversized provider page without advancing the checkpoint", async () => {
  feed(
    Array.from({ length: 101 }, (_, i) => ({ objectid: i, name: "Bridge" })),
    true,
  );
  const result = await runBackfillBatch([source]);
  expect(result.run).toMatchObject({
    status: "FAILED",
    pages_processed: 0,
    checkpoint_after: { cursor: 0 },
    failure_reason: "BACKFILL_PAGE_ROW_LIMIT",
  });
  expect(storedEvidence()).toHaveLength(0);
});

it("resumes legacy indexing within an old large page and leaves its evidence untouched", async () => {
  memory.tables.evidence_pages = [
    {
      id: "large-legacy",
      sourceKey: source.key,
      events: Array.from({ length: 501 }, (_, i) => evidence(i + 1)),
    },
  ];
  feed([
    {
      objectid: 501,
      name: "Bridge 501",
      description: "Published bridge works",
      date: "2026-01-01",
    },
  ]);
  const first = await runBackfillBatch([source]);
  expect(first.run.maintenance).toBe("ARCHIVE_IDENTITY_INDEX");
  expect(memory.tables.archive_identity_migration[0]).toMatchObject({
    complete: false,
    eventOffset: 500,
  });
  const second = await runBackfillBatch([source]);
  expect(second.run).toMatchObject({
    status: "SUCCESS",
    duplicates_skipped: 1,
    evidence_processed: 0,
  });
  expect(memory.tables.evidence_pages[0].events).toHaveLength(501);
});

it("retries an explicitly rejected append without duplicating earlier successful page parts", async () => {
  memory.appendFailure = "rejected";
  await expect(
    persistArchiveBatch(source.key, 0, 1, [evidence(1)], {}),
  ).rejects.toThrow("EVIDENCE_PAGE_SAVE_FAILED");
  const retry = await persistArchiveBatch(source.key, 0, 1, [evidence(1)], {});
  expect(retry.acknowledgedRecords).toBe(1);
  expect(storedEvidence()).toHaveLength(1);
});

it("does not hide or retry database quota errors", async () => {
  memory.appendFailure = "quota";
  feed([{ objectid: 1, name: "Bridge" }]);
  await expect(runBackfillBatch([source])).rejects.toThrow(
    "AppDatabaseQuotaExceeded",
  );
  expect(
    memory.operations.filter((item) => item === "add:evidence_pages"),
  ).toHaveLength(1);
  expect(memory.operations.at(-1)).toBe("add:evidence_pages");
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
});

it("indexes legacy archives in bounded resumable steps before inserting a duplicate", async () => {
  memory.tables.evidence_pages = [
    { id: "legacy1", sourceKey: source.key, events: [evidence(1)] },
    { id: "legacy2", sourceKey: source.key, events: [evidence(2)] },
  ];
  feed([
    {
      objectid: 1,
      name: "Bridge 1",
      description: "Published bridge works",
      date: "2026-01-01",
    },
  ]);
  const first = await runBackfillBatch([source]);
  expect(first.run).toMatchObject({
    status: "SUCCESS",
    pages_processed: 0,
    checkpoint_after: { cursor: 0 },
    maintenance: "ARCHIVE_IDENTITY_INDEX",
  });
  const second = await runBackfillBatch([source]);
  expect(second.run).toMatchObject({
    status: "SUCCESS",
    evidence_processed: 0,
    duplicates_skipped: 1,
  });
  expect(storedEvidence()).toHaveLength(2);
  expect(
    memory.operations.filter((item) => item === "list:evidence_pages"),
  ).toHaveLength(2);
});

it("preserves source evidence and supplied attribution without converting inferred claims to facts", () => {
  const result = normalizeEvidence(
    {
      ...source,
      owner: "Official publisher",
      datasetId: "dataset-7",
      licence: "CC BY 4.0",
      licenceUrl: "https://example.test/licence",
    },
    {
      ...row(1),
      raw: {
        ...row(1).raw,
        confidence: "SOURCE_REPORTED",
        inferenceStatus: "PREDICTED",
        nested: { quantity: 3 },
      },
    },
    "2026-09-18",
  );
  expect(result).toMatchObject({
    publisher: "Official publisher",
    dataset: "dataset-7",
    licence: "CC BY 4.0",
    licenceUrl: "https://example.test/licence",
    sourceUrl: source.provenance,
    sourceRecordId: "1",
    inferenceStatus: "PREDICTED",
    evidenceConfidence: "SOURCE_REPORTED",
    rawEvidence: { nested: { quantity: 3 } },
  });
});

it("preserves the complete OCDS release alongside the existing normalized fields", async () => {
  const release = {
    id: "release-1",
    ocid: "ocds-1",
    date: "2026-01-01",
    tender: {
      title: "Bridge tender",
      items: [{ id: "item-1", description: "Source-stated item" }],
    },
    parties: [{ id: "party-1", name: "Published party" }],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ releases: [release] }))),
  );
  const s = {
    ...source,
    method: "OCDS",
    endpoint: "https://example.test/releases",
  };
  const page = await collectBackfillPage(s, 0, undefined, {
    anchorAt: "2026-09-18T00:00:00Z",
  });
  expect(normalizeEvidence(s, page.rows[0], "2026-09-18").rawEvidence).toEqual(
    release,
  );
});

it("preserves geometry and feature metadata from an original ArcGIS feature", async () => {
  const feature = {
    attributes: { objectid: 1, name: "Published feature" },
    geometry: { x: 115.8, y: -31.9 },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ features: [feature] }))),
  );
  const result = await collectBackfillPage(source, 0);
  expect(
    normalizeEvidence(source, result.rows[0], "2026-09-18").rawEvidence,
  ).toEqual(feature);
});

it("preserves WFS feature IDs and original geometry alongside normalized attributes", async () => {
  const feature = {
    id: "feature.1",
    properties: { name: "Published feature" },
    geometry: { type: "Point", coordinates: [115.8, -31.9] },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ features: [feature], numberMatched: 1 })),
    ),
  );
  const s = {
    ...source,
    method: "WFS_DIRECT",
    endpoint: "https://example.test/wfs?typeNames=public:features",
  };
  const result = await collectBackfillPage(s, 0);
  expect(
    normalizeEvidence(s, result.rows[0], "2026-09-18").rawEvidence,
  ).toEqual({ features: [feature] });
});

it("reports stored automation totals without pretending legacy counts were unique inserts", async () => {
  memory.tables.backfill_cursors = [
    {
      id: "legacy-cursor",
      sourceKey: source.key,
      cursor: 99,
      processed: 99,
      completed: false,
      lastError: "",
      lastRun: "2026-01-01",
      customField: "preserved",
    },
  ];
  feed([{ objectid: 100, name: "Bridge" }]);
  await runBackfillBatch([source]);
  const metrics = await getBackfillAutomationMetrics([source]);
  expect(metrics).toMatchObject({
    records_processed: 100,
    evidence_processed: 1,
    pages_processed: 1,
    duplicates_skipped: 0,
    sources_completed: 1,
    sources_remaining: 0,
    last_run: { status: "SUCCESS" },
  });
  expect(memory.tables.backfill_cursors[0].customField).toBe("preserved");
  expect(metrics.sources).toEqual([
    expect.objectContaining({
      source_id: source.key,
      checkpoint: { cursor: 100, next_url: "", context: {} },
      completed: true,
      records_processed: 100,
      evidence_processed: 1,
      pages_processed: 1,
      duplicates_skipped: 0,
    }),
  ]);
});

it("keeps uninitialized source and aggregate backfill metrics unknown", async () => {
  const metrics = await getBackfillAutomationMetrics([source]);
  expect(metrics).toMatchObject({
    records_processed: null,
    evidence_processed: null,
    pages_processed: null,
    duplicates_skipped: null,
    last_backfill_run: null,
    last_run: null,
    sources_remaining: 1,
  });
  expect(metrics.sources).toEqual([
    {
      source_id: source.key,
      checkpoint: null,
      completed: null,
      records_processed: null,
      evidence_processed: null,
      pages_processed: null,
      duplicates_skipped: null,
      last_run: null,
    },
  ]);
});

it("reports the full legacy checkpoint without inventing rollout counters", async () => {
  memory.tables.backfill_cursors = [
    {
      id: "legacy-cursor",
      sourceKey: source.key,
      cursor: 14,
      processed: 57,
      nextUrl: "https://example.test/releases?page=2",
      context: { anchorAt: "2026-09-18T00:00:00Z" },
      completed: false,
      lastRun: "2026-09-17T00:00:00Z",
      lastError: "",
    },
  ];
  const before = structuredClone(memory.tables.backfill_cursors);
  const metrics = await getBackfillAutomationMetrics([source]);
  expect(metrics).toMatchObject({
    records_processed: 57,
    evidence_processed: null,
    pages_processed: null,
    duplicates_skipped: null,
  });
  expect(metrics.sources[0]).toEqual({
    source_id: source.key,
    checkpoint: {
      cursor: 14,
      next_url: "https://example.test/releases?page=2",
      context: { anchorAt: "2026-09-18T00:00:00Z" },
    },
    completed: false,
    records_processed: 57,
    evidence_processed: null,
    pages_processed: null,
    duplicates_skipped: null,
    last_run: null,
  });
  expect(memory.tables.backfill_cursors).toEqual(before);
});

it("distinguishes recorded zero rollout totals from missing source metrics", async () => {
  memory.tables.backfill_cursors = [
    {
      id: "recorded-zero",
      sourceKey: source.key,
      cursor: 0,
      processed: 0,
      completed: false,
      lastRun: "2026-09-18T00:00:00Z",
      lastError: "HTTP_503",
      automationTotals: { pages: 0, evidence: 0, duplicates: 0 },
    },
  ];
  const metrics = await getBackfillAutomationMetrics([
    source,
    { ...source, key: "uninitialized" },
  ]);
  expect(metrics).toMatchObject({
    records_processed: 0,
    evidence_processed: 0,
    pages_processed: 0,
    duplicates_skipped: 0,
  });
  expect(metrics.sources[0]).toMatchObject({
    checkpoint: { cursor: 0, next_url: "", context: {} },
    completed: false,
    records_processed: 0,
    evidence_processed: 0,
    pages_processed: 0,
    duplicates_skipped: 0,
  });
  expect(metrics.sources[1]).toMatchObject({
    checkpoint: null,
    completed: null,
    records_processed: null,
    evidence_processed: null,
    pages_processed: null,
    duplicates_skipped: null,
  });
});

it("does not borrow counters from an excluded source when reporting a subset", async () => {
  memory.tables.backfill_cursors = [
    {
      id: "outside-scope",
      sourceKey: "outside-scope",
      cursor: 200,
      processed: 200,
      completed: true,
      lastRun: "2026-09-18T00:00:00Z",
      lastError: "",
      automationTotals: { pages: 2, evidence: 200, duplicates: 0 },
    },
  ];
  const metrics = await getBackfillAutomationMetrics([source]);
  expect(metrics).toMatchObject({
    records_processed: null,
    evidence_processed: null,
    pages_processed: null,
    duplicates_skipped: null,
    sources_completed: 0,
    sources_remaining: 1,
  });
  expect(memory.tables.backfill_cursors[0].cursor).toBe(200);
});
