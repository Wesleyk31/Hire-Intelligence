import { expect, test } from '@playwright/test';
import { setupAudit } from './audit-fixtures';

test('sign-in permits one pending operation and recovers for retry', async ({
  page,
}) => {
  await setupAudit(page);
  await page.addInitScript(() => {
    sessionStorage.setItem('hire-test-sign-in-gate', '1');
    sessionStorage.setItem('hire-test-sign-in-failures', '1');
  });
  await page.goto('/#platform/decision-desk');

  const signIn = page.getByRole('button', {
    name: 'Sign in to Hire Intelligence',
  });
  await signIn.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('hire-test-sign-in-count')),
    )
    .toBe('1');
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('hire-test-sign-in-waiting')),
    )
    .toBe('1');
  await expect(
    page.getByRole('button', { name: 'Signing in…' }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('hire-test-release-sign-in')),
  );
  await expect(page.getByRole('alert')).toContainText(
    'Sign-in failed. Please try again.',
  );
  await expect(signIn).toBeEnabled();

  await signIn.click();
  await expect(page.getByText('QA test account', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('hire-test-sign-in-count'),
    ),
  ).toBe('2');
});

test('sign-out permits one pending operation and recovers for retry', async ({
  page,
}) => {
  await setupAudit(page);
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'hire-test-user',
      JSON.stringify({ userId: 'qa-a', name: 'QA test account', scope: '' }),
    );
    sessionStorage.setItem('hire-test-sign-out-gate', '1');
    sessionStorage.setItem('hire-test-sign-out-failures', '1');
  });
  await page.goto('/#platform/decision-desk');

  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await signOut.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('hire-test-sign-out-count')),
    )
    .toBe('1');
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem('hire-test-sign-out-waiting')),
    )
    .toBe('1');
  await expect(
    page.getByRole('button', { name: 'Signing out…' }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.dispatchEvent(new Event('hire-test-release-sign-out')),
  );
  await expect(page.getByRole('alert')).toContainText(
    'Sign-out could not be completed. Please try again.',
  );
  await expect(signOut).toBeEnabled();

  await signOut.click();
  await expect(page.getByRole('heading', { name: 'See further.' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('hire-test-sign-out-count'),
    ),
  ).toBe('2');
});
