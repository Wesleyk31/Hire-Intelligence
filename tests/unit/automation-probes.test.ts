import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  metadata: {} as any,
  pages: [] as any[],
  pilot: {} as any,
}));
vi.mock("../../backend/source-helpers", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sourceJson: async () => fixture.metadata,
}));
vi.mock("../../backend/backfill-fetch", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  prepareBackfillContext: async () => ({}),
  collectBackfillPage: async () => {
    if (!fixture.pages.length) throw new Error("UNEXPECTED_EXTRA_PROBE_PAGE");
    return fixture.pages.shift();
  },
}));
vi.mock("../../backend/source-pilots", () => ({
  fetchSourcePilot: async () => fixture.pilot,
}));
import { probeCandidate, probeSource } from "../../backend/automation-probes";
import { SOURCE_PILOT_CONTRACTS } from "../../backend/source-contracts";
const source = {
  key: "fixture-probe",
  name: "Fixture",
  owner: "Fixture Authority",
  territory: "WA",
  sector: "Mining",
  licence: "Fixture",
  method: "ARCGIS" as const,
  endpoint: "https://authority.test/FeatureServer/0/query?f=json",
  provenance: "https://authority.test/catalogue",
};
const row = (id: string, date?: string) => ({
  externalId: id,
  raw: {
    OBJECTID: id,
    projectname: "Fixture Project",
    ...(date ? { publicationdate: date } : {}),
  },
});
const page = (rows = [row("1")], completed = true, next = rows.length) => ({
  rows,
  completed,
  next,
});
const collect = async () => ({
  recordsFetched: 1,
  opportunities: [{ sourceObservedAt: "2026-09-01T00:00:00.000Z" }],
});
beforeEach(() => {
  fixture.metadata = {
    fields: [
      { name: "OBJECTID", type: "esriFieldTypeOID" },
      { name: "projectname", type: "esriFieldTypeString" },
      ...SOURCE_PILOT_CONTRACTS[
        "logan-development-applications"
      ].requiredFields.map((name) => ({ name, type: "esriFieldTypeString" })),
    ],
  };
  fixture.pages = [page()];
  fixture.pilot = {
    evidence: [{ sourceObservedAt: "2026-09-01T00:00:00.000Z" }],
    quarantine: [],
    excluded: [],
    fetch: {
      rowsFetched: 1,
      pages: 1,
      completed: true,
      schemaVerified: true,
      sourceLastModifiedAt: "2026-09-17T00:00:00.000Z",
    },
  };
});

describe("read-only source health probe", () => {
  it("does not claim pagination was observed from a single terminal or empty page", async () => {
    expect((await probeSource(source, collect)).checks?.pagination).toBe(
      "NOT_VERIFIED",
    );
    fixture.pages = [page([], true, 0)];
    const empty = await probeSource(source, collect);
    expect(empty).toMatchObject({
      recordCount: 0,
      lastRecordTimestamp: null,
      checks: { pagination: "NOT_VERIFIED", freshness: "NOT_VERIFIED" },
    });
  });
  it("verifies pagination only across distinct bounded source pages", async () => {
    fixture.pages = [page([row("1")], false, 1), page([row("2")], true, 2)];
    expect(await probeSource(source, collect)).toMatchObject({
      recordCount: 2,
      checks: { pagination: "PASS" },
    });
  });
  it("rejects overlapping page identities instead of treating partial duplication as successful pagination", async () => {
    fixture.pages = [
      page([row("1"), row("2")], false, 2),
      page([row("2"), row("3")], true, 4),
    ];
    await expect(probeSource(source, collect)).rejects.toThrow(
      "PAGINATION_REPEATED_PAGE",
    );
  });
  it("rejects oversized pages and non-advancing cursors before processing further results", async () => {
    fixture.pages = [
      page(Array.from({ length: 101 }, (_, index) => row(String(index)))),
    ];
    await expect(probeSource(source, collect)).rejects.toThrow(
      "SOURCE_PROBE_PAGE_LIMIT",
    );
    fixture.pages = [page([row("1")], false, 0)];
    await expect(probeSource(source, collect)).rejects.toThrow(
      "PAGINATION_NOT_ADVANCING",
    );
  });
  it("hashes declared field names and types stably while detecting a declared type change", async () => {
    const first = await probeSource(source, collect);
    fixture.metadata.fields.reverse();
    fixture.metadata.fields[0].alias = "Changed display alias";
    fixture.pages = [page()];
    const reordered = await probeSource(source, collect);
    expect(reordered.schemaVersion).toBe(first.schemaVersion);
    fixture.metadata.fields[0].type = "esriFieldTypeInteger";
    fixture.pages = [page()];
    expect((await probeSource(source, collect)).schemaVersion).not.toBe(
      first.schemaVersion,
    );
  });
  it("reports malformed schema metadata and token requirements as specific failures", async () => {
    for (const fields of [
      [null],
      [{ name: 1, type: "esriFieldTypeString" }],
      [
        { name: "x", type: "esriFieldTypeString" },
        { name: "x", type: "esriFieldTypeOID" },
      ],
    ]) {
      fixture.metadata = { fields };
      await expect(probeSource(source, collect)).rejects.toThrow(
        "ARCGIS_SCHEMA_FIELDS_INVALID",
      );
    }
    fixture.metadata = { error: { code: 499, message: "Token Required" } };
    await expect(probeSource(source, collect)).rejects.toThrow(
      "AUTHENTICATION_REQUIRED",
    );
  });
  it("never substitutes retrieval time for absent publication dates", async () => {
    const result = await probeSource(source, collect);
    expect(result.lastRecordTimestamp).toBeNull();
    expect(result.checks?.freshness).toBe("NOT_VERIFIED");
    fixture.pages = [page([row("1", "2026-08-01"), row("2", "2026-09-01")])];
    expect((await probeSource(source, collect)).lastRecordTimestamp).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });
  it("retains unverified pagination and schema for legacy live-only adapters", async () => {
    const result = await probeSource(
      { ...source, method: "WFS_MATCH" },
      collect,
    );
    expect(result).toMatchObject({
      recordCount: 1,
      lastRecordTimestamp: "2026-09-01T00:00:00.000Z",
      checks: {
        parser: "PASS",
        schema: "NOT_VERIFIED",
        pagination: "NOT_VERIFIED",
      },
    });
  });
});

describe("candidate technical probe evidence", () => {
  it("keeps layer metadata editing separate from the last record timestamp", async () => {
    expect(
      (
        await probeCandidate(
          SOURCE_PILOT_CONTRACTS["logan-development-applications"],
        )
      ).lastRecordTimestamp,
    ).toBe("2026-09-01T00:00:00.000Z");
    fixture.pilot.evidence = [];
    fixture.pilot.fetch.rowsFetched = 0;
    const empty = await probeCandidate(
      SOURCE_PILOT_CONTRACTS["logan-development-applications"],
    );
    expect(empty.lastRecordTimestamp).toBeNull();
    expect(empty.checks?.pagination).toBe("NOT_VERIFIED");
  });
  it("keeps rate limits and reproducibility unverified and never treats a quarantined row as parser acceptance", async () => {
    fixture.pilot.evidence = [];
    fixture.pilot.quarantine = [
      { qualityFlags: ["MISSING_FIELD:Application_Status"] },
    ];
    const result = await probeCandidate(
      SOURCE_PILOT_CONTRACTS["logan-development-applications"],
    );
    expect(result).toMatchObject({
      requiredFields: "FAIL",
      rateLimits: "NOT_VERIFIED",
      reproducibility: "NOT_VERIFIED",
      checks: { parser: "FAIL" },
    });
  });
  it("uses an observed declared-schema hash rather than a constant required-fields list", async () => {
    const first = await probeCandidate(
      SOURCE_PILOT_CONTRACTS["logan-development-applications"],
    );
    fixture.metadata.fields[0].type = "esriFieldTypeInteger";
    const changed = await probeCandidate(
      SOURCE_PILOT_CONTRACTS["logan-development-applications"],
    );
    expect(changed.schemaVersion).not.toBe(first.schemaVersion);
  });
});
