import { test, expect } from '@playwright/test';
import { setupAudit, enter, project } from './audit-fixtures';

test('demo dialog contains keyboard focus, closes on Escape and restores its trigger', async ({ page }) => {
  await setupAudit(page); await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Get a demo', exact: false }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('project drawer closes when browser history changes modules', async ({ page }) => {
  await setupAudit(page); await enter(page);
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await page.locator('button.hi-table-row').filter({ hasText: project.name }).click();
  await expect(page.locator('.hi-drawer')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Decision Desk', exact: true })).toBeVisible();
  await expect(page.locator('.hi-drawer')).toHaveCount(0);
});

test('project drawer supports keyboard dismiss and focus restoration', async ({ page }) => {
  await setupAudit(page); await enter(page, 'projects');
  const trigger = page.locator('button.hi-table-row').filter({ hasText: project.name });
  await trigger.click(); await expect(page.locator('.hi-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.hi-drawer')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('event-only Decision Desk search preserves its project drill-down', async ({ page }) => {
  await setupAudit(page); await enter(page);
  await page.getByPlaceholder('Search projects, locations, contractors, equipmentâ€¦').fill('shutdown');
  await page.getByRole('button').filter({ hasText: 'SHUTDOWN' }).click();
  await expect(page.locator('.hi-drawer')).toBeVisible();
  await expect(page.locator('.hi-drawer h2')).toHaveText(project.name);
});

test('recent map filters exclude undated and future signals', async ({ page }) => {
  await setupAudit(page, { overrides: { commercial: { events: [
    { projectId: project.id, project: project.name, location: project.location, type: 'UNDATED', confidence: 80 },
    { projectId: project.id, project: project.name, location: project.location, type: 'FUTURE', confidence: 80, detectedAt: '2099-01-01' },
  ] } } });
  await enter(page, 'map');
  await page.getByRole('button', { name: 'What changed here?' }).click();
  await expect(page.locator('.visible-list')).toContainText('No intelligence matches');
});

test('map renders evidence markup as plain text in tooltips', async ({ page }) => {
  await setupAudit(page, { overrides: { projects: [{ ...project, name: 'AUDIT <img src=x data-audit-injected=1> Pilbara', records: [] }], commercial: { events: [] } } });
  await enter(page, 'map');
  await page.locator('.leaflet-interactive').first().hover();
  await expect(page.locator('.leaflet-tooltip')).toContainText('<img src=x data-audit-injected=1>');
  await expect(page.locator('[data-audit-injected]')).toHaveCount(0);
});

test('mobile demo remains entirely reachable on a short screen', async ({ page }) => {
  await setupAudit(page); await page.setViewportSize({width: 320, height: 480}); await page.goto('/');
  await page.getByRole('button', { name: 'Get a demo', exact: false }).first().click();
  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  await dialog.getByLabel('Name', { exact: true }).fill('Short screen');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});


test('report object response retains saved entries and discloses a bounded history window', async ({ page }) => {
  await setupAudit(page, { reportWindow: true }); await enter(page, 'reports');
  await page.getByRole('button', {name: 'Save report snapshot'}).click();
  await expect(page.getByText('Executive Intelligence Report', {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Executive Intelligence Report', {exact: true})).toBeVisible();
  await expect(page.locator('.hi-page-content')).toContainText('1000 stored records');
});

test('event-only map search keeps the matching signal and its project', async ({ page }) => {
  await setupAudit(page); await enter(page, 'map');
  await page.getByPlaceholder('Search projects, locations, contractors, equipmentâ€¦').fill('shutdown');
  await expect(page.locator('.map-legend')).toContainText('1 projects Â· 1 signals');
  await page.locator('.visible-list button').filter({hasText: 'SHUTDOWN'}).click();
  await page.getByRole('button', {name: 'Open full project intelligence'}).click();
  await expect(page.locator('.hi-drawer h2')).toHaveText(project.name);
});

test('map filter changes remove a selection that no longer matches', async ({ page }) => {
  await setupAudit(page); await enter(page, 'map');
  await page.locator('.visible-list button').filter({hasText: project.name}).first().click();
  await expect(page.locator('.map-selection')).toBeVisible();
  await page.locator('.map-filters select').nth(1).selectOption('WATCH');
  await expect(page.locator('.visible-list')).toContainText('No intelligence matches');
  await expect(page.locator('.map-selection')).toHaveCount(0);
});


test('signed-in public-site action is clickable and session is restored on return', async ({ page }) => {
  await setupAudit(page); await enter(page, 'projects');
  await page.getByRole('button', {name: 'Public site', exact: true}).click({timeout: 3000});
  await expect(page.locator('main h1')).toContainText('See whatâ€™s');
  await page.getByRole('button', {name: 'Log in', exact: true}).click();
  await expect(page.locator('.hi-page-head h1')).toHaveText('Decision Desk');
});

test('project modal visually blocks account actions behind it', async ({ page }) => {
  await setupAudit(page); await enter(page, 'projects');
  await page.locator('button.hi-table-row').filter({hasText: project.name}).click();
  const signOut = await page.getByRole('button', {name: 'Sign out', exact: true}).boundingBox();
  const covered = await page.evaluate(({x, y}) => !!document.elementFromPoint(x, y)?.closest('.hi-overlay'), {x: signOut!.x + signOut!.width / 2, y: signOut!.y + signOut!.height / 2});
  expect(covered).toBe(true);
});


test('public About navigation opens the page heading at the top', async ({ page }) => {
  await setupAudit(page); await page.goto('/');
  await page.getByRole('navigation', {name: 'Primary navigation'}).getByRole('link', {name: 'About', exact: true}).click();
  await expect(page.locator('main')).toHaveAttribute('data-public-page', 'about');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('module navigation starts the new page at the top', async ({ page }) => {
  await setupAudit(page); await enter(page, 'map');
  await page.evaluate(() => scrollTo(0, 200));
  await page.getByRole('link', {name: 'Source Admin', exact: true}).click();
  await expect(page.locator('.hi-page-head h1')).toHaveText('Source Admin');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});


test('project recency uses source activity dates and never collection timestamps', async ({ page }) => {
  const collectedNow = new Date().toISOString();
  await setupAudit(page, { overrides: { projects: [
    {...project, records: [{...project.records[0], observedAt: collectedNow, sourceObservedAt: '2000-01-01'}]},
    {...project, id: 'audit-undated', records: [{...project.records[0], observedAt: collectedNow, sourceObservedAt: undefined}]},
  ], commercial: {events: []} } });
  await enter(page, 'map'); await page.locator('.map-filters select').first().selectOption('PROJECTS');
  await page.locator('.map-filters select').nth(4).selectOption('7');
  await expect(page.locator('.visible-list')).toContainText('No intelligence matches');
});


test('homepage feature artwork decodes as an actual image', async ({ page }) => {
  await setupAudit(page); await page.goto('/');
  const imageState = await page.locator('.hi2-sprite-photo').first().evaluate(element => {
    const source = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    return new Promise<{loaded: boolean; width: number; height: number}>(resolve => {
      const image = new Image();
      image.onload = () => resolve({loaded: true, width: image.naturalWidth, height: image.naturalHeight});
      image.onerror = () => resolve({loaded: false, width: 0, height: 0});
      image.src = source || '';
    });
  });
  expect(imageState.loaded, 'approved homepage image must decode').toBe(true);
  expect(imageState.width).toBeGreaterThan(0); expect(imageState.height).toBeGreaterThan(0);
});


test('mobile empty activity rows use the full content width', async ({ page }) => {
  await setupAudit(page, {empty: true}); await page.setViewportSize({width: 375, height: 667}); await enter(page, 'crm');
  const lineCount = await page.locator('.hi-activity-list > .hi-empty').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    return range.getClientRects().length;
  });
  expect(lineCount, 'empty-state text must not be squeezed into the icon column').toBe(1);
});
