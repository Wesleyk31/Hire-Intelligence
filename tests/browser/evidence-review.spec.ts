import { test, expect } from '@playwright/test';
import { setupAudit, enter } from './audit-fixtures';

const evidence = (name: string) => ({ reviewId: name, origin: 'ARCHIVE', storageId: 'qa', sourceKey: 'qa-source', externalId: name, project: name, location: 'Perth WA', company: '', description: 'Synthetic evidence fixture', sourceObservedAt: '', observedAt: '2026-09-16', provenance: 'https://example.test/qa', contentHash: 'a'.repeat(64), issues: ['MISSING_SOURCE_DATE'] });
test('stored evidence reaches later pages, returns back and exports review findings', async ({page}) => {
  await setupAudit(page);
  await page.route('**/__qa/api/evidence/review**', route => {
    const later = new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({json:{origin:'ARCHIVE',items:[evidence(later?'QA Beyond initial window':'QA First page')],nextCursor:later?undefined:'page-two',pageIssues:[],summary:{rows:1,needsReview:1,duplicateRows:0},disclosure:'Counts apply to this page.'}});
  });
  await enter(page,'source-admin'); await page.getByRole('button',{name:'Browse stored evidence'}).click();
  const panel=page.getByRole('region',{name:'Stored evidence'});
  await expect(panel).toContainText('QA First page');
  await panel.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(panel).toContainText('QA Beyond initial window');
  await expect(panel.getByRole('button',{name:'Next page',exact:true})).toBeDisabled();
  await panel.getByRole('button',{name:'Previous page',exact:true}).click();
  await expect(panel).toContainText('QA First page');
  const download=page.waitForEvent('download'); await panel.getByRole('button',{name:'Export review page'}).click();
  expect((await download).suggestedFilename()).toContain('evidence-review');
});
test('evidence failure keeps retry usable on a narrow screen',async({page})=>{
  await setupAudit(page); await page.setViewportSize({width:375,height:667});
  let failed=true;
  await page.route('**/__qa/api/evidence/review**',route=>failed?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({json:{origin:'ARCHIVE',items:[],pageIssues:[],summary:{rows:0,needsReview:0,duplicateRows:0},disclosure:'Counts apply to this page.'}}));
  await enter(page,'source-admin'); await page.getByRole('button',{name:'Browse stored evidence'}).click();
  const panel=page.getByRole('region',{name:'Stored evidence'});
  await expect(panel.getByRole('alert')).toContainText('could not be loaded'); failed=false;
  await panel.getByRole('button',{name:'Retry this page'}).click();
  await expect(panel).toContainText('No records on this page');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('pilot preview exposes quarantined records and does not advertise active ingestion',async({page})=>{
  await setupAudit(page);
  await page.route('**/__qa/api/sources/pilots/*',route=>route.fulfill({json:{contract:{name:'Logan development applications',attribution:'Source: Logan City Council.',licence:{name:'CC BY 3.0 AU',url:'https://creativecommons.org/licenses/by/3.0/au/'}},evidence:[],quarantine:[{externalId:'QA-1',rowCount:1,qualityFlags:['INVALID_INPUT']}],summary:{inputRows:1,evidenceRecords:0,quarantinedRows:1},fetch:{rowsFetched:1,truncated:true,durationMs:3}}}));
  await enter(page,'source-admin'); await page.getByRole('button',{name:'Preview Logan sample'}).click();
  const panel=page.getByRole('region',{name:'Source pilots'});
  await expect(panel).toContainText('INVALID_INPUT'); await expect(panel).toContainText('not scheduled');
  await expect(panel).toContainText('Source: Logan City Council.');
});
