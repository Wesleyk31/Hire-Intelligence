import { expect, test } from "@playwright/test";
import { enter, setupAudit, checkViewport } from "./audit-fixtures";

const contract = {
  schemaVersion: 1,
  key: "audit-mining",
  name: "Synthetic source contract",
  version: "a".repeat(64),
  activation: "DISABLED",
  activationReason: "Rights review pending",
  owningAgency: "QA agency",
  endpoint: "https://example.test/feed",
  provenance: "https://example.test/catalogue",
  resourceVersion: "UNVERIFIED",
  rights: { status: "UNKNOWN" },
  allowedUses: {
    commercial: "REVIEW_REQUIRED",
    redistribution: "REVIEW_REQUIRED",
  },
  cadence: { publisher: "UNKNOWN" },
  dates: { eventSemantics: "UNVERIFIED" },
  attribution: { licenceLabel: "Unknown" },
};
const receipt = {
  receiptId: "receipt-1",
  sourceKey: contract.key,
  schemaVersion: 1,
  mode: "REFRESH",
  startedAt: "2026-09-18T00:00:00.000Z",
  finishedAt: "2026-09-18T00:01:00.000Z",
  outcome: "FAILED",
  transport: { status: "HTTP_ERROR", httpStatus: 406 },
  parser: "NOT_OBSERVED",
  counts: {
    received: null,
    normalised: null,
    unique: null,
    held: null,
    acknowledged: 0,
    duplicate: null,
    uncertain: null,
    unacknowledged: null,
  },
  reconciliation: "REVIEW_REQUIRED",
  persistenceUncertain: true,
  dates: { newest: null },
  failure: "HTTP_406",
  countBasis: "Held rows are a subset, not commercial promotions.",
};
const response = {
  contract,
  receipts: [receipt],
  health: {
    transport: receipt.transport,
    parser: receipt.parser,
    rights: "UNKNOWN",
    eventDates: "UNKNOWN",
    newestSourceDate: null,
    freshness: "UNVERIFIED_CADENCE_AND_EVENT_SEMANTICS",
    ingestion: "RECONCILIATION_REQUIRED",
    lastAcknowledgedIngestion: null,
  },
  nextCursor: null,
  coverage: { complete: true, scope: "THIS_PAGE_ONLY", omittedInvalid: 0 },
  disclosure:
    "This page only. Source dates do not establish a new project event.",
};

test("source contracts and uncertain receipts stay read-only and unknown counts are not rendered as zero", async ({
  page,
}) => {
  const state = await setupAudit(page);
  await page.route("**/__qa/api/sources/contracts", (route) =>
    route.fulfill({ json: { contracts: [contract] } }),
  );
  await page.route("**/__qa/api/sources/audit-mining/health", (route) =>
    route.fulfill({ json: response }),
  );
  await enter(page, "source-admin");
  const panel = page.getByRole("region", {
    name: "Source contracts and pull receipts",
  });
  await panel.getByRole("button", { name: "Load source register" }).click();
  await panel.getByRole("button", { name: "View pull history" }).click();
  await expect(panel).toContainText("Received: Unknown");
  await expect(panel).toContainText("Acknowledged: 0");
  await expect(panel).toContainText("HTTP 406");
  await expect(panel).toContainText("Rights review pending");
  await expect(panel).toContainText("No confirmed ingestion in this page");
  await expect(panel).toContainText("RECONCILIATION REQUIRED");
  await page.setViewportSize({ width: 390, height: 844 });
  await checkViewport(page);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("failed history requests can be retried and paging discloses scope", async ({
  page,
}) => {
  await setupAudit(page);
  await page.route("**/__qa/api/sources/contracts", (route) =>
    route.fulfill({ json: { contracts: [contract] } }),
  );
  let calls = 0;
  await page.route("**/__qa/api/sources/audit-mining/health*", (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        ...response,
        receipts: calls === 2 ? [receipt] : [],
        nextCursor: calls === 2 ? "page2" : null,
        coverage: { ...response.coverage, complete: false },
      },
    });
  });
  await enter(page, "source-admin");
  const panel = page.getByRole("region", {
    name: "Source contracts and pull receipts",
  });
  await panel.getByRole("button", { name: "Load source register" }).click();
  await panel.getByRole("button", { name: "View pull history" }).click();
  await expect(panel.getByRole("alert")).toContainText("could not be loaded");
  await panel.getByRole("button", { name: "View pull history" }).click();
  await expect(panel).toContainText("Partial history");
  await panel.getByRole("button", { name: "Next receipt page" }).click();
  await expect(panel).toContainText("No pull receipts in this page");
});
