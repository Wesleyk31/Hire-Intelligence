import { test, expect } from '@playwright/test';
import { setupAudit, enter, project } from './audit-fixtures';

test('a delayed CRM save locks evidence navigation and cannot restore an older window', async ({ page }) => {
  await setupAudit(page, { overrides: { universe: { loaded: 1, truncated: true, nextCursor: 'next-window', windowOnly: true } } });
  const initial = page.waitForResponse(response => response.url().includes('/__qa/api/dashboard'));
  await enter(page, 'crm');
  const base = await (await initial).json();
  const later = { ...project, id: 'later-project', name: 'QA Later Archive Project' };
  await page.route('**/__qa/api/dashboard**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.has('cursor')
    ? { ...base, projects: [later], universe: { loaded: 1, truncated: false, windowOnly: true } } : base }));
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__qa/api/pilot/outcomes', async route => { await blocked; await route.fallback(); });
  try {
    await page.locator('select[name="projectId"]').selectOption(project.id);
    const posted = page.waitForRequest(request => request.url().includes('/__qa/api/pilot/outcomes'));
    await page.getByRole('button', { name: 'Record outcome', exact: true }).click();
    await posted;
    await expect(page.getByRole('button', { name: 'Next evidence window', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Restart evidence browsing', exact: true })).toBeDisabled();
    await expect(page.locator('.hi-crm-form button[type="submit"]')).toBeDisabled();
    release();
    await expect(page.getByRole('button', { name: 'Next evidence window', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Next evidence window', exact: true }).click();
    await expect(page.getByText('Evidence window 2', { exact: false })).toBeVisible();
    await expect(page.locator('select[name="projectId"]')).toContainText(later.name);
    await expect(page.locator('select[name="projectId"]')).not.toContainText(project.name);
  } finally { release(); }
});

test('a CRM response after leaving the workspace does not reload the protected dashboard', async ({ page }) => {
  await setupAudit(page);
  let dashboardRequests = 0;
  page.on('request', request => { if (request.url().includes('/__qa/api/dashboard')) dashboardRequests++; });
  await enter(page, 'crm');
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/__qa/api/pilot/outcomes', async route => { await blocked; await route.fallback(); });
  try {
    await page.locator('select[name="projectId"]').selectOption(project.id);
    const posted = page.waitForRequest(request => request.url().includes('/__qa/api/pilot/outcomes'));
    await page.getByRole('button', { name: 'Record outcome', exact: true }).click(); await posted;
    const requestsBeforeLeaving = dashboardRequests;
    await page.getByRole('button', { name: 'Public site', exact: true }).click();
    const completed = page.waitForResponse(response => response.url().includes('/__qa/api/pilot/outcomes'));
    release(); await completed;
    // Give the completed promise a turn to trigger any erroneous background reload.
    await page.waitForTimeout(200);
    expect(dashboardRequests).toBe(requestsBeforeLeaving);
    await expect(page.locator('.hi2-page')).toBeVisible();
  } finally { release(); }
});
