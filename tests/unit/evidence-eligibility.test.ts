import { beforeEach, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [] })),
  add: vi.fn(async (_table: string, rows: any[]) =>
    rows.map((_, i) => "saved-" + i),
  ),
  update: vi.fn(async (_table: string, rows: any[]) => rows.map(() => true)),
}));
vi.mock("@appdeploy/sdk", () => ({ db: storage }));
import {
  buildProjectIntelligence,
  type IntelligenceEvidence,
} from "../../backend/intelligence";
import { buildCommercialIntelligence } from "../../backend/commercial-intelligence";
import { isCallNowCandidate } from "../../backend/domain-hardening";
const source = {
  key: "qa-contracts",
  name: "QA official contracts",
  sector: "Mining",
  territory: "WA",
};
const row = (extra: Partial<IntelligenceEvidence> = {}) => ({
  sourceKey: source.key,
  externalId: "stable-1",
  project: "QA Copper Ridge Upgrade",
  location: "Pilbara WA",
  company: "QA Contractor",
  organisationRole: "DELIVERY_CONTRACTOR" as const,
  description:
    "Contract awarded for mine expansion, shutdown, construction earthworks and maintenance",
  value: "AUD 5000000",
  sourceObservedAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  provenance: "https://example.test/source",
  ...extra,
});
beforeEach(() => {
  vi.clearAllMocks();
});
for (const restriction of [
  { contextOnly: true },
  { promotionEligible: false },
  { qualityFlags: ["NATURAL_ID_REVIEW_REQUIRED"] },
  { qualityFlags: ["INVALID_INPUT"] },
  { qualityFlags: "INVALID_INPUT" },
  { qualityFlags: ["   "] },
]) {
  it(
    "retains restricted evidence without promoting it: " +
      JSON.stringify(restriction),
    async () => {
      const input = row(restriction as any),
        before = JSON.stringify(input);
      const [project] = await buildProjectIntelligence([input], [source]);
      expect(project.records).toEqual([input]);
      expect(JSON.stringify(input)).toBe(before);
      expect(project).toMatchObject({
        promotionEligible: false,
        heldEvidenceCount: 1,
        eligibleEvidenceCount: 0,
        stageLabel: "WATCH",
        stageConfidence: 0,
        stageChanged: false,
        bdmPriority: 0,
        signalQualityScore: 0,
        contractors: [],
      });
      expect(project.equipmentPrediction.classes).toEqual([]);
      expect(isCallNowCandidate(project)).toBe(false);
      const commercial = buildCommercialIntelligence([project], [], [source]);
      for (const key of [
        "events",
        "pilotQueue",
        "equipmentClusters",
        "contractorWorkload",
        "fleetPositioning",
      ] as const)
        expect(commercial[key]).toEqual([]);
    },
  );
}
it("held evidence cannot strengthen an otherwise eligible project or change its lead details", async () => {
  const eligible = row({
    company: "",
    organisationRole: "UNKNOWN",
    description: "Planning approval for mine expansion",
    value: "Not stated",
    sourceKey: "qa-approval",
  });
  const [baseline] = await buildProjectIntelligence([eligible], [source]);
  const held = row({
    externalId: "held",
    contextOnly: true,
    sourceObservedAt: new Date(Date.now() + 1000).toISOString(),
  });
  const [mixed] = await buildProjectIntelligence([held, eligible], [source]);
  expect(mixed.records).toHaveLength(2);
  expect(mixed).toMatchObject({
    eligibleEvidenceCount: 1,
    heldEvidenceCount: 1,
    promotionEligible: true,
  });
  for (const key of [
    "id",
    "name",
    "location",
    "stageLabel",
    "stageConfidence",
    "bdmPriority",
    "signalQualityScore",
    "contractors",
    "contractorConfidence",
    "equipmentPrediction",
    "value",
  ] as const)
    expect(mixed[key]).toEqual(baseline[key]);
  expect(
    buildCommercialIntelligence([mixed], [], [source]).events.map(
      (e) => e.type,
    ),
  ).not.toContain("SHUTDOWN");
});
it("restricted text cannot bridge and merge two qualifying canonical groups", async () => {
  const first = row({
      project: "Alpha Copper Ridge Project",
      externalId: "one",
    }),
    second = row({ project: "Alpha Copper Valley Project", externalId: "two" });
  const baseline = await buildProjectIntelligence([first, second], [source]);
  const projects = await buildProjectIntelligence(
    [
      first,
      second,
      row({
        project: "Alpha Copper Project",
        externalId: "bridge",
        qualityFlags: ["INVALID_INPUT"],
      }),
    ],
    [source],
  );
  expect(
    projects
      .filter((p) => p.promotionEligible !== false)
      .map((p) => p.id)
      .sort(),
  ).toEqual(baseline.map((p) => p.id).sort());
  expect(projects.reduce((count, p) => count + p.records.length, 0)).toBe(3);
});
it("reading a project projection never creates or updates stage snapshots", async () => {
  await buildProjectIntelligence([row()], [source]);
  expect(storage.add).not.toHaveBeenCalled();
  expect(storage.update).not.toHaveBeenCalled();
});
it("commercial event scanning independently ignores restricted record text even in a stale projection", async () => {
  const [project] = await buildProjectIntelligence(
    [
      row({
        description: "Permit application",
        company: "",
        organisationRole: "UNKNOWN",
        sourceKey: "qa-permit",
      }),
    ],
    [source],
  );
  project.records.push(row({ externalId: "bad", contextOnly: true }));
  const events = buildCommercialIntelligence([project], [], [source]).events;
  expect(events.map((e) => e.type)).not.toContain("SHUTDOWN");
});

it("ignores stale derived stages when every underlying record is held", async () => {
  const [project] = await buildProjectIntelligence([row()], [source]);
  project.records = project.records.map((record) => ({
    ...record,
    contextOnly: true,
  }));
  delete project.promotionEligible;
  project.stageLabel = "AWARDED";
  const commercial = buildCommercialIntelligence([project], [], [source]);
  for (const key of [
    "events",
    "pilotQueue",
    "equipmentClusters",
    "contractorWorkload",
    "fleetPositioning",
  ] as const)
    expect(commercial[key]).toEqual([]);
});

it("held counts cannot break a commercial ranking tie or change queue membership", async () => {
  const first = row({ project: "Northern Copper Mine", externalId: "north" }),
    second = row({ project: "Southern Copper Mine", externalId: "south" });
  const baseline = await buildProjectIntelligence([first, second], [source]);
  const augmented = await buildProjectIntelligence(
    [
      first,
      second,
      { ...second, externalId: "held", qualityFlags: ["INVALID_INPUT"] },
    ],
    [source],
  );
  expect(augmented.map((project) => project.id)).toEqual(
    baseline.map((project) => project.id),
  );
  const queue = (projects: any) =>
    buildCommercialIntelligence(projects, [], [source]).pilotQueue.map(
      (project) => ({ id: project.projectId, rank: project.rank }),
    );
  expect(queue(augmented)).toEqual(queue(baseline));
});
