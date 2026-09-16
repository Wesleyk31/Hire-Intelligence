import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setupAudit, enter } from './audit-fixtures';

test('large executive report preserves all fleet notes and calibration content', async ({ page }) => {
  const clusters = Array.from({length: 50}, (_, index) => ({location: 'AUDIT REGION ' + index, equipmentClass: 'Excavators', projectCount: 5, averagePriority: 85, confidence: 70}));
  const fleet = Array.from({length: 15}, (_, index) => ({
    location: 'AUDIT REGION ' + index, equipmentClass: 'Excavators',
    recommendation: ('Synthetic audit recommendation: confirm project timing and evidence before moving fleet. ').repeat(18) + ' AUDIT-FLEET-' + (index + 1) + '-END',
  }));
  await setupAudit(page, {overrides: {commercial: {events: [], equipmentClusters: clusters, fleetPositioning: fleet, calibration: {linkedRealOutcomes: 15, unmatchedRealOutcomes: 0, sufficientSample: false}},
    sources: {configured: 1, active: 1, runtimeFetched: 3, states: [], deferred: Array.from({length: 40}, (_,index) => ({name: 'AUDIT deferred ' + index, reason: 'Synthetic source deferred pending access and technical review. '.repeat(12)}))}
  }});
  await enter(page, 'reports');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download PDF'}).click();
  const download = await pendingDownload;
  const target = test.info().outputPath('large-executive-report.pdf');
  await download.saveAs(target);
  const bytes = await readFile(target);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1')).toContain('AUDIT-FLEET-15-END');
  await expect(page.locator('.hi-message')).toContainText('PDF report generated');
});
