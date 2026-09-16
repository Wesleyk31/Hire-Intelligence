import { test, expect } from "@playwright/test";
import { setupAudit, enter, project, checkViewport } from "./audit-fixtures";
test("held evidence is disclosed and collection time is separate from unknown source activity", async ({
  page,
}) => {
  const held = {
    ...project,
    promotionEligible: false,
    eligibleEvidenceCount: 0,
    heldEvidenceCount: 1,
    holdReasons: ["INVALID_INPUT"],
    stageLabel: "WATCH",
    stageConfidence: 0,
    stageChanged: false,
    bdmPriority: 0,
    priorityBand: "WATCH",
    signalQualityScore: 0,
    contractors: [],
    company: "",
    callNow: false,
    equipmentPrediction: {
      ...project.equipmentPrediction,
      classes: [],
      confidence: 0,
    },
    records: [
      {
        ...project.records[0],
        sourceObservedAt: "",
        contextOnly: true,
        qualityFlags: ["INVALID_INPUT"],
      },
    ],
  };
  const audit = await setupAudit(page, {
    overrides: {
      projects: [held],
      commercial: {
        events: [],
        pilotQueue: [],
        equipmentClusters: [],
        fleetPositioning: [],
        contractorWorkload: [],
      },
      metrics: { callNow: 0, highPriority: 0, active: 1, eventSignals: 0 },
    },
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await enter(page, "projects");
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  const drawer = page.getByRole("dialog", { name: "Project intelligence" });
  await expect(drawer).toContainText("1 held for context or quality review");
  await expect(drawer).toContainText(
    "excluded from scoring and demand signals",
  );
  await expect(drawer).toContainText("Source activity: Unknown");
  await expect(drawer).toContainText("Collected:");
  await expect(drawer).toContainText("Held for review");
  await expect(drawer).toContainText("INVALID_INPUT");
  await checkViewport(page);
  expect(audit.errors).toEqual([]);
});
