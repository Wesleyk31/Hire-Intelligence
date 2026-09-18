import { describe, expect, it, vi } from "vitest";
vi.mock("@appdeploy/sdk", () => ({
  db: {
    list: async () => ({ items: [] }),
    add: async (_: string, rows: unknown[]) => rows.map((_, i) => String(i)),
    update: async (_: string, rows: unknown[]) => rows.map(() => true),
  },
}));
import { buildProjectIntelligence } from "../../backend/intelligence";
import { isCallNowCandidate } from "../../backend/domain-hardening";
const source = {
  key: "qa-infrastructure",
  name: "Synthetic public project announcement",
  sector: "Infrastructure",
  territory: "WA",
};
async function projectFrom(description: string, sourceKey = source.key) {
  const records = [
    {
      sourceKey,
      externalId: "SYNTHETIC-AUDIT-ONLY",
      project: "Synthetic Copper Ridge Development",
      location: "Pilbara WA",
      company: "Synthetic Contractor",
      organisationRole: "DELIVERY_CONTRACTOR" as const,
      description,
      value: "Not stated",
      observedAt: new Date().toISOString(),
      sourceObservedAt: new Date().toISOString(),
      provenance: "https://example.test/synthetic-audit-only",
    },
  ];
  const [project] = await buildProjectIntelligence(records, [source]);
  return project;
}
describe("prospective construction and negated commencement evidence", () => {
  it.each([
    "Public announcement: proposed mine construction and water pipeline concept for 2030. Subject to funding and final approvals; no works have been awarded or commenced.",
    "Mine construction and water pipeline works will commence in 2030, subject to funding.",
    "Mine construction and pipeline earthworks are expected to begin after final approval.",
    "No mine construction or water pipeline works have commenced.",
    "Mine construction and water pipeline works have not commenced.",
    "The mine earthworks contract has not been awarded.",
  ])("keeps uncommitted or negated work at WATCH: %s", async (description) => {
    const project = await projectFrom(description);
    expect(project.stageLabel).toBe("WATCH");
    expect(isCallNowCandidate(project)).toBe(false);
    expect(project.equipmentPrediction.label).toBe("PREDICTED");
  });
  it("does not let a contract source identifier override explicitly unawarded work", async () => {
    const project = await projectFrom(
      "Proposed mine construction and water pipeline works; no contract has been awarded.",
      "qa-contracts",
    );
    expect(project.stageLabel).toBe("WATCH");
    expect(isCallNowCandidate(project)).toBe(false);
  });
  it.each([
    [
      "Mine construction and water pipeline earthworks are underway.",
      "CONSTRUCTION",
    ],
    [
      "Contract awarded for mine earthworks and water pipeline works.",
      "AWARDED",
    ],
    [
      "Contract awarded for mine earthworks and water pipeline works. Site mobilisation has begun.",
      "MOBILISATION",
    ],
    [
      "Contract awarded for mine earthworks and water pipeline works. Construction will start in 2030.",
      "AWARDED",
    ],
    [
      "The proposed mine construction phase is subject to funding. Water pipeline construction has commenced.",
      "CONSTRUCTION",
    ],
  ])(
    "retains actual committed or ongoing work: %s",
    async (description, expected) => {
      const project = await projectFrom(description);
      expect(project.stageLabel).toBe(expected);
      if (expected === "CONSTRUCTION" || expected === "MOBILISATION")
        expect(isCallNowCandidate(project)).toBe(true);
    },
  );
});
