import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  failTable: "",
  writes: [] as string[],
}));
vi.mock("@appdeploy/sdk", () => ({
  db: {
    list: async (table: string, options: any = {}) => ({
      items: structuredClone(
        (memory.tables[table] || []).slice(0, options.limit || 100),
      ),
    }),
    add: async (table: string, rows: any[]) =>
      rows.map((row) => {
        if (table.startsWith(memory.failTable) && memory.failTable) return null;
        const id = String((memory.tables[table] || []).length + 1);
        (memory.tables[table] ||= []).push({ ...structuredClone(row), id });
        memory.writes.push(table);
        return id;
      }),
    update: async (table: string, rows: any[]) =>
      rows.map(({ id, record }) => {
        const index = (memory.tables[table] || []).findIndex(
          (row) => row.id === id,
        );
        if (
          index < 0 ||
          (table.startsWith(memory.failTable) && memory.failTable)
        )
          return false;
        memory.tables[table][index] = { ...structuredClone(record), id };
        memory.writes.push(table);
        return true;
      }),
  },
}));
import {
  getSourceDiscoveryStatus,
  runSourceDiscovery,
  DISCOVERY_QUERIES,
} from "../../backend/source-discovery";
const dataset = (id = "dataset-1", extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  title: "Fixture mine approval dataset",
  organization: { title: "Fixture Department of Mines" },
  license_title: "Creative Commons Attribution 4.0",
  license_url: "https://creativecommons.org/licenses/by/4.0/",
  metadata_modified: "2026-09-17T00:00:00.000Z",
  notes: "Authoritative catalogue metadata fixture, not a production source.",
  resources: [
    {
      id: "resource-1",
      name: "API export",
      format: "GeoJSON",
      url: "https://resources.test/data.geojson",
    },
  ],
  ...extra,
});
const response = (rows = [dataset()], count = rows.length) => ({
  success: true,
  result: { count, results: rows },
});
const candidates = () =>
  Object.entries(memory.tables)
    .filter(([key]) => key.startsWith("automation_candidate:"))
    .flatMap(([, rows]) => rows);
beforeEach(() => {
  memory.tables = {};
  memory.failTable = "";
  memory.writes = [];
});

describe("bounded authoritative catalogue discovery", () => {
  it("fetches one allowlisted catalogue page and saves review-only metadata without fetching resource URLs", async () => {
    const urls: string[] = [];
    const result = await runSourceDiscovery(async (url) => {
      urls.push(url);
      return response();
    });
    expect(result).toMatchObject({
      status: "SUCCESS",
      catalogue: "wa",
      datasets_processed: 1,
      candidates_created: 1,
    });
    expect(urls).toHaveLength(1);
    const request = new URL(urls[0]);
    expect(request.origin).toBe("https://catalogue.data.wa.gov.au");
    expect(request.pathname).toBe("/api/3/action/package_search");
    expect(request.searchParams.get("rows")).toBe("5");
    expect(request.searchParams.get("start")).toBe("0");
    expect(candidates()[0]).toMatchObject({
      status: "CANDIDATE",
      collection_blocked: true,
      legal_review_status: "NOT_VERIFIED",
      publisher: "Fixture Department of Mines",
      dataset_id: "dataset-1",
      licence_url: "https://creativecommons.org/licenses/by/4.0/",
      admission_reason: "REVIEW_AND_COMPILED_ADAPTER_REQUIRED",
      technical_validation: "NOT_VERIFIED",
    });
    expect(candidates()[0].resources[0].url).toBe(
      "https://resources.test/data.geojson",
    );
    expect(candidates()[0].provenance_url).toBe(
      "https://catalogue.data.wa.gov.au/dataset/dataset-1",
    );
    expect(candidates()[0].retrieved_at).toBeTruthy();
    expect(
      Object.keys(memory.tables).some((key) =>
        key.startsWith("automation_source:"),
      ),
    ).toBe(false);
  });
  it("rotates catalogues and category queries and resumes a prior category offset", async () => {
    const urls: URL[] = [];
    const request = async (url: string) => {
      const parsed = new URL(url);
      urls.push(parsed);
      return response(
        Array.from({ length: 5 }, (_, index) =>
          dataset(
            parsed.searchParams.get("q") +
              "-" +
              parsed.searchParams.get("start") +
              "-" +
              index,
          ),
        ),
        100,
      );
    };
    for (let run = 0; run < DISCOVERY_QUERIES.length * 2 + 1; run++)
      await runSourceDiscovery(request);
    expect(urls[1].origin).toBe("https://data.gov.au");
    expect(urls[1].pathname).toBe("/data/api/3/action/package_search");
    expect(urls[2].searchParams.get("q")).not.toBe(
      urls[0].searchParams.get("q"),
    );
    expect(urls.at(-1)?.searchParams.get("q")).toBe(
      urls[0].searchParams.get("q"),
    );
    expect(urls.at(-1)?.searchParams.get("start")).toBe("5");
  });
  it("does not advance the selected catalogue checkpoint after a failed candidate write", async () => {
    memory.failTable = "automation_candidate:";
    await expect(runSourceDiscovery(async () => response())).rejects.toThrow(
      "SOURCE_DISCOVERY_WRITE_FAILED",
    );
    expect(memory.tables["automation_discovery:wa"]).toBeUndefined();
    expect(memory.tables["automation_discovery:rotation"]).toBeUndefined();
    memory.failTable = "";
    const resumed = await runSourceDiscovery(async () => response());
    expect(resumed).toMatchObject({
      catalogue: "wa",
      checkpoint_before: { query_index: 0, offset: 0 },
      candidates_created: 1,
    });
  });
  it("deduplicates catalogue dataset IDs across query matches and preserves review status", async () => {
    await runSourceDiscovery(async () => response());
    candidates()[0].status = "REVIEW_REQUIRED";
    const table = Object.keys(memory.tables).find((key) =>
      key.startsWith("automation_candidate:"),
    )!;
    memory.tables[table][0].status = "REVIEW_REQUIRED";
    await runSourceDiscovery(async () => response());
    const third = await runSourceDiscovery(async () => response());
    expect(third).toMatchObject({
      candidates_created: 0,
      duplicates_skipped: 1,
    });
    expect(candidates()).toHaveLength(2);
    expect(memory.tables[table][0].status).toBe("REVIEW_REQUIRED");
  });
  it("isolates a failed catalogue without treating its failed page as completed", async () => {
    const failure = await runSourceDiscovery(async () => {
      throw new Error("HTTP_503 maintenance");
    });
    expect(failure).toMatchObject({
      status: "FAILED",
      catalogue: "wa",
      datasets_processed: 0,
      checkpoint_before: { query_index: 0, offset: 0 },
      checkpoint_after: { query_index: 0, offset: 0 },
      failure_reason: "HTTP_503 maintenance",
    });
    const next = await runSourceDiscovery(async () => response());
    expect(next.catalogue).toBe("australia");
    const status = await getSourceDiscoveryStatus();
    expect(
      status.catalogues.find((item) => item.catalogue === "wa"),
    ).toMatchObject({
      last_run: { status: "FAILED" },
      query_offsets: [0, 0, 0, 0, 0, 0, 0],
    });
  });
  it("rejects CKAN error and oversized/malformed results instead of accepting a successful HTTP response", async () => {
    for (const result of [
      { success: false, error: { message: "Denied" } },
      response(
        Array.from({ length: 6 }, (_, index) => dataset(String(index))),
        6,
      ),
      response([{ title: "Missing identifier" } as any]),
    ]) {
      const observed = await runSourceDiscovery(async () => result);
      expect(observed.status).toBe("FAILED");
      expect(observed.checkpoint_after).toEqual(observed.checkpoint_before);
    }
    expect(candidates()).toEqual([]);
  });
  it("does not manufacture unknown publishers/licences or infer lawful access from catalogue inclusion", async () => {
    await runSourceDiscovery(async () =>
      response([
        dataset("unknown", {
          organization: null,
          license_title: "",
          license_url: "",
        }),
      ]),
    );
    expect(candidates()[0]).toMatchObject({
      publisher: null,
      licence_name: null,
      licence_url: null,
      legal_review_status: "NOT_VERIFIED",
      status: "CANDIDATE",
    });
  });
  it("reports only stored candidate counts and an unobserved status before discovery has run", async () => {
    expect(await getSourceDiscoveryStatus()).toMatchObject({
      candidate_count: 0,
      last_run: null,
      catalogues: [],
      next_catalogue: null,
    });
    await runSourceDiscovery(async () => response());
    expect(await getSourceDiscoveryStatus()).toMatchObject({
      candidate_count: 1,
      next_catalogue: "australia",
      last_run: { status: "SUCCESS" },
    });
  });
});
