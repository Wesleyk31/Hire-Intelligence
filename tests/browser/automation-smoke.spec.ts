import { test, expect } from "@playwright/test";

// Production tests use real anonymous requests. Authenticated workspace rendering
// is covered separately by local fixtures; no fabricated user is injected here.
test("production public home loads and workspace retains its authentication boundary", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && /appdeploy\.ai\//.test(response.url()))
      errors.push("Backend HTTP " + response.status());
  });
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  const summary = await request.get(
    "https://api-v2.appdeploy.ai/app/hirer-intelligence-mfj58p/api/public/summary",
  );
  expect(
    summary.status(),
    "Production public summary must return HTTP 200",
  ).toBe(200);
  expect(summary.headers()["content-type"]).toContain("application/json");
  const summaryData = await summary.json();
  expect(typeof summaryData.metrics.active).toBe("number");
  await page.goto("/#platform/decision-desk");
  await expect(
    page.getByRole("heading", { name: "Secure workspace" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in to Hire Intelligence" }),
  ).toBeVisible();
  await expect(page.locator(".hi-page-head")).toHaveCount(0);
  const protectedData = await request.get(
    "https://api-v2.appdeploy.ai/app/hirer-intelligence-mfj58p/api/dashboard",
  );
  expect([401, 403]).toContain(protectedData.status());
  expect(errors).toEqual([]);
});
