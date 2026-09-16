import { expect, type Page } from '@playwright/test';

// Synthetic UI fixtures only; these tests do not assert production feed availability.
export const project = {
  id: 'audit-pilbara', name: 'AUDIT Pilbara Mine Upgrade', location: 'Pilbara WA', company: 'AUDIT Delivery Co', contractors: ['AUDIT Delivery Co'],
  sources: ['audit-mining'], records: [{ externalId: 'audit-1', project: 'AUDIT Pilbara Mine Upgrade', location: 'Pilbara WA', company: 'AUDIT Delivery Co', sourceKey: 'audit-mining', provenance: 'Synthetic browser audit fixture only', description: 'Mining construction roadwork', observedAt: new Date().toISOString(), sourceObservedAt: new Date().toISOString(), value: 'Not stated' }],
  evidenceCount: 1, value: 'Not stated', stageLabel: 'CONSTRUCTION', stageConfidence: 85, stageReason: 'Audit evidence', stageChanged: true, previousStage: 'APPROVED',
  equipmentPrediction: { label: 'PREDICTED', classes: ['Excavators'], confidence: 70, confidenceBand: 'MEDIUM', reason: 'Synthetic audit inference' },
  signalQualityScore: 85, signalQualityBand: 'A', bdmPriority: 85, priorityBand: 'HIGH', callNow: true,
};
export const modules = [
  ['decision-desk', 'Decision Desk'], ['commercial-intelligence', 'Commercial Intelligence'], ['opportunities', 'Opportunities'],
  ['projects', 'Projects'], ['map', 'Map'], ['organisations-delivery-teams', 'Organisations & Delivery Teams'],
  ['equipment-demand', 'Equipment Demand'], ['resources', 'Resources'], ['crm', 'CRM'], ['reports', 'Reports'], ['alerts', 'Alerts'], ['source-admin', 'Source Admin'],
] as const;
export const pages = [
  ['home', 'See further.'], ['products', 'One operating system'], ['solutions', 'Built around the decisions'], ['industries', 'Australian project intelligence'],
  ['insights', 'A current view'], ['about', 'Earlier visibility'], ['contact', 'See Hire Intelligence in action'], ['privacy', 'Privacy and data handling'], ['terms', 'Platform use and intelligence limitations'],
] as const;
export type Options = { empty?: boolean; failDashboard?: boolean; failDemo?: boolean; failHistory?: boolean; failSave?: boolean; failSummary?: boolean; reportWindow?: boolean; overrides?: Record<string, any>; };
export async function setupAudit(page: Page, flags: Options = {}) {
  const errors: string[] = [], consoleErrors: string[] = [], failedRequests: string[] = [], mutations: Array<{path: string; data: any}> = [];
  const histories: Record<string, any[]> = {}, outcomes: any[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource: the server responded with a status of')) consoleErrors.push(message.text()); });
  page.on('requestfailed', request => {
    // Leaflet cancels tiles from intermediate zoom levels during animated navigation.
    if (request.url().includes('tile.openstreetmap.org') && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    failedRequests.push(request.url() + ': ' + request.failure()?.errorText);
  });
  // No external tile traffic: deterministic stand-in image, not a claim of live map service coverage.
  await page.route('**/*tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf0f2"/></svg>' }));
  await page.route('**/__qa/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/__qa', '');
    const user = request.headers()['x-qa-user'];
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'POST') mutations.push({ path, data: request.postDataJSON() });
    if (path === '/api/public/summary') return flags.failSummary ? reply({}, 503) : reply({ metrics: { active: 3, highPriority: 1, eventSignals: 2 }, sources: { configured: 1, active: 1 }, regionalCounts: { WA: 1 }, universe: { loaded: 3, truncated: false } });
    if (path === '/api/demo-request') return flags.failDemo ? reply({}, 503) : reply({ ok: true, id: 'audit-demo' }, 201);
    if (!user) return reply({ error: 'Unauthorized' }, 401);
    if (path === '/api/reports/history') {
      if (request.method() === 'GET') return flags.failHistory ? reply({}, 503) : reply(flags.reportWindow ? { reports: histories[user] || [], loaded: 1000, truncated: true } : histories[user] || []);
      if (flags.failSave) return reply({}, 503);
      const saved = { ...request.postDataJSON(), id: 'audit-report-' + ((histories[user] || []).length + 1) };
      histories[user] = [saved, ...(histories[user] || [])]; return reply(saved, 201);
    }
    if (path === '/api/pilot/outcomes' && request.method() === 'POST') {
      const row = request.postDataJSON();
      if ((row.result === 'QUOTED' && !(Number(row.quoteValue) > 0)) || (row.result === 'WON' && !(Number(row.wonValue) > 0))) return reply({ error: 'Positive value required' }, 400);
      outcomes.unshift({ ...row, project: project.name, recordedAt: new Date().toISOString(), qa: row.qa === 'true' }); return reply({ id: 'audit-outcome' }, 201);
    }
    if (path !== '/api/dashboard') return reply({ error: 'Unexpected audit route' }, 404);
    if (flags.failDashboard) return reply({}, 503);
    const secondary = { ...project, id: 'audit-hunter', name: 'AUDIT Hunter Rail', location: 'Hunter NSW', contractors: [], sources: ['audit-civil'], company: '', records: [], stageLabel: 'PROCUREMENT', stageChanged: false, bdmPriority: 65, priorityBand: 'MEDIUM', callNow: false };
    const unmapped = { ...secondary, id: 'audit-unmapped', name: 'AUDIT Unmapped', location: '', stageLabel: 'EARLY_SIGNAL', bdmPriority: 30, priorityBand: 'WATCH' };
    return reply({
      metrics: { callNow: flags.empty ? 0 : 1, active: flags.empty ? 0 : 3, highPriority: flags.empty ? 0 : 1, eventSignals: flags.empty ? 0 : 2 },
      projects: flags.empty ? [] : [project, secondary, unmapped],
      commercial: { events: flags.empty ? [] : [
        { projectId: project.id, project: project.name, location: project.location, type: 'SHUTDOWN', confidence: 85, reason: 'Outage maintenance signal', detectedAt: new Date().toISOString(), priorityBand: 'HIGH' },
        { projectId: secondary.id, project: secondary.name, location: secondary.location, type: 'PROCUREMENT', confidence: 65, reason: 'Tender signal', priorityBand: 'MEDIUM' },
      ], calibration: {}, scopeProgram: [], pilotQueue: flags.empty ? [] : [{ rank: 1, projectId: project.id, project: project.name, location: project.location, stage: project.stageLabel, bdmPriority: 85, action: 'Review evidence' }], contractorWorkload: [], equipmentClusters: [], fleetPositioning: [], sourceCoverage: [] },
      sources: { configured: 1, active: flags.empty ? 0 : 1, runtimeFetched: flags.empty ? 0 : 3, states: flags.empty ? [] : [{ sourceKey: 'audit-mining', name: 'AUDIT source', status: 'SUCCESS', recordsFetched: 3, lastRun: new Date().toISOString(), provenance: 'Synthetic audit fixture', licence: 'Audit only' }], deferred: [] },
      pilot: { recentOutcomes: outcomes }, backfill: { processed: 0, completedSources: 0, totalSources: 1, nextSource: 'audit-mining', lastSource: '', lastRun: '', lastError: '' },
      coverage: 'Synthetic isolated browser audit fixtures', universe: { loaded: flags.empty ? 0 : 3, truncated: false }, ...flags.overrides,
    });
  });
  return { errors, consoleErrors, failedRequests, mutations, histories, outcomes };
}
export async function enter(page: Page, slug = 'decision-desk') {
  await page.goto('/#platform/' + slug);
  await page.getByRole('button', { name: 'Sign in to Hire Intelligence' }).click();
  await expect(page.locator('.hi-page-head h1')).toBeVisible();
}
export async function checkViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must fit viewport').toBe(true);
}
