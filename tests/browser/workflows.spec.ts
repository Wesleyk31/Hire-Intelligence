import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const project = {
  id: 'qa-project-1', name: 'QA Pilbara Road Upgrade', location: 'Pilbara WA', company: 'QA Delivery Co', contractors: ['QA Delivery Co'],
  sources: ['qa-source'], records: [{ externalId: 'qa-1', project: 'QA Pilbara Road Upgrade', location: 'Pilbara WA', company: 'QA Delivery Co', sourceKey: 'qa-source', provenance: 'Synthetic browser-test fixture only', description: 'Construction roadwork', observedAt: '2026-09-15', value: 'Not stated' }],
  evidenceCount: 1, value: 'Not stated', stageLabel: 'CONSTRUCTION', stageConfidence: 85, stageReason: 'QA evidence', stageChanged: false, previousStage: '',
  equipmentPrediction: { label: 'PREDICTED', classes: ['Excavators'], confidence: 70, confidenceBand: 'MEDIUM', reason: 'QA inference' },
  signalQualityScore: 85, signalQualityBand: 'A', bdmPriority: 85, priorityBand: 'HIGH', callNow: true,
};
async function setup(page: Page, flags = { failHistory: false, failSave: false }) {
  const histories: Record<string, any[]> = {};
  const outcomes: Record<string, any[]> = {};
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/__qa/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__qa', '');
    const user = request.headers()['x-qa-user'];
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/api/public/summary') return reply({ metrics: { active: 2, highPriority: 1, eventSignals: 1 }, sources: { configured: 1, active: 1 }, regionalCounts: { WA: 1 }, universe: { loaded: 2, truncated: false } });
    if (path === '/api/demo-request') return reply({ ok: true, id: 'qa-request' }, 201);
    if (!user) return reply({ error: 'Unauthorized' }, 401);
    if (path === '/api/reports/history') {
      if (request.method() === 'GET') return flags.failHistory ? reply({}, 503) : reply(histories[user] || []);
      if (flags.failSave) return reply({}, 503);
      const saved = { ...request.postDataJSON(), id: `qa-report-${(histories[user] || []).length + 1}` };
      histories[user] = [saved, ...(histories[user] || [])];
      return reply(saved, 201);
    }
    if (path === '/api/pilot/outcomes' && request.method() === 'POST') {
      const row = request.postDataJSON();
      if (row.result === 'QUOTED' && Number(row.quoteValue) <= 0) return reply({ error: 'Positive quote required' }, 400);
      outcomes[user] = [{ ...row, project: project.name, recordedAt: '2026-09-15', qa: row.qa === 'true' }, ...(outcomes[user] || [])];
      return reply({ id: 'qa-outcome' }, 201);
    }
    return reply({
      metrics: { callNow: 1, active: 2, highPriority: 1 }, projects: [project, { ...project, id: 'qa-unmapped', name: 'QA Unmapped', location: '', records: [], company: '', contractors: [], bdmPriority: 40, priorityBand: 'WATCH', callNow: false }],
      commercial: { events: [{ projectId: project.id, project: project.name, location: project.location, type: 'CONSTRUCTION', confidence: 85, reason: 'QA event' }], calibration: {}, scopeProgram: [], pilotQueue: [] },
      sources: { configured: 1, active: 1, runtimeFetched: 2, states: [{ sourceKey: 'qa-source', name: 'QA source', status: 'SUCCESS', recordsFetched: 2, lastRun: '2026-09-15', provenance: 'QA fixture', licence: 'QA only' }], deferred: [] },
      pilot: { recentOutcomes: outcomes[user] || [] }, backfill: { processed: 0, completedSources: 0, totalSources: 1, nextSource: 'qa-source', lastSource: '', lastRun: '', lastError: '' },
      coverage: 'Isolated QA fixtures', universe: { loaded: 2, truncated: false },
    });
  });
  return { errors, histories, outcomes };
}
async function signIn(page: Page) {
  await page.goto('/#platform/decision-desk');
  await page.getByRole('button', { name: 'Sign in to Hire Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Decision Desk', exact: true })).toBeVisible();
}

test('public navigation, sign-in gate and all twelve operational modules', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/');
  for (const name of ['Products', 'Solutions', 'Industries', 'Insights', 'About']) {
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp('#' + name.toLowerCase() + '$'));
  }
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);
  await page.goto('/#platform/decision-desk');
  await expect(page.getByRole('heading', { name: 'Secure workspace' })).toBeVisible();
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);
  await signIn(page);
  const links = page.getByRole('navigation', { name: 'Hire Intelligence modules' }).getByRole('link');
  expect(await links.count()).toBe(12);
  for (const name of await links.allTextContents()) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
  }
  expect(state.errors).toEqual([]);
});

test('project drawer and map show provenance and unique mapped projects', async ({ page }) => {
  const state = await setup(page);
  await signIn(page);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.locator('.hi-table-row').filter({ hasText: project.name }).click();
  await expect(page.getByText('Evidence & provenance', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic browser-test fixture only', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close project intelligence' }).click();
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.locator('.map-legend')).toContainText('1 projects · 1 signals · 1 unmapped · 1 high');
  await page.locator('.map-filters select').first().selectOption('PROJECTS');
  await expect(page.locator('.map-legend')).toContainText('1 projects · 0 signals · 1 unmapped · 1 high');
  expect(state.errors).toEqual([]);
});

test('CRM guardrail, durable report history, account separation and PDF download', async ({ page }) => {
  const state = await setup(page);
  await signIn(page);
  await page.getByRole('link', { name: 'CRM', exact: true }).click();
  await page.locator('select[name=projectId]').selectOption(project.id);
  await page.locator('select[name=result]').selectOption('QUOTED');
  await page.getByRole('button', { name: 'Record outcome' }).click();
  await expect(page.getByText('Outcome rejected', { exact: false })).toBeVisible();
  await page.getByLabel('Quote value AUD').fill('1000');
  await page.getByRole('button', { name: 'Record outcome' }).click();
  await expect(page.getByText('Measured human-entered BDM outcome recorded.')).toBeVisible();
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await page.getByRole('button', { name: 'Save report snapshot' }).click();
  await expect(page.getByText('Current report snapshot saved from the visible evidence set.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Executive Intelligence Report', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadPromise;
  const pdfPath = test.info().outputPath('executive-report.pdf');
  await download.saveAs(pdfPath);
  expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.evaluate(() => sessionStorage.setItem('hire-test-actor', 'qa-b'));
  await signIn(page);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('No report snapshots generated yet.')).toBeVisible();
  expect(state.histories['qa-b'] || []).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test('report failures cannot expose another account or claim a successful save', async ({ page }) => {
  const state = await setup(page, { failHistory: true, failSave: true });
  await page.addInitScript(() => localStorage.setItem('hirer-reports', JSON.stringify([{ id: 'other', at: '2026-09-01', summary: 'OTHER ACCOUNT PRIVATE REPORT' }])));
  await signIn(page);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByText('OTHER ACCOUNT PRIVATE REPORT')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save report snapshot' }).click();
  await expect(page.getByText('Report snapshot could not be saved.', { exact: false })).toBeVisible();
  await expect(page.getByText('Executive Intelligence Report', { exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('mobile conversion, footer legal pages and expired-session recovery', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get a demo', exact: false }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('QA Customer');
  await dialog.getByLabel('Company', { exact: true }).fill('QA Company');
  await dialog.getByLabel('Business email').fill('invalid');
  await dialog.getByRole('button', { name: 'Request demo', exact: true }).click();
  await expect(dialog.getByText('Request received.', { exact: false })).toHaveCount(0);
  await dialog.getByLabel('Business email').fill('qa@example.test');
  await dialog.getByRole('button', { name: 'Request demo', exact: true }).click();
  await expect(dialog.getByText('Request received.', { exact: false })).toBeVisible();
  for (const hash of ['contact', 'privacy', 'terms']) {
    await page.goto('/#' + hash);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.evaluate(() => sessionStorage.setItem('hire-test-auth-error', '1'));
  await page.goto('/#platform/decision-desk');
  await expect(page.getByRole('heading', { name: 'Secure workspace' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const panel = await page.locator('.auth-panel').boundingBox();
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(375 - 24);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('mobile-sign-in.png'), fullPage: true });
});
