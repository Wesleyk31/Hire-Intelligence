import { test, expect } from '@playwright/test';
import { setupAudit, enter, project, modules, pages, checkViewport } from './audit-fixtures';

for (const size of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 375, height: 667 }]) {
  for (const [slug, title] of pages) test(size.name + ' public page ' + slug + ': content, demo and secure entry', async ({ page }) => {
    const state = await setupAudit(page); await page.setViewportSize(size);
    await page.goto(slug === 'home' ? '/' : '/#' + slug);
    await expect(page.locator('main h1')).toContainText(slug === 'home' ? 'See what’s' : title);
    await checkViewport(page);
    if (['home', 'products', 'contact'].includes(slug)) await page.screenshot({ path: test.info().outputPath(size.name + '-' + slug + '.png'), fullPage: true });
    await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);
    await page.locator('main').getByRole('button', { name: 'Get a demo', exact: false }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('main').getByRole('button', { name: 'Explore the platform', exact: false }).first().click();
    await expect(page.getByRole('heading', { name: 'Secure workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Return to public site' }).click();
    await expect(page.locator('main h1')).toContainText('See what’s');
    expect(state.errors).toEqual([]); expect(state.consoleErrors).toEqual([]); expect(state.failedRequests).toEqual([]);
  });
  for (const [slug, name] of modules) test(size.name + ' module ' + slug + ': direct link, reload and navigation', async ({ page }) => {
    const state = await setupAudit(page); await page.setViewportSize(size); await enter(page, slug);
    await expect(page.locator('.hi-page-head h1')).toHaveText(name); await checkViewport(page);
    await page.reload();
    await expect(page.locator('.hi-page-head h1')).toHaveText(name); await checkViewport(page);
    if (['decision-desk', 'map', 'crm'].includes(slug)) await page.screenshot({ path: test.info().outputPath(size.name + '-' + slug + '.png'), fullPage: true });
    if (size.name === 'mobile') {
      await page.locator('.hi-mobile-nav').selectOption('Projects');
      await expect(page.locator('.hi-page-head h1')).toHaveText('Projects');
      await page.locator('button.hi-table-row').filter({ hasText: project.name }).click();
      await expect(page.locator('.hi-drawer')).toBeVisible(); await checkViewport(page);
      await page.getByRole('button', { name: 'Close project intelligence' }).click();
    } else {
      await expect(page.getByRole('navigation', { name: 'Hire Intelligence modules' }).getByRole('link')).toHaveCount(12);
    }
    expect(state.errors).toEqual([]); expect(state.consoleErrors).toEqual([]); expect(state.failedRequests).toEqual([]);
  });
}
for (const [slug, name] of modules) test('empty data ' + slug + ': truthful empty state without crash', async ({ page }) => {
  const state = await setupAudit(page, { empty: true }); await enter(page, slug);
  await expect(page.locator('.hi-page-head h1')).toHaveText(name);
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);
  await expect(page.locator('.hi-empty, .visible-list p').first()).toBeVisible();
  expect(state.errors).toEqual([]); expect(state.consoleErrors).toEqual([]);
});

test('public menu, footer and browser history reach their named pages', async ({ page }) => {
  const state = await setupAudit(page); await page.goto('/');
  for (const name of ['Products', 'Solutions', 'Industries', 'Insights', 'About']) {
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', {name, exact: true}).click();
    await expect(page.locator('main')).toHaveAttribute('data-public-page', name.toLowerCase());
  }
  await page.goBack(); await expect(page.locator('main')).toHaveAttribute('data-public-page', 'insights');
  await page.goForward(); await expect(page.locator('main')).toHaveAttribute('data-public-page', 'about');
  for (const name of ['Privacy', 'Terms', 'Contact']) {
    await page.locator('footer').getByRole('button', {name, exact: true}).click();
    await expect(page.locator('main')).toHaveAttribute('data-public-page', name.toLowerCase());
  }
  await page.getByRole('button', {name: 'Hire Intelligence home'}).click();
  await expect(page.locator('main h1')).toContainText('See what’s');
  await page.getByRole('button', {name: 'Log in', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Secure workspace'})).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('all five home feature links lead to protected workspace', async ({ page }) => {
  await setupAudit(page);
  for (let index = 0; index < 5; index++) {
    await page.goto('/');
    await page.getByRole('button', {name: 'Learn more', exact: false}).nth(index).click();
    await expect(page.getByRole('heading', {name: 'Secure workspace'})).toBeVisible();
  }
});

test('project search, stage filter and clearing search recover the full list', async ({ page }) => {
  await setupAudit(page); await enter(page, 'projects');
  const search = page.getByPlaceholder('Search projects, locations, contractors, equipment…');
  await expect(page.locator('button.hi-table-row')).toHaveCount(3);
  await page.locator('.hi-card-toolbar select').selectOption('CONSTRUCTION');
  await expect(page.locator('button.hi-table-row')).toHaveCount(1);
  await page.locator('.hi-card-toolbar select').selectOption('ALL');
  for (const query of ['Pilbara', 'AUDIT Delivery', 'audit-mining']) {
    await search.fill(query); await expect(page.locator('button.hi-table-row')).toHaveCount(1);
    await expect(page.locator('button.hi-table-row')).toContainText(project.name);
  }
  await search.fill('no-such-project'); await expect(page.getByText('No projects match the current view.')).toBeVisible();
  await search.clear(); await expect(page.locator('button.hi-table-row')).toHaveCount(3);
});

test('opportunity priorities and search retain matching drill-downs', async ({ page }) => {
  await setupAudit(page); await enter(page, 'opportunities');
  await page.locator('.hi-card-toolbar select').selectOption('HIGH');
  await expect(page.locator('button.hi-table-row')).toHaveCount(1);
  await page.locator('button.hi-table-row').click(); await expect(page.locator('.hi-drawer h2')).toHaveText(project.name);
  await page.getByRole('button', {name: 'Close project intelligence'}).click();
  await page.locator('.hi-card-toolbar select').selectOption('WATCH'); await expect(page.locator('button.hi-table-row')).toHaveCount(0);
  await page.locator('.hi-card-toolbar select').selectOption('ALL'); await expect(page.locator('button.hi-table-row')).toHaveCount(2);
});

test('every project entry point opens retained evidence', async ({ page }) => {
  await setupAudit(page); await enter(page);
  const pathways = [
    ['Decision Desk', '.hi-activity-list button'], ['Commercial Intelligence', '.hi-pilot-table button'], ['Commercial Intelligence', '.hi-activity-list button'],
    ['Projects', 'button.hi-table-row'], ['Organisations & Delivery Teams', '.hi-organisation-list button'], ['Equipment Demand', '.hi-equipment-projects button'],
    ['Resources', 'button.hi-table-row'], ['Alerts', '.hi-alert-list button'],
  ];
  for (const [name, selector] of pathways) {
    await page.getByRole('link', {name, exact: true}).click();
    await page.locator(selector).first().click(); await expect(page.locator('.hi-drawer')).toContainText('Synthetic browser audit fixture only');
    await page.getByRole('button', {name: 'Close project intelligence'}).click();
  }
});

test('map filters, region jumps, selection and full project pathway', async ({ page }) => {
  const state = await setupAudit(page); await enter(page, 'map');
  await expect(page.locator('.map-legend')).toContainText('2 projects · 2 signals · 1 unmapped · 1 high');
  const filters = page.locator('.map-filters select');
  await filters.nth(0).selectOption('PROJECTS'); await expect(page.locator('.map-legend')).toContainText('2 projects · 0 signals');
  await filters.nth(1).selectOption('HIGH'); await expect(page.locator('.map-legend')).toContainText('1 projects · 0 signals');
  await filters.nth(1).selectOption('WATCH'); await expect(page.locator('.visible-list')).toContainText('No intelligence matches');
  await filters.nth(1).selectOption('ALL'); await filters.nth(2).selectOption('CONSTRUCTION'); await filters.nth(3).selectOption('Excavators');
  await page.locator('.visible-list button').first().click(); await expect(page.locator('.map-selection')).toContainText('APPROXIMATE');
  await page.getByRole('button', {name: 'Open full project intelligence'}).click(); await expect(page.locator('.hi-drawer h2')).toHaveText(project.name);
  await page.getByRole('button', {name: 'Close project intelligence'}).click();
  await page.getByRole('button', {name: 'Australia', exact: true}).click();
  await filters.nth(2).selectOption('ALL'); await filters.nth(3).selectOption('ALL'); await filters.nth(0).selectOption('BOTH');
  await expect(page.locator('.map-legend')).toContainText('2 projects · 2 signals');
  expect(state.errors).toEqual([]); expect(state.consoleErrors).toEqual([]); expect(state.failedRequests).toEqual([]);
});

test('dashboard failure exposes retry and recovers real page content', async ({ page }) => {
  const flags = { failDashboard: true }; const state = await setupAudit(page, flags);
  await page.goto('/#platform/projects'); await page.getByRole('button', {name: 'Sign in to Hire Intelligence'}).click();
  await expect(page.getByText('Hire Intelligence could not load.')).toBeVisible();
  flags.failDashboard = false; await page.getByRole('button', {name: 'Retry dashboard'}).click();
  await expect(page.locator('button.hi-table-row')).toHaveCount(3);
  expect(state.errors).toEqual([]);
});

test('demo submission failure preserves fields and retry resets only after success', async ({ page }) => {
  const flags = {failDemo: true}; const state = await setupAudit(page, flags); await page.goto('/#contact');
  const form = page.locator('main form');
  await form.getByRole('button', {name: 'Request demo'}).click(); expect(state.mutations).toHaveLength(0);
  await form.getByLabel('Name', {exact: true}).fill('Audit Customer'); await form.getByLabel('Company', {exact: true}).fill('Audit Co');
  await form.getByLabel('Business email').fill('audit@example.test'); await form.getByRole('button', {name: 'Request demo'}).click();
  await expect(form).toContainText('could not be recorded'); await expect(form.getByLabel('Name', {exact: true})).toHaveValue('Audit Customer');
  flags.failDemo = false; await form.getByRole('button', {name: 'Request demo'}).click();
  await expect(form).toContainText('Request received'); await expect(form.getByLabel('Name', {exact: true})).toHaveValue('');
});

test('CRM rejects missing project and zero quote/win, records all six result types and QA flag', async ({ page }) => {
  const state = await setupAudit(page); await enter(page, 'crm');
  await page.getByRole('button', {name: 'Record outcome'}).click(); expect(state.mutations).toHaveLength(0);
  for (const result of ['CONTACTED', 'REQUIREMENT_CONFIRMED', 'QUOTED', 'WON', 'LOST', 'FALSE_POSITIVE']) {
    await page.getByLabel('Canonical project').selectOption(project.id); await page.locator('select[name=result]').selectOption(result);
    if (result === 'QUOTED' || result === 'WON') {
      await page.getByRole('button', {name: 'Record outcome'}).click(); await expect(page.locator('.hi-message')).toContainText('Outcome rejected');
      await page.getByLabel(result === 'QUOTED' ? 'Quote value AUD' : 'Won value AUD').fill('2500');
    }
    if (result === 'FALSE_POSITIVE') await page.locator('select[name=qa]').selectOption('true');
    await page.getByRole('button', {name: 'Record outcome'}).click();
    await expect(page.locator('.hi-message')).toContainText('outcome recorded');
    await expect(page.getByLabel('Canonical project')).toHaveValue('');
    await expect(page.locator('.hi-activity-list')).toContainText(result);
  }
  await expect(page.locator('.hi-activity-list')).toContainText('QA EXCLUDED');
});

test('failed public summary keeps pages and conversion usable', async ({ page }) => {
  const state = await setupAudit(page, {failSummary: true}); await page.goto('/#insights');
  await expect(page.locator('main h1')).toContainText('A current view');
  await page.locator('main').getByRole('button', {name: 'Get a demo', exact: true}).click();
  await expect(page.getByRole('dialog')).toBeVisible(); expect(state.errors).toEqual([]);
});

test('PDF download reports history failure truthfully', async ({ page }) => {
  await setupAudit(page, {failSave: true}); await enter(page, 'reports');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download PDF'}).click(); await download;
  await expect(page.locator('.hi-message')).toContainText('PDF downloaded, but its report history could not be saved');
  await expect(page.getByText('Executive Intelligence Report', {exact: true})).toHaveCount(0);
});

test('unrecognized public and operational routes recover to usable home views', async ({ page }) => {
  await setupAudit(page); await page.goto('/#not-a-page'); await expect(page.locator('main h1')).toContainText('See what’s');
  await enter(page, 'not-a-module'); await expect(page.locator('.hi-page-head h1')).toHaveText('Decision Desk');
});
