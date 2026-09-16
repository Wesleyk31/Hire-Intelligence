import { defineConfig } from '@playwright/test';
// Installed Windows Edge, isolated from the main Chrome verification server.
export default defineConfig({
  testDir:'./tests/browser',
  testMatch:['workflows.spec.ts','evidence-window.spec.ts','evidence-window-race.spec.ts','evidence-review.spec.ts','source-diagnostics.spec.ts'],
  fullyParallel:false,workers:2,outputDir:'.local/edge-results',
  use:{baseURL:'http://127.0.0.1:4177',headless:true,channel:'msedge',viewport:{width:1280,height:800},trace:'retain-on-failure'},
  reporter:[['list'],['json',{outputFile:'.local/edge-results/results.json'}]],
  webServer:{command:'node node_modules/vite/bin/vite.js --config vite.verification.config.ts --port 4177 --strictPort',url:'http://127.0.0.1:4177',reuseExistingServer:false,timeout:60000},
});
