import { expect, test } from '@playwright/test';
import { enter, modules, setupAudit } from './audit-fixtures';

for (const width of [1280, 390]) {
  test(`workspace logo returns home from all modules without signing out at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setupAudit(page);
    await enter(page);
    for (const [slug, name] of modules) {
      if (width <= 760) await page.locator('.hi-mobile-nav').selectOption(name);
      else await page.getByRole('navigation', { name: 'Hire Intelligence modules' }).getByRole('link', { name, exact: true }).click();
      await expect(page.locator('.hi-page-head h1')).toHaveText(name);
      await expect(page).toHaveURL(new RegExp('#platform/' + slug + '$'));
      const home = page.getByRole('link', { name: 'Hire Intelligence home', exact: true });
      await expect(home).toBeVisible();
      if (slug === 'decision-desk') {
        await home.focus();
        await page.keyboard.press('Enter');
      } else await home.click();
      await expect(page.locator('.hi2-hero')).toBeVisible();
      await expect(page.locator('.hi-shell')).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe('');
      if (slug === 'decision-desk') {
        await page.goBack();
        await expect(page.locator('.hi-page-head h1')).toHaveText('Decision Desk');
        await page.goForward();
        await expect(page.locator('.hi2-hero')).toBeVisible();
      }
      await page.getByRole('button', { name: 'Explore the platform', exact: true }).click();
      await expect(page.locator('.hi-page-head h1')).toHaveText('Decision Desk');
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
    }
    expect(await page.evaluate(() => sessionStorage.getItem('hire-test-sign-in-count'))).toBe('1');
  });
}

test('owner credentials are required, rejected credentials expose no workspace, and remember survives reload', async ({
  page,
}) => {
  await setupAudit(page);
  await page.goto('/#platform/reports');
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(
    'hireowner',
  );
  await expect(page.getByLabel('Remember this browser')).toBeChecked();
  await page
    .getByLabel('Password', { exact: true })
    .fill('wrong-fixture-password');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Username or password is incorrect',
  );
  await expect(page.locator('.hi-page-head')).toHaveCount(0);
  await page
    .getByLabel('Password', { exact: true })
    .fill('fixture-password-only');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Reports', exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    localStorage.getItem('hire-owner-session'),
  );
  expect(saved).toBeTruthy();
  expect(saved).not.toContain('fixture-password-only');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Reports', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('hire-test-sign-in-count'),
    ),
  ).toBe('2');
});

test('unremembered sessions stay in this tab and sign-out removes access', async ({
  page,
}) => {
  await setupAudit(page);
  await page.goto('/#platform/decision-desk');
  await page.getByLabel('Remember this browser').uncheck();
  await page
    .getByLabel('Password', { exact: true })
    .fill('fixture-password-only');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Decision Desk', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('hire-owner-session')),
  ).toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem('hire-owner-session')),
  ).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Decision Desk', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto('/#platform/decision-desk');
  await expect(
    page.getByRole('heading', { name: 'Secure workspace' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem('hire-owner-session')),
  ).toBeNull();
});

test('server-rejected saved sessions never reveal workspace data', async ({
  page,
}) => {
  await setupAudit(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'hire-owner-session',
      JSON.stringify({
        session: 'unverified-token',
        expiresAt: '2099-01-01T00:00:00Z',
      }),
    ),
  );
  await page.goto('/#platform/crm');
  await expect(
    page.getByRole('heading', { name: 'Secure workspace' }),
  ).toBeVisible();
  await expect(page.locator('.hi-page-head')).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('hire-owner-session')),
  ).toBeNull();
});

test('login waits for server session verification before revealing the workspace', async ({
  page,
}) => {
  await setupAudit(page);
  await page.addInitScript(() =>
    sessionStorage.setItem('hire-test-session-gate', '1'),
  );
  await page.goto('/#platform/projects');
  await page
    .getByLabel('Password', { exact: true })
    .fill('fixture-password-only');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('hire-test-session-waiting')),
    )
    .toBe('1');
  await expect(page.locator('.hi-page-head')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Signing in…' }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('hire-test-release-session')),
  );
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();
});

test('an expired operational session closes the workspace and permits fresh owner login', async ({
  page,
}) => {
  await setupAudit(page);
  await page.goto('/#platform/decision-desk');
  await page
    .getByLabel('Password', { exact: true })
    .fill('fixture-password-only');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Decision Desk', exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    sessionStorage.setItem('hire-test-auth-error', '1'),
  );
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await page.getByRole('button', { name: 'Save report snapshot' }).click();
  await expect(
    page.getByRole('heading', { name: 'Secure workspace' }),
  ).toBeVisible();
  await expect(page.locator('.hi-page-head')).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem('hire-owner-session')),
  ).toBeNull();
  await page.evaluate(() => sessionStorage.removeItem('hire-test-auth-error'));
  await page
    .getByLabel('Password', { exact: true })
    .fill('fixture-password-only');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Reports', exact: true }),
  ).toBeVisible();
});

test('remembered owner access opens another tab and logout closes both workspaces', async ({
  page,
  context,
}) => {
  await setupAudit(page);
  await page.goto('/#platform/decision-desk');
  await page
    .getByLabel('Password', { exact: true })
    .fill('fixture-password-only');
  await page
    .getByRole('button', { name: 'Sign in to Hire Intelligence' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Decision Desk', exact: true }),
  ).toBeVisible();
  const other = await context.newPage();
  await setupAudit(other);
  await other.goto('/#platform/crm');
  await expect(
    other.getByRole('heading', { name: 'CRM', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    other.getByRole('heading', { name: 'Secure workspace' }),
  ).toBeVisible();
  await expect(other.locator('.hi-page-head')).toHaveCount(0);
  await page.goto('/#platform/reports');
  await expect(
    page.getByRole('heading', { name: 'Secure workspace' }),
  ).toBeVisible();
});
