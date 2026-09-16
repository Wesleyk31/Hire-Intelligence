import { expect, test, type Page } from '@playwright/test';
import { checkViewport, enter, setupAudit } from './audit-fixtures';

const endpoint = '**/__qa/api/sources/*/diagnostic';
const response = (extra = {}) => ({
  source: { key: 'audit-mining', name: 'AUDIT source', enabled: true, licence: 'Synthetic audit licence', provenance: 'https://example.test/source' },
  durationMs: 321, recordsFetched: 12, observedAt: '2026-09-16T10:00:00.000Z', persisted: false,
  sample: [
    { sourceKey: 'audit-mining', externalId: 'old', project: 'SYNTHETIC historical sample', location: 'Pilbara WA', sourceObservedAt: '2020-01-01', observedAt: '2026-09-16T10:00:00.000Z', provenance: 'https://example.test/original' },
    { sourceKey: 'audit-mining', externalId: 'undated', project: 'SYNTHETIC undated sample', location: 'Perth WA', observedAt: '2026-09-16T10:00:00.000Z', provenance: 'Synthetic undated original' },
  ],
  disclosure: 'Read-only bounded collector check. No records were saved and this does not establish scheduled ingestion reliability.', ...extra,
});
async function setup(page: Page, options = {}) {
  const state = await setupAudit(page, options);
  const requests: Array<{ method: string; path: string; user: string }> = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/diagnostic')) requests.push({ method: request.method(), path: new URL(request.url()).pathname, user: request.headers()['x-qa-user'] || '' });
  });
  return { ...state, requests };
}
const panelFor = (page: Page) => page.getByRole('region', { name: 'Collector diagnostics', exact: true });

test('collector diagnostic is an explicit authenticated GET and separates source activity from collection', async ({ page }) => {
  const state = await setup(page);
  await page.route(endpoint, route => route.fulfill({ json: response() }));
  await enter(page, 'source-admin');
  const panel = panelFor(page);
  await expect(panel.getByRole('combobox', { name: 'Collector source' })).toHaveValue('audit-mining');
  expect(state.requests).toEqual([]);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel).toContainText('12 rows returned');
  await expect(panel).toContainText('Showing 2 sample records');
  await expect(panel).toContainText('321 ms');
  const historical = panel.getByRole('article').filter({ hasText: 'SYNTHETIC historical sample' });
  await expect(historical).toContainText('Source activity: 2020-01-01');
  await expect(historical).toContainText('Collected: 2026-09-16T10:00:00.000Z');
  const undated = panel.getByRole('article').filter({ hasText: 'SYNTHETIC undated sample' });
  await expect(undated).toContainText('Source activity: Unknown');
  await expect(undated).not.toContainText('Source activity: 2026');
  await expect(panel).toContainText('No records were saved');
  expect(state.requests).toEqual([{ method: 'GET', path: '/__qa/api/sources/audit-mining/diagnostic', user: 'qa-a' }]);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('a slow failing collector disables duplicate checks and can be retried cleanly', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route(endpoint, async route => {
    if (++calls === 1) { await held; return route.fulfill({ status: 503, json: { error: 'Provider unavailable' } }); }
    return route.fulfill({ json: response() });
  });
  await enter(page, 'source-admin');
  const panel = panelFor(page);
  try {
    await panel.getByRole('button', { name: 'Run collector check' }).click();
    await expect(panel.getByRole('button', { name: 'Checking collector' })).toBeDisabled();
    await expect(panel.getByRole('combobox', { name: 'Collector source' })).toBeDisabled();
    await expect(panel.getByRole('status')).toContainText('Checking collector');
    expect(calls).toBe(1);
  } finally { release(); }
  await expect(panel.getByRole('alert')).toContainText('Collector check failed');
  await expect(panel.getByRole('article')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel).toContainText('12 rows returned');
  expect(state.requests.map(request => request.method)).toEqual(['GET', 'GET']);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('zero returned rows remain inconclusive rather than being shown as a healthy feed', async ({ page }) => {
  const state = await setup(page);
  await page.route(endpoint, route => route.fulfill({ json: response({ recordsFetched: 0, sample: [] }) }));
  await enter(page, 'source-admin');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel.getByRole('status')).toContainText('No rows were returned');
  await expect(panel).toContainText('empty source from a feed or parser problem');
  await expect(panel).not.toContainText('healthy');
  expect(state.mutations).toEqual([]);
});

test('selecting another known source clears the previous sample before the next check', async ({ page }) => {
  const state = await setup(page, { overrides: { sources: { configured: 2, active: 1, runtimeFetched: 12, deferred: [], states: [
    { sourceKey: 'audit-mining', name: 'AUDIT source', status: 'SUCCESS', recordsFetched: 12 },
    { sourceKey: 'audit-road', name: 'AUDIT road source', status: 'DEGRADED', recordsFetched: 0 },
  ] } } });
  await page.route(endpoint, route => route.fulfill({ json: new URL(route.request().url()).pathname.includes('/audit-road/') ? response({ source: { key: 'audit-road', name: 'AUDIT road source', enabled: false, licence: 'Audit only', provenance: 'Synthetic road source' }, sample: [], recordsFetched: 0 }) : response() }));
  await enter(page, 'source-admin');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel.getByRole('article')).toHaveCount(2);
  await panel.getByRole('combobox', { name: 'Collector source' }).selectOption('audit-road');
  await expect(panel.getByRole('article')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel.getByRole('heading', { name: 'AUDIT road source' })).toBeVisible();
  await expect(panel).toContainText('Configured disabled');
  expect(state.requests.map(request => request.path)).toEqual(['/__qa/api/sources/audit-mining/diagnostic', '/__qa/api/sources/audit-road/diagnostic']);
  expect(state.mutations).toEqual([]);
});

test('unexpected diagnostic shape is an error, not a claim that data was not saved', async ({ page }) => {
  await setup(page);
  await page.route(endpoint, route => route.fulfill({ json: response({ persisted: true }) }));
  await enter(page, 'source-admin');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel.getByRole('alert')).toContainText('Collector check failed');
  await expect(panel.getByRole('article')).toHaveCount(0);
});

test('mobile diagnostic samples wrap long provenance and keep controls usable', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route(endpoint, route => route.fulfill({ json: response({ source: { key: 'audit-mining', name: 'AUDIT source', enabled: true, licence: 'Synthetic audit licence', provenance: 'https://example.test/' + 'source'.repeat(80) } }) }));
  await enter(page, 'source-admin');
  const panel = panelFor(page);
  await panel.getByRole('button', { name: 'Run collector check' }).click();
  await expect(panel).toContainText('12 rows returned');
  await checkViewport(page);
  await expect(panel.getByRole('combobox', { name: 'Collector source' })).toBeEnabled();
});
