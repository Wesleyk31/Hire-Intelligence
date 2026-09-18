import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  writes: [] as string[],
  failWrite: false,
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
        if (memory.failWrite) return null;
        const id = String((memory.tables[table] || []).length + 1);
        (memory.tables[table] ||= []).push({ ...structuredClone(row), id });
        memory.writes.push(row.status);
        return id;
      }),
    update: async (table: string, rows: any[]) =>
      rows.map(({ id, record }) => {
        const index = (memory.tables[table] || []).findIndex(
          (row) => row.id === id,
        );
        if (index < 0 || memory.failWrite) return false;
        memory.tables[table][index] = { ...structuredClone(record), id };
        memory.writes.push(record.status);
        return true;
      }),
  },
}));
import { SOURCE_PILOT_CONTRACTS } from "../../backend/source-contracts";
import {
  activateVerifiedCandidate,
  discoverSourceCandidates,
  evaluateSourceAdmission,
  readSourceCandidates,
  validateSourceCandidate,
  type AdmissionReview,
  type AdmissionProbeResult,
} from "../../backend/source-admission";

const key = "logan-development-applications";
const contract = SOURCE_PILOT_CONTRACTS[key];
const review: AdmissionReview = {
  reviewedBy: "Fixture reviewer",
  reviewedAt: "2026-09-17T00:00:00.000Z",
  endpoint: contract.endpoint,
  provenanceUrl: contract.metadataUrl,
  licenceName: contract.licence.name,
  licenceUrl: contract.licence.url,
  provenanceVerified: true,
  lawfulMachineAccess: true,
  noAccessBypass: true,
  machineReadable: true,
  requiredFieldsVerified: true,
  rateLimitVerified: true,
  reproducibleRetrievalVerified: true,
  activationApproved: true,
  evidenceUrls: [contract.metadataUrl, contract.licence.termsUrl],
  minPollHours: 24,
  freshnessWindowHours: 48,
};
const probe: AdmissionProbeResult = {
  recordCount: 2,
  schemaVersion: "fixture-required-fields-v1",
  lastRecordTimestamp: new Date(Date.now() - 3600000).toISOString(),
  checks: {
    accessibility: "PASS",
    response_type: "PASS",
    schema: "PASS",
    parser: "PASS",
    authentication: "PASS",
    pagination: "PASS",
    freshness: "PASS",
  },
  requiredFields: "PASS",
  rateLimits: "PASS",
  reproducibility: "PASS",
};
beforeEach(() => {
  memory.tables = {};
  memory.writes = [];
  memory.failWrite = false;
});

describe("controlled catalogue discovery", () => {
  it("discovers only compiled authoritative pilots without fetching or activating them", async () => {
    const rows = await discoverSourceCandidates();
    expect(rows.map((row) => row.source_id).sort()).toEqual([
      "logan-development-applications",
      "qld-coordinated-projects",
    ]);
    expect(
      rows.every((row) => row.status === "CANDIDATE" && row.collection_blocked),
    ).toBe(true);
    expect(rows[0].licence_url).toBe(
      "https://creativecommons.org/licenses/by/3.0/au/",
    );
    expect(rows[0].legal_review_status).toBe("REVIEW_REQUIRED");
    await discoverSourceCandidates();
    expect(await readSourceCandidates()).toHaveLength(2);
    expect(memory.tables["automation_source:" + key]).toHaveLength(1);
  });
  it("rejects arbitrary URLs and unknown source identifiers before invoking a probe", async () => {
    let calls = 0;
    for (const supplied of [
      "https://private.test/data",
      "unreviewed-source",
      "__proto__",
    ])
      await expect(
        validateSourceCandidate(supplied, async () => {
          calls++;
          return probe;
        }),
      ).rejects.toThrow("SOURCE_CANDIDATE_NOT_ALLOWLISTED");
    expect(calls).toBe(0);
    expect(Object.keys(memory.tables)).toEqual([]);
  });
  it("persists validation then review-required for the existing activation-pending pilots", async () => {
    await discoverSourceCandidates();
    const result = await validateSourceCandidate(key, async () => probe);
    expect(result).toMatchObject({
      status: "REVIEW_REQUIRED",
      collection_blocked: true,
      legal_review_status: "REVIEW_REQUIRED",
    });
    expect(result.failure_reason).toContain("ACTIVATION_REVIEW_PENDING");
    expect(memory.writes).toContain("VALIDATING");
    expect(memory.writes).not.toContain("VERIFIED");
    expect(memory.writes).not.toContain("ACTIVE");
    await expect(activateVerifiedCandidate(key)).rejects.toThrow(
      "SOURCE_ADMISSION_NOT_VERIFIED",
    );
  });
  it("records technical validation failure without promoting or losing provenance", async () => {
    const result = await validateSourceCandidate(key, async () => {
      throw new Error("ARCGIS_REQUIRED_FIELDS_MISSING:Application_Status");
    });
    expect(result).toMatchObject({
      status: "REVIEW_REQUIRED",
      endpoint: contract.endpoint,
      publisher: contract.owningAgency,
      licence_url: contract.licence.url,
      failure_reason: "ARCGIS_REQUIRED_FIELDS_MISSING:Application_Status",
    });
  });
  it("fails closed when persisted candidate metadata no longer matches the compiled catalogue", async () => {
    await discoverSourceCandidates();
    memory.tables["automation_source:" + key][0].endpoint =
      "https://unreviewed.test/source";
    let calls = 0;
    const result = await validateSourceCandidate(key, async () => {
      calls++;
      return probe;
    });
    expect(result).toMatchObject({
      status: "REVIEW_REQUIRED",
      failure_reason: "SOURCE_CANDIDATE_CONTRACT_CHANGED",
    });
    expect(calls).toBe(0);
  });
});

describe("admission gates", () => {
  it("requires explicit reviewed legal and machine access conditions, never merely a successful parser", () => {
    expect(evaluateSourceAdmission(contract, null, probe).status).toBe(
      "REVIEW_REQUIRED",
    );
    for (const field of [
      "provenanceVerified",
      "lawfulMachineAccess",
      "noAccessBypass",
      "machineReadable",
      "requiredFieldsVerified",
      "rateLimitVerified",
      "reproducibleRetrievalVerified",
      "activationApproved",
    ]) {
      expect(
        evaluateSourceAdmission(contract, { ...review, [field]: false }, probe)
          .status,
      ).toBe("REVIEW_REQUIRED");
    }
  });
  it("requires licence and review metadata bound to the exact endpoint", () => {
    for (const invalid of [
      { licenceUrl: "" },
      { licenceName: "" },
      { reviewedBy: "" },
      { reviewedAt: "" },
      { evidenceUrls: [] },
      { endpoint: "https://unreviewed.test/source" },
      { provenanceUrl: "https://unreviewed.test/catalogue" },
    ])
      expect(
        evaluateSourceAdmission(contract, { ...review, ...invalid }, probe)
          .status,
      ).toBe("REVIEW_REQUIRED");
  });
  it("requires observed pagination, freshness, required fields, rate limits and reproducibility", () => {
    for (const check of [
      "accessibility",
      "response_type",
      "schema",
      "parser",
      "authentication",
      "pagination",
      "freshness",
    ])
      expect(
        evaluateSourceAdmission(contract, review, {
          ...probe,
          checks: { ...probe.checks, [check]: "NOT_VERIFIED" },
        }).status,
      ).toBe("REVIEW_REQUIRED");
    for (const field of ["requiredFields", "rateLimits", "reproducibility"])
      expect(
        evaluateSourceAdmission(contract, review, {
          ...probe,
          [field]: "NOT_VERIFIED",
        }).status,
      ).toBe("REVIEW_REQUIRED");
    expect(
      evaluateSourceAdmission(contract, review, {
        ...probe,
        lastRecordTimestamp: null,
      }).status,
    ).toBe("REVIEW_REQUIRED");
    expect(
      evaluateSourceAdmission(contract, review, {
        ...probe,
        lastRecordTimestamp: "2020-01-01T00:00:00.000Z",
      }).status,
    ).toBe("REVIEW_REQUIRED");
  });
  it("returns VERIFIED only after all independently supplied review and probe evidence passes", () => {
    expect(evaluateSourceAdmission(contract, review, probe)).toMatchObject({
      status: "VERIFIED",
      reasons: [],
    });
  });
  it("propagates failed database acknowledgements instead of returning an apparent validation success", async () => {
    memory.failWrite = true;
    await expect(
      validateSourceCandidate(key, async () => probe),
    ).rejects.toThrow("SOURCE_REGISTRY_WRITE_FAILED");
  });
});
