import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  failWrite: false,
}));
vi.mock("@appdeploy/sdk", () => ({
  db: {
    list: async (table: string, options: any = {}) => ({
      items: structuredClone(
        (memory.tables[table] || []).slice(0, options.limit || 100),
      ),
      nextToken:
        (memory.tables[table] || []).length > (options.limit || 100)
          ? "more"
          : undefined,
    }),
    add: async (table: string, rows: any[]) =>
      rows.map((row) => {
        if (memory.failWrite) return null;
        const id = String((memory.tables[table] || []).length + 1);
        (memory.tables[table] ||= []).push({ ...structuredClone(row), id });
        return id;
      }),
    update: async (table: string, rows: any[]) =>
      rows.map(({ id, record }) => {
        const index = (memory.tables[table] || []).findIndex(
          (row) => row.id === id,
        );
        if (index < 0 || memory.failWrite) return false;
        memory.tables[table][index] = { ...structuredClone(record), id };
        return true;
      }),
  },
}));

import {
  checkSourceHealth,
  initializeSourceRegistry,
  isSourceCollectionAllowed,
  readSourceRegistry,
  recordSourceOutcome,
} from "../../backend/source-automation";
const source = {
  key: "qa-source",
  name: "QA authority",
  owner: "QA Publisher",
  territory: "WA",
  sector: "Mining",
  licence: "CC BY 4.0",
  method: "ARCGIS" as const,
  endpoint: "https://authority.test/FeatureServer/0/query?f=json",
  provenance: "https://authority.test/catalogue",
};
beforeEach(() => {
  memory.tables = {};
  memory.failWrite = false;
});

describe("persistent automation source registry", () => {
  it("preserves enabled legacy activation without claiming legal or technical verification", async () => {
    await initializeSourceRegistry([source]);
    const [saved] = await readSourceRegistry([source]);
    expect(saved).toMatchObject({
      source_id: "qa-source",
      publisher: "QA Publisher",
      status: "ACTIVE",
      legal_review_status: "NOT_VERIFIED",
      licence_name: "CC BY 4.0",
      licence_url: null,
      last_checked_at: null,
      last_success_at: null,
      freshness_status: "NOT_VERIFIED",
      checks: { parser: "NOT_VERIFIED", pagination: "NOT_VERIFIED" },
      activation_basis: "LEGACY_CONFIGURATION",
    });
    expect(await isSourceCollectionAllowed(source)).toBe(true);
  });
  it("preserves existing state and explicit configuration disablement during repeated initialization", async () => {
    await recordSourceOutcome(source, { ok: false, failureReason: "HTTP_503" });
    await initializeSourceRegistry([source]);
    expect((await readSourceRegistry([source]))[0].consecutive_failures).toBe(
      1,
    );
    const disabled = {
      ...source,
      key: "disabled",
      enabled: false,
      disableReason: "Licence review pending",
    };
    const [saved] = await initializeSourceRegistry([disabled]);
    expect(saved).toMatchObject({
      status: "DISABLED",
      failure_reason: "Licence review pending",
    });
    expect(await isSourceCollectionAllowed(disabled)).toBe(false);
  });
  it("fails closed for duplicate singleton rows and unacknowledged writes", async () => {
    await initializeSourceRegistry([source]);
    memory.tables["automation_source:qa-source"].push({
      ...memory.tables["automation_source:qa-source"][0],
      id: "2",
    });
    await expect(isSourceCollectionAllowed(source)).rejects.toThrow(
      "SOURCE_REGISTRY_CONFLICT",
    );
    memory.tables = {};
    memory.failWrite = true;
    await expect(initializeSourceRegistry([source])).rejects.toThrow(
      "SOURCE_REGISTRY_WRITE_FAILED",
    );
  });
  it("stops collection when the registered endpoint or licence changes without review", async () => {
    await initializeSourceRegistry([source]);
    const changed = { ...source, licence: "All rights reserved" };
    expect(await isSourceCollectionAllowed(changed)).toBe(false);
    expect((await initializeSourceRegistry([changed]))[0]).toMatchObject({
      status: "REVIEW_REQUIRED",
      failure_reason: "SOURCE_ACCESS_CONTRACT_CHANGED",
    });
  });
  it("reflects an explicit configuration disablement of an already registered source", async () => {
    await initializeSourceRegistry([source]);
    const disabled = {
      ...source,
      enabled: false,
      disableReason: "Operator disabled collection for review",
    };
    expect((await initializeSourceRegistry([disabled]))[0]).toMatchObject({
      status: "DISABLED",
      collection_blocked: true,
      failure_reason: "Operator disabled collection for review",
    });
    expect(await isSourceCollectionAllowed(disabled)).toBe(false);
  });
});

describe("read-only health checks", () => {
  it("retries a transient connection failure once and preserves unobserved checks", async () => {
    let calls = 0;
    const result = await checkSourceHealth(source, async () => {
      if (++calls === 1) throw new Error("HTTP_503");
      return { recordCount: 2, checks: { parser: "PASS" } };
    });
    expect(calls).toBe(2);
    expect(result).toMatchObject({
      status: "ACTIVE",
      consecutive_failures: 0,
      retry_count: 1,
      checks: {
        accessibility: "PASS",
        parser: "PASS",
        schema: "NOT_VERIFIED",
        authentication: "NOT_VERIFIED",
        pagination: "NOT_VERIFIED",
      },
    });
    expect(result.last_success_at).toBeTruthy();
    expect(result.response_latency).toBeGreaterThanOrEqual(0);
  });
  it("degrades after three failures but never auto-disables an outage", async () => {
    for (let attempt = 0; attempt < 3; attempt++)
      await recordSourceOutcome(source, {
        ok: false,
        failureReason: "HTTP_503 upstream maintenance",
      });
    const [saved] = await readSourceRegistry([source]);
    expect(saved).toMatchObject({
      status: "DEGRADED",
      consecutive_failures: 3,
      failure_reason: "HTTP_503 upstream maintenance",
      collection_blocked: false,
    });
    expect(await isSourceCollectionAllowed(source)).toBe(true);
  });
  it.each(["ARCGIS_SCHEMA_INVALID", "SOURCE_PROBE_PAGE_LIMIT"])("stops structural failure %s immediately and allows a validated health probe to recover it", async failureReason => {
    let calls = 0;
    const failure = await checkSourceHealth(source, async () => {
      calls++;
      throw new Error(failureReason);
    });
    expect(calls).toBe(1);
    expect(failure).toMatchObject({
      status: "DEGRADED",
      collection_blocked: true,
      failure_reason: failureReason,
    });
    expect(await isSourceCollectionAllowed(source)).toBe(false);
    expect(
      (
        await checkSourceHealth(source, async () => ({
          recordCount: 0,
          checks: { parser: "PASS", schema: "PASS" },
        }))
      ).status,
    ).toBe("ACTIVE");
  });
  it("holds authentication and licence changes for review and does not bypass access gates", async () => {
    const held = await checkSourceHealth(source, async () => {
      throw new Error("HTTP_401");
    });
    expect(held.status).toBe("REVIEW_REQUIRED");
    expect(await isSourceCollectionAllowed(source)).toBe(false);
    let calls = 0;
    await checkSourceHealth(source, async () => {
      calls++;
      return {};
    });
    expect(calls).toBe(0);
  });
  it("never retries upstream rate limits or database quota errors", async () => {
    let calls = 0;
    expect(
      (
        await checkSourceHealth(source, async () => {
          calls++;
          throw new Error("HTTP_429");
        })
      ).failure_reason,
    ).toBe("HTTP_429");
    expect(calls).toBe(1);
    memory.failWrite = true;
    calls = 0;
    await expect(
      checkSourceHealth(source, async () => {
        calls++;
        return {};
      }),
    ).rejects.toThrow("SOURCE_REGISTRY_WRITE_FAILED");
    expect(calls).toBe(1);
  });
  it("keeps stale and future source dates visible without substituting retrieval time", async () => {
    const stale = await checkSourceHealth(source, async () => ({
      lastRecordTimestamp: "2020-01-01T00:00:00.000Z",
      freshnessWindowHours: 24,
    }));
    expect(stale).toMatchObject({
      freshness_status: "STALE",
      last_record_timestamp: "2020-01-01T00:00:00.000Z",
    });
    expect(stale.status).toBe("DEGRADED");
    const future = await checkSourceHealth(source, async () => ({
      lastRecordTimestamp: "2200-01-01T00:00:00.000Z",
      freshnessWindowHours: 24,
    }));
    expect(future).toMatchObject({
      freshness_status: "NOT_VERIFIED",
      checks: { freshness: "FAIL" },
    });
  });
  it("treats explicit failed parser checks as failure even when the probe resolves", async () => {
    const result = await checkSourceHealth(source, async () => ({
      checks: { parser: "FAIL" },
    }));
    expect(result).toMatchObject({
      status: "DEGRADED",
      collection_blocked: true,
      failure_reason: "SOURCE_CHECK_FAILED:parser",
      last_success_at: null,
    });
  });
  it("requires successful parser and schema checks to clear structural collection holds", async () => {
    await recordSourceOutcome(source, {
      ok: false,
      failureReason: "SCHEMA_INVALID",
    });
    await recordSourceOutcome(source, { ok: false, failureReason: "HTTP_503" });
    expect(await isSourceCollectionAllowed(source)).toBe(false);
    await checkSourceHealth(source, async () => ({
      checks: { parser: "PASS" },
    }));
    expect(await isSourceCollectionAllowed(source)).toBe(false);
    await checkSourceHealth(source, async () => ({
      checks: { parser: "PASS", schema: "PASS" },
    }));
    expect(await isSourceCollectionAllowed(source)).toBe(true);
  });
  it("treats an explicit authentication failure as an access review, even on HTTP success", async () => {
    expect(
      (
        await checkSourceHealth(source, async () => ({
          checks: { authentication: "FAIL" },
        }))
      ).status,
    ).toBe("REVIEW_REQUIRED");
  });
  it("detects a changed observed schema and preserves its established version until reviewed", async () => {
    await recordSourceOutcome(source, { ok: true, schemaVersion: "fields-v1" });
    const changed = await checkSourceHealth(source, async () => ({
      schemaVersion: "fields-v2",
      checks: { parser: "PASS", schema: "PASS" },
    }));
    expect(changed).toMatchObject({
      status: "DEGRADED",
      collection_blocked: true,
      failure_reason: "SOURCE_SCHEMA_CHANGED",
      schema_version: "fields-v1",
    });
  });
});
