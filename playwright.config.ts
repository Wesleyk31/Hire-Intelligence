import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', headless: true, channel: 'chrome', viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
  reporter: [['list'], ['json', { outputFile: 'test-results/browser-results.json' }]],
  webServer: { command: 'node node_modules/vite/bin/vite.js --config vite.verification.config.ts', url: 'http://127.0.0.1:4175', reuseExistingServer: true, timeout: 60000 },
});
