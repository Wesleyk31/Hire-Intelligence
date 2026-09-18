import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production SDK reads stage snapshots and persists them; this suite uses an empty isolated store.
vi.mock("@appdeploy/sdk", () => ({
  db: {
    list: async () => ({ items: [] }),
    add: async (_table: string, rows: unknown[]) =>
      rows.map((_, index) => "snapshot-" + index),
    update: async (_table: string, rows: unknown[]) => rows.map(() => true),
  },
}));
import {
  isCallNowCandidate,
  type CallNowCandidate,
} from "../../backend/domain-hardening";
import {
  buildProjectIntelligence,
  type IntelligenceEvidence,
} from "../../backend/intelligence";
import { buildCommercialIntelligence } from "../../backend/commercial-intelligence";

const now = "2026-09-18T00:00:00.000Z";
const source = {
  key: "qa-contracts",
  name: "Fixture official contracts",
  sector: "Infrastructure",
  territory: "WA",
};
const record = (
  patch: Partial<IntelligenceEvidence> = {},
): IntelligenceEvidence => ({
  sourceKey: source.key,
  externalId: "fixture-1",
  project: "Fixture Copper Ridge Expansion",
  location: "Pilbara WA",
  company: "Fixture Delivery Contractor",
  organisationRole: "DELIVERY_CONTRACTOR",
  description:
    "Contract awarded for mine earthworks and water pipeline; site mobilisation begins.",
  value: "Not stated",
  observedAt: now,
  sourceObservedAt: now,
  provenance: "https://authority.test/fixture/1",
  ...patch,
});
const qualifies: CallNowCandidate & { promotionEligible: boolean } = {
  promotionEligible: true,
  stageLabel: "AWARDED",
  bdmPriority: 80,
  signalQualityBand: "B",
  freshnessScore: 65,
  contractors: ["Fixture Delivery Contractor"],
  contractorConfidence: 70,
  equipmentPrediction: { classes: ["Excavators"], confidence: 55 },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
});
afterEach(() => vi.useRealTimers());

describe("existing approved CALL NOW evidence conditions", () => {
  it("admits the exact approved minimums only when all independent conditions are present", () => {
    expect(isCallNowCandidate(qualifies)).toBe(true);
  });
  it.each([
    ["held evidence", { promotionEligible: false }],
    ["generic announcement stage", { stageLabel: "WATCH", bdmPriority: 100 }],
    ["planning approval stage", { stageLabel: "APPROVAL", bdmPriority: 100 }],
    ["tender without award", { stageLabel: "PROCUREMENT", bdmPriority: 100 }],
    ["completed project", { stageLabel: "COMPLETE", bdmPriority: 100 }],
    ["weak priority", { bdmPriority: 79 }],
    ["weak quality", { signalQualityBand: "C" }],
    ["old evidence", { freshnessScore: 64 }],
    ["no contractor", { contractors: [] }],
    ["unverified contractor", { contractorConfidence: 69 }],
    [
      "no equipment relevance",
      { equipmentPrediction: { classes: [], confidence: 100 } },
    ],
    [
      "weak equipment inference",
      { equipmentPrediction: { classes: ["Excavators"], confidence: 54 } },
    ],
  ])("rejects %s even if other conditions pass", (_label, patch) => {
    expect(isCallNowCandidate({ ...qualifies, ...patch })).toBe(false);
  });
});

describe("automation preserves source evidence and inference integrity", () => {
  it("preserves original evidence and the PREDICTED label for an eligible mobilisation signal", async () => {
    const evidence = record();
    const original = structuredClone(evidence);
    const [project] = await buildProjectIntelligence([evidence], [source]);
    expect(project.records).toEqual([original]);
    expect(evidence).toEqual(original);
    expect(project.equipmentPrediction.label).toBe("PREDICTED");
    expect(project.equipmentPrediction.classes).toContain("Excavators");
    expect(project.equipmentPrediction.classes).toContain("Pumps / dewatering");
    expect(isCallNowCandidate(project)).toBe(true);
    const commercial = buildCommercialIntelligence([project], [], [source]);
    expect(
      commercial.equipmentClusters.every((item) => item.label === "PREDICTED"),
    ).toBe(true);
    expect(project.value).toBe("Not stated");
    for (const field of [
      "quantities",
      "rentalDuration",
      "exactModels",
      "commercialRates",
      "customerIntent",
    ])
      expect(
        (project.equipmentPrediction as unknown as Record<string, unknown>)[
          field
        ],
      ).toBeUndefined();
  });
  it("does not turn a generic high-scoring announcement into CALL NOW", async () => {
    const planningSource = {
      ...source,
      key: "qa-planning",
      sector: "Development",
    };
    const [project] = await buildProjectIntelligence(
      [
        record({
          sourceKey: planningSource.key,
          description:
            "Public announcement of an industrial development concept.",
          company: "",
          organisationRole: "UNKNOWN",
        }),
      ],
      [planningSource],
    );
    expect(project.stageLabel).toBe("WATCH");
    expect(
      isCallNowCandidate({
        ...project,
        bdmPriority: 100,
        signalQualityBand: "A",
        freshnessScore: 100,
      }),
    ).toBe(false);
  });
  it("inferred equipment alone cannot qualify a project with no contractor or approved stage", async () => {
    const planningSource = { ...source, key: "qa-planning", sector: "Mining" };
    const [project] = await buildProjectIntelligence(
      [
        record({
          sourceKey: planningSource.key,
          description: "Mine and water pipeline concept.",
          company: "",
          organisationRole: "UNKNOWN",
        }),
      ],
      [planningSource],
    );
    expect(project.equipmentPrediction.classes.length).toBeGreaterThan(0);
    expect(project.equipmentPrediction.label).toBe("PREDICTED");
    expect(project.contractors).toEqual([]);
    expect(
      isCallNowCandidate({
        ...project,
        bdmPriority: 100,
        signalQualityBand: "A",
        freshnessScore: 100,
      }),
    ).toBe(false);
  });
  it("keeps missing contacts and commercial values absent instead of inventing enrichment", async () => {
    const evidence = record({ company: "", organisationRole: "UNKNOWN" });
    const [project] = await buildProjectIntelligence([evidence], [source]);
    expect(project).toMatchObject({
      company: "",
      contractors: [],
      contractorConfidence: 0,
      value: "Not stated",
    });
    expect(isCallNowCandidate(project)).toBe(false);
    const inspect = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) {
        if (
          /^(email|phone|contactName|contactEmail|contactPhone|contacts)$/.test(
            key,
          )
        )
          expect(
            nested == null ||
              nested === "" ||
              (Array.isArray(nested) && nested.length === 0),
          ).toBe(true);
        inspect(nested);
      }
    };
    inspect(project);
    inspect(buildCommercialIntelligence([project], [], [source]));
  });
  it("never promotes an applicant or owner into the delivery contractor required by CALL NOW", async () => {
    for (const organisationRole of [
      "APPLICANT_HOLDER",
      "OWNER_PROPONENT",
      "OPERATOR",
      "SUPPLIER",
      "UNKNOWN",
    ] as const) {
      const [project] = await buildProjectIntelligence(
        [record({ organisationRole })],
        [source],
      );
      expect(project.contractors).toEqual([]);
      expect(project.company).toBe("");
      expect(project.records[0].company).toBe("Fixture Delivery Contractor");
      expect(isCallNowCandidate(project)).toBe(false);
    }
  });
  it("fresh retrieval cannot turn old source evidence into a CALL NOW signal", async () => {
    const [project] = await buildProjectIntelligence(
      [record({ sourceObservedAt: "2020-01-01T00:00:00.000Z" })],
      [source],
    );
    expect(project.freshnessScore).toBeLessThan(65);
    expect(isCallNowCandidate(project)).toBe(false);
  });
});
