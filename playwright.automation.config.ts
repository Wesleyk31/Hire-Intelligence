import { defineConfig } from "@playwright/test";

const production = process.env.HI_SMOKE_TARGET === "production";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: production
    ? ["automation-smoke.spec.ts"]
    : [
        "workflows.spec.ts",
        "source-health.spec.ts",
        "source-diagnostics.spec.ts",
        "evidence-eligibility.spec.ts",
      ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: production
      ? "https://hirer-intelligence-mfj58p.v2.appdeploy.ai"
      : "http://127.0.0.1:4195",
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/automation-browser.json" }],
  ],
  ...(production
    ? {}
    : {
        webServer: {
          command:
            "node node_modules/vite/bin/vite.js --config vite.verification.config.ts --port 4195",
          url: "http://127.0.0.1:4195",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
