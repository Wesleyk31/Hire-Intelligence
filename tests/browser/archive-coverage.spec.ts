import {test,expect} from '@playwright/test';
import {setupAudit,enter,checkViewport} from './audit-fixtures';
const universe={loaded:7,truncated:true,liveLoaded:3,archiveRecordsLoaded:9,archiveUnique:4,duplicateRecords:4,invalidArchiveRecords:1,invalidArchivePages:1,archivePagesRead:2,archiveTruncated:true};
for (const width of [1280,375]) test('archive coverage and quality counts remain visible at width '+width,async({page})=>{
  await setupAudit(page,{overrides:{universe}}); await page.setViewportSize({width,height:800});
  await enter(page,'source-admin');
  const coverage=page.getByRole('region',{name:'Evidence coverage'});
  await expect(coverage).toBeVisible();
  await expect(coverage.getByText('Unique evidence loaded').locator('..')).toContainText('7');
  await expect(coverage.getByText('Archived rows read').locator('..')).toContainText('9');
  await expect(coverage.getByText('Duplicate rows suppressed').locator('..')).toContainText('4');
  await expect(coverage).toContainText('1 archived row');
  await expect(coverage).toContainText('additional archived records exist');
  await checkViewport(page);
});
test('report preview discloses archived inputs and a bounded window',async({page})=>{
  await setupAudit(page,{overrides:{universe}}); await enter(page,'reports');
  await expect(page.locator('.hi-report-preview')).toContainText('7 unique evidence records');
  await expect(page.locator('.hi-report-preview')).toContainText('9 archived rows');
  await expect(page.locator('.hi-report-preview')).toContainText('additional stored records exist');
});

test('workspace navigation leaves mobile coverage warnings unobstructed and returns home',async({page})=>{
  await setupAudit(page,{overrides:{universe}});
  await page.setViewportSize({width:375,height:800});
  await enter(page,'source-admin');
  const coverage=await page.getByRole('region',{name:'Evidence coverage'}).boundingBox();
  const exit=page.getByRole('button',{name:'Public site',exact:true});
  const button=await exit.boundingBox();
  expect(coverage).not.toBeNull(); expect(button).not.toBeNull();
  const overlaps=button!.x < coverage!.x+coverage!.width && button!.x+button!.width > coverage!.x
    && button!.y < coverage!.y+coverage!.height && button!.y+button!.height > coverage!.y;
  expect(overlaps,'Public navigation must not obscure the evidence coverage card').toBe(false);
  await exit.click();
  await expect(page.getByRole('heading',{name:/See further/})).toBeVisible();
});
