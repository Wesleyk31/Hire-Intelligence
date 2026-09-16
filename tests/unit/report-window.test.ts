import { expect, it } from "vitest";
import { buildExecutiveReportSummary } from "../../src/reporting";

it("keeps final continuation-window scope and separate account/system scope in exported report text", () => {
  const summary = buildExecutiveReportSummary({
    projects: [{ priorityBand: "HIGH" }],
    commercial: { events: [] },
    universe: {
      loaded: 1,
      liveLoaded: 0,
      archiveRecordsLoaded: 1,
      truncated: false,
      windowOnly: true,
    },
  });
  expect(summary.headline).toContain("this evidence window");
  expect(summary.dataWindow).toContain("this evidence window");
  expect(summary.dataWindow).toMatch(/earlier windows/i);
  expect(summary.dataWindow).toMatch(/CRM.*account/i);
  expect(summary.dataWindow).toMatch(/source health.*backfill.*system/i);
});

it("discloses evidence held for review separately from scored evidence", () => {
  const summary = buildExecutiveReportSummary({
    projects: [
      {
        eligibleEvidenceCount: 2,
        heldEvidenceCount: 3,
        promotionEligible: true,
        priorityBand: "HIGH",
      },
      {
        eligibleEvidenceCount: 0,
        heldEvidenceCount: 1,
        promotionEligible: false,
        priorityBand: "WATCH",
      },
    ],
  });
  expect(summary.heldEvidenceCount).toBe(4);
  expect(summary.eligibleEvidenceCount).toBe(2);
  expect(summary.dataWindow).toContain(
    "4 evidence records held for context or quality review",
  );
  expect(summary.dataWindow).toContain(
    "excluded from scoring and demand signals",
  );
});
