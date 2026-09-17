import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CFB, utils, write } from "xlsx";
const memory = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  partial: false,
  failReceipt: false,
  failArchive: false,
}));
vi.mock("@appdeploy/sdk", () => ({
  router: (routes: unknown) => routes,
  requireAuth: () => "AUTH_REQUIRED",
  json: (body: unknown, statusCode = 200) => ({
    statusCode,
    body: JSON.stringify(body),
  }),
  error: (error: string, statusCode = 500) => ({
    statusCode,
    body: JSON.stringify({ error }),
  }),
  db: {
    list: async (table: string, options: any = {}) => {
      const rows = memory.tables[table] || [],
        start = Number(options.nextToken || 0),
        limit = options.limit || 100;
      return {
        items: structuredClone(rows.slice(start, start + limit)),
        nextToken:
          start + limit < rows.length ? String(start + limit) : undefined,
      };
    },
    add: async (table: string, rows: any[]) =>
      rows.map((row, index) => {
        if (table === "opportunities" && memory.partial && index > 0)
          return null;
        const id = table + ":" + (memory.tables[table] || []).length;
        (memory.tables[table] ||= []).push({ ...structuredClone(row), id });
        if (table === "evidence_pages" && memory.failArchive) return null;
        return id;
      }),
    update: async (table: string, rows: any[]) =>
      rows.map(({ id, record }) => {
        if (table.startsWith("source_pull_receipts:") && memory.failReceipt)
          return false;
        const found = memory.tables[table]?.find((row) => row.id === id);
        if (!found) return false;
        Object.assign(found, structuredClone(record));
        return true;
      }),
  },
}));
import {
  SOURCES,
  HISTORICAL_SOURCES,
  runSource,
  handler,
} from "../../backend/index";
import { buildSourceContract } from "../../backend/registry-contracts";
import {
  createPullReceipt,
  deriveSourceHealth,
} from "../../backend/pull-receipts";
import { runBackfillBatch } from "../../backend/backfill";

it("keeps unobserved and interrupted pull counts unknown", () => {
  const receipt = createPullReceipt({
    source,
    mode: "REFRESH",
    startedAt: receiptInput.startedAt,
  });
  expect(receipt.counts).toMatchObject({
    received: null,
    normalised: null,
    held: null,
    acknowledged: null,
    uncertain: null,
  });
  expect(receipt.dates).toMatchObject({
    dated: null,
    undated: null,
    invalid: null,
  });
});

it("separates received but rejected schemas from HTTP challenges", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ error: { message: "Schema changed" } })),
  );
  await runSource(source);
  const [receipt] = memory.tables["source_pull_receipts:synthetic-receipt"];
  expect(receipt).toMatchObject({
    parser: "FAILED",
    transport: { status: "RESPONSE_RECEIVED", httpStatus: null },
    failure: "ARCGIS_SCHEMA_INVALID",
    counts: { received: null },
  });
  expect(
    createPullReceipt({
      ...receiptInput,
      failure: "HTTP_202:PROVIDER_CHALLENGE",
    }),
  ).toMatchObject({
    parser: "NOT_OBSERVED",
    transport: { status: "PROVIDER_CHALLENGE", httpStatus: 202 },
  });
});

it("excludes malformed saved receipts and discloses that the history is incomplete", async () => {
  const known = SOURCES[0];
  memory.tables["source_pull_receipts:" + known.key] = [
    {
      schemaVersion: 1,
      sourceKey: known.key,
      startedAt: "2026-09-18T00:00:00.000Z",
    },
  ];
  const route = (handler as unknown as Record<string, any[]>)[
    "GET /api/sources/:key/health"
  ].at(-1);
  const result = JSON.parse(
    (await route({ params: { key: known.key }, query: {} })).body,
  );
  expect(result).toMatchObject({
    receipts: [],
    coverage: { complete: false, omittedInvalid: 1 },
    health: { parser: "NOT_OBSERVED" },
  });
});

beforeEach(() => {
  memory.tables = {};
  memory.partial = false;
  memory.failReceipt = false;
  memory.failArchive = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const source = {
  key: "synthetic-receipt",
  name: "Synthetic source",
  owner: "QA",
  territory: "WA",
  sector: "Infrastructure",
  licence: "Unknown",
  method: "ARCGIS" as const,
  endpoint: "https://example.test/source",
  provenance: "https://example.test/catalogue",
};
const respond = (status = 200) =>
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          features: [
            { attributes: { OBJECTID: 1, name: "Synthetic bridge" } },
            { attributes: { OBJECTID: 2, name: "Synthetic depot" } },
          ],
          exceededTransferLimit: false,
        }),
        { status },
      ),
  );
const receiptInput = {
  source,
  mode: "REFRESH" as const,
  startedAt: "2026-09-18T00:00:00.000Z",
  finishedAt: "2026-09-18T00:01:00.000Z",
};

it("keeps all 70 contracts versioned without granting unknown rights or activating held sources", () => {
  const contracts = [
    ...SOURCES.map((s) => buildSourceContract(s)),
    ...HISTORICAL_SOURCES.map((s) => buildSourceContract(s, "HISTORICAL_ONLY")),
  ];
  expect(contracts).toHaveLength(70);
  expect(new Set(contracts.map((c) => c.key)).size).toBe(70);
  expect(
    contracts.every(
      (c) =>
        c.version.length === 64 &&
        c.cadence.publisher === "UNKNOWN" &&
        c.allowedUses.commercial === "REVIEW_REQUIRED",
    ),
  ).toBe(true);
  const held = buildSourceContract({
    ...source,
    enabled: false,
    disableReason: "Rights hold",
  });
  expect(held).toMatchObject({
    activation: "DISABLED",
    activationReason: "Rights hold",
    rights: { status: "UNKNOWN" },
    dates: { eventSemantics: "UNVERIFIED" },
  });
  expect(
    buildSourceContract({
      ...source,
      endpoint: "https://example.test/replacement",
    }).version,
  ).not.toBe(buildSourceContract(source).version);
});

it("reconciles duplicates and held subsets while keeping partial write uncertainty explicit", () => {
  const receipt = createPullReceipt({
    ...receiptInput,
    received: 4,
    rows: [
      { externalId: "a", sourceObservedAt: "2026-09-17" },
      { externalId: "a", contextOnly: true },
      { externalId: "b", sourceObservedAt: "2020-01-01" },
      {
        externalId: "c",
        sourceObservedAt: "2026-02-30",
        qualityFlags: ["SCHEMA_HOLD"],
      },
    ],
    acknowledged: 1,
    writeAttempted: true,
    uncertain: true,
    failure: "WRITE_UNKNOWN",
  });
  expect(receipt.counts).toEqual({
    received: 4,
    normalised: 4,
    unique: 3,
    duplicate: 1,
    held: 2,
    writeCandidates: 3,
    acknowledged: 1,
    unacknowledged: null,
    uncertain: 2,
  });
  expect(receipt.dates).toMatchObject({
    dated: 2,
    undated: 1,
    invalid: 1,
    newest: "2026-09-17T00:00:00.000Z",
  });
  expect(receipt.reconciliation).toBe("REVIEW_REQUIRED");
});

it("never converts 202, 406, empty or missing receipts into successful fresh evidence", () => {
  const contract = buildSourceContract(source);
  expect(deriveSourceHealth(contract, null).parser).toBe("NOT_OBSERVED");
  for (const status of [202, 406]) {
    const receipt = createPullReceipt({
      ...receiptInput,
      failure: `HTTP_${status}`,
    });
    expect(receipt.counts.received).toBeNull();
    expect(receipt.transport).toMatchObject({
      status: status === 202 ? "INCOMPLETE_RESPONSE" : "HTTP_ERROR",
      httpStatus: status,
    });
    expect(
      deriveSourceHealth(contract, receipt).lastAcknowledgedIngestion,
    ).toBeNull();
  }
  const empty = createPullReceipt({
    ...receiptInput,
    rows: [],
    received: 0,
    acknowledged: 0,
    writeAttempted: false,
  });
  expect(deriveSourceHealth(contract, empty)).toMatchObject({
    parser: "EMPTY",
    eventDates: "UNKNOWN",
    ingestion: "NO_ROWS",
  });
});

it("records a partial refresh receipt before exposing confirmed saves and refuses to hide receipt acknowledgement failure", async () => {
  respond();
  memory.partial = true;
  const result = await runSource(source);
  expect(result).toMatchObject({
    status: "FAILED",
    opportunitiesPromoted: 1,
    persistenceUncertain: true,
  });
  const [receipt] = memory.tables["source_pull_receipts:synthetic-receipt"];
  expect(receipt).toMatchObject({
    mode: "REFRESH",
    outcome: "FAILED",
    counts: { normalised: 2, acknowledged: 1, uncertain: 1 },
    reconciliation: "REVIEW_REQUIRED",
  });
  expect(
    memory.tables.opportunity_indexes[0].pendingAddIntent.externalIds,
  ).toHaveLength(2);
  memory.tables = {};
  memory.partial = false;
  memory.failReceipt = true;
  await expect(runSource(source)).rejects.toThrow(
    "PULL_RECEIPT_SAVE_UNCERTAIN",
  );
  expect(
    memory.tables["source_pull_receipts:synthetic-receipt"][0].outcome,
  ).toBe("RUNNING");
  expect(memory.tables.source_states).toBeUndefined();
});

it("persists backfill page receipts and does not replace provider failures with zero fetched rows", async () => {
  respond();
  await runBackfillBatch([source]);
  expect(
    memory.tables["source_pull_receipts:synthetic-receipt"][0],
  ).toMatchObject({
    mode: "BACKFILL",
    counts: { normalised: 2, acknowledged: 2 },
    checkpoint: { start: 0, end: 2 },
  });
  memory.tables = {};
  respond(406);
  await runSource(source);
  expect(
    memory.tables["source_pull_receipts:synthetic-receipt"][0],
  ).toMatchObject({
    transport: { httpStatus: 406 },
    counts: { received: null, acknowledged: 0 },
  });
});

it("serves all contracts and paged receipt history through authenticated read-only handlers", async () => {
  const routes = handler as unknown as Record<string, any[]>;
  expect(routes["GET /api/sources/contracts"][0]).toBe("AUTH_REQUIRED");
  expect(routes["GET /api/sources/:key/health"][0]).toBe("AUTH_REQUIRED");
  const contracts = JSON.parse(
    (await routes["GET /api/sources/contracts"].at(-1)({})).body,
  );
  expect(contracts.contracts).toHaveLength(70);
  const route = routes["GET /api/sources/:key/health"].at(-1);
  const result = await route({ params: { key: SOURCES[0].key }, query: {} });
  expect(JSON.parse(result.body)).toMatchObject({
    receipts: [],
    coverage: { complete: true },
    health: { parser: "NOT_OBSERVED" },
  });
  expect(memory.tables).toEqual({});
  expect(
    (await route({ params: { key: "unknown" }, query: {} })).statusCode,
  ).toBe(404);
});

it("pins the Stadiums workbook before an ambiguous archive write so retries cannot switch identity domain", async () => {
  const source = SOURCES.find(
    (row) => row.key === "qld-stadiums-contracts-jul-dec-2025",
  )!;
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ["Contract reference number", "Contract description/name"],
      ["SQ2025-1", "Synthetic roof repairs"],
    ]),
    "Contracts",
  );
  const bytes = write(book, { type: "buffer", bookType: "xlsx" });
  let datastorePopulated = false;
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const json = (body: unknown) => new Response(JSON.stringify(body));
    if (String(input).includes("package_show"))
      return json({
        success: true,
        result: {
          resources: [
            {
              id: "045ac29a-ae16-4e08-82c8-3618500ec5bf",
              format: "XLSX",
              datastore_active: true,
              url: "https://example.test/july-december-2025.xlsx",
            },
          ],
        },
      });
    if (String(input).includes("datastore_search"))
      return json({
        success: true,
        result: {
          total: datastorePopulated ? 1 : 0,
          records: datastorePopulated
            ? [
                {
                  _id: 1,
                  "Contract reference number": "SQ2025-1",
                  "Contract description/name": "Synthetic roof repairs",
                },
              ]
            : [],
        },
      });
    return new Response(bytes);
  });
  memory.failArchive = true;
  await runBackfillBatch([source]);
  expect(memory.tables.backfill_cursors[0]).toMatchObject({
    cursor: 0,
    processed: 0,
    context: { ckanResource: { datastore_active: false } },
  });
  expect(memory.tables["source_pull_receipts:" + source.key][0]).toMatchObject({
    counts: { acknowledged: 0, uncertain: 1 },
    persistenceUncertain: true,
  });
  memory.failArchive = false;
  datastorePopulated = true;
  await runBackfillBatch([source]);
  expect(
    memory.tables.evidence_pages.flatMap((page) =>
      page.events.map((row: any) => row.externalId),
    ),
  ).toEqual(["SQ2025-1", "SQ2025-1"]);
  expect(memory.tables.backfill_cursors[0]).toMatchObject({
    cursor: 1,
    processed: 1,
    completed: true,
  });
});

it("pins the initial KML snapshot even when the first archive acknowledgement is lost", async () => {
  const source = SOURCES.find((row) => row.key === "nt-geothermal-titles")!;
  let holder = "Synthetic holder";
  vi.stubGlobal("fetch", async (input: string | URL) => {
    if (String(input).includes("package_show"))
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            resources: [
              { format: "KML", url: "https://example.test/geothermal.zip" },
            ],
          },
        }),
      );
    const zip = CFB.utils.cfb_new();
    const fields = {
      TITLEID: "GEP33024",
      UNIQ_ID: "497543",
      SW_MEMBER: "338564",
      TI_TYPE_CD: "GEP",
      TI_NUMBER: "33024",
      STATUS: "Current",
      TS_TYPE: "Grant",
      PTY_NAME: holder,
      HLD_TY_CD: "A",
      PCT: "100",
    };
    CFB.utils.cfb_add(
      zip,
      "NT_GeothermalTitles_kml.kml",
      Buffer.from(
        '<kml><Document><Placemark><ExtendedData><SchemaData schemaUrl="#kml_schema_ft_GEOTH_TITLE_EXPL_GRNT">' +
          Object.entries(fields)
            .map(
              ([name, value]) =>
                `<SimpleData name="${name}">${value}</SimpleData>`,
            )
            .join("") +
          "</SchemaData></ExtendedData></Placemark></Document></kml>",
      ),
    );
    return new Response(
      Buffer.from(
        CFB.write(zip, { type: "buffer", fileType: "zip", compression: true }),
      ),
    );
  });
  memory.failArchive = true;
  await runBackfillBatch([source]);
  expect(memory.tables.backfill_cursors[0].context.kmlSnapshot).toMatch(
    /^[a-f0-9]{64}$/,
  );
  holder = "Changed synthetic holder";
  memory.failArchive = false;
  const result = await runBackfillBatch([source]);
  expect(result.lastError).toContain("KML_SNAPSHOT_CHANGED");
  expect(memory.tables.evidence_pages).toHaveLength(1);
  expect(memory.tables.backfill_cursors[0]).toMatchObject({
    cursor: 0,
    processed: 0,
    completed: false,
  });
});

it("retains the last acknowledged ingestion when a later pull fails and discloses incomplete history", async () => {
  const known = SOURCES[0];
  const saved = createPullReceipt({
    ...receiptInput,
    source: known,
    rows: [{ externalId: "saved" }],
    received: 1,
    acknowledged: 1,
    writeAttempted: true,
  });
  const failed = createPullReceipt({
    ...receiptInput,
    source: known,
    startedAt: "2026-09-18T01:00:00.000Z",
    finishedAt: "2026-09-18T01:01:00.000Z",
    failure: "HTTP_406",
  });
  memory.tables["source_pull_receipts:" + known.key] = [
    saved,
    ...Array.from({ length: 100 }, (_, i) => ({
      ...failed,
      receiptId: String(i),
    })),
  ];
  const route = (handler as unknown as Record<string, any[]>)[
    "GET /api/sources/:key/health"
  ].at(-1);
  const response = JSON.parse(
    (await route({ params: { key: known.key }, query: {} })).body,
  );
  expect(response.health).toMatchObject({
    transport: { httpStatus: 406 },
    lastAcknowledgedIngestion: "2026-09-18T00:01:00.000Z",
  });
  expect(response.coverage.complete).toBe(false);
  expect(response.nextCursor).toBe("100");
  expect(saved.contract).toMatchObject({
    key: known.key,
    provenance: known.provenance,
  });
});
