import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig(base, {
  testMatch: [
    "source-health.spec.ts",
    "source-diagnostics.spec.ts",
    "evidence-review.spec.ts",
  ],
  use: { baseURL: "http://127.0.0.1:4185" },
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/wave1-results.json" }],
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config vite.verification.config.ts --port 4185",
    url: "http://127.0.0.1:4185",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
