import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { enter, setupAudit } from './audit-fixtures';

const operationalModule = /\/FunctionalApp(?:\.tsx|-)/;
const mapModule = /\/GeoMap(?:\.tsx|-)/;
const pdfModule = /\/jspdf[.-]/;

function holdRequest() {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
}

test('loads workspace, map and PDF code only when their workflows are used', async ({ page }) => {
  const state = await setupAudit(page);
  const requested: string[] = [];
  page.on('request', request => requested.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  expect(requested.filter(url => operationalModule.test(url) || mapModule.test(url) || pdfModule.test(url))).toEqual([]);
  await page.goto('/#platform/decision-desk');
  await expect(page.getByRole('heading', { name: 'Secure workspace' })).toBeVisible();
  expect(requested.filter(url => operationalModule.test(url))).toEqual([]);
  await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Sign in to Hire Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Decision Desk', exact: true })).toBeVisible();
  expect(requested.some(url => operationalModule.test(url))).toBe(true);
  expect(requested.filter(url => mapModule.test(url) || pdfModule.test(url))).toEqual([]);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.locator('.australia-map.leaflet-container')).toBeVisible();
  expect(requested.some(url => mapModule.test(url))).toBe(true);
  expect(requested.filter(url => pdfModule.test(url))).toEqual([]);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  expect(requested.filter(url => pdfModule.test(url))).toEqual([]);
  const held = holdRequest();
  await page.route(pdfModule, async route => { await held.pending; await route.continue(); });
  const download = page.waitForEvent('download');
  try {
    await page.getByRole('button', { name: 'Download PDF' }).click();
    await expect(page.getByRole('button', { name: 'Generating PDF' })).toBeDisabled();
    expect(state.mutations.filter(item => item.path === '/api/reports/history')).toEqual([]);
  } finally { held.release(); }
  const file = await download;
  const target = test.info().outputPath('deferred-executive-report.pdf');
  await file.saveAs(target);
  expect((await readFile(target)).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.locator('.hi-message')).toContainText('PDF report generated');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(requested.some(url => pdfModule.test(url))).toBe(true);
  expect(state.mutations.filter(item => item.path === '/api/reports/history')).toHaveLength(1);
  expect(state.errors).toEqual([]);
  await test.info().attach('deferred-module-requests', { body: JSON.stringify(requested.filter(url => operationalModule.test(url) || mapModule.test(url) || pdfModule.test(url)), null, 2), contentType: 'application/json' });
});

test('slow workspace and map modules show loading states before rendering', async ({ page }) => {
  await setupAudit(page);
  const workspace = holdRequest();
  await page.route(operationalModule, async route => { await workspace.pending; await route.continue(); });
  await page.goto('/#platform/decision-desk');
  try {
    await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Sign in to Hire Intelligence' }).click();
    await expect(page.getByRole('status')).toContainText('Loading workspace');
  } finally { workspace.release(); }
  await expect(page.getByRole('heading', { name: 'Decision Desk', exact: true })).toBeVisible();
  const map = holdRequest();
  await page.route(mapModule, async route => { await map.pending; await route.continue(); });
  try {
    await page.getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Loading map');
    await expect(page.getByRole('link', { name: 'Projects', exact: true })).toBeVisible();
  } finally { map.release(); }
  await expect(page.locator('.australia-map.leaflet-container')).toBeVisible();
});

test('workspace chunk failure offers reload and preserves the authenticated route', async ({ page }) => {
  await setupAudit(page);
  await page.route(operationalModule, route => route.abort());
  await page.goto('/#platform/reports');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password-only');
  await page.getByRole('button', { name: 'Sign in to Hire Intelligence' }).click();
  await expect(page.getByRole('alert')).toContainText('Workspace could not be loaded');
  await page.unroute(operationalModule);
  await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
});

test('map chunk failure leaves navigation usable and reload restores the map', async ({ page }) => {
  await setupAudit(page);
  await page.route(mapModule, route => route.abort());
  await enter(page);
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Map could not be loaded');
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await page.unroute(mapModule);
  await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await expect(page.locator('.australia-map.leaflet-container')).toBeVisible();
});

test('failed PDF library load saves no history and recovers after reload', async ({ page }) => {
  const state = await setupAudit(page);
  await page.route(pdfModule, route => route.abort());
  await enter(page, 'reports');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  await expect(page.locator('.hi-message')).toContainText('PDF report could not be generated');
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(state.mutations.filter(item => item.path === '/api/reports/history')).toEqual([]);
  await page.unroute(pdfModule);
  await page.reload();
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await expect(page.locator('.hi-message')).toContainText('PDF report generated');
});

test('leaving the workspace cancels a PDF waiting for its libraries', async ({ page }) => {
  const state = await setupAudit(page);
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  const held = holdRequest();
  await page.route(pdfModule, async route => { await held.pending; await route.continue(); });
  await enter(page, 'reports');
  try {
    await page.getByRole('button', { name: 'Download PDF' }).click();
    await expect(page.getByRole('button', { name: 'Generating PDF' })).toBeDisabled();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  } finally { held.release(); }
  await page.waitForLoadState('networkidle');
  expect(downloads).toEqual([]);
  expect(state.mutations.filter(item => item.path === '/api/reports/history')).toEqual([]);
});
