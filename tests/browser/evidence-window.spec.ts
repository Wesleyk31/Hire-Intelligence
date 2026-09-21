import {test,expect} from '@playwright/test';
import {setupAudit,enter,project} from './audit-fixtures';
test('later evidence windows support project review and CRM linkage, then return back',async({page})=>{
  const audit=await setupAudit(page,{overrides:{universe:{loaded:1,truncated:true,nextCursor:'next-window',windowOnly:true}}});
  const first=page.waitForResponse(r=>r.url().includes('/__qa/api/dashboard'));
  await enter(page,'projects'); const base=await (await first).json();
  const later={...project,id:'later-project',name:'QA Later Archive Project'};
  await page.route('**/__qa/api/dashboard**',route=>{
    const cursor=new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill({json:cursor?{...base,projects:[later],universe:{loaded:1,truncated:false,windowOnly:true,windowRecordLimit:25}}:base});
  });
  await page.getByRole('button',{name:'Next evidence window',exact:true}).click();
  await expect(page.getByText('Evidence window 2', {exact:false})).toBeVisible();
  await page.getByRole('button').filter({hasText:later.name}).click();
  await expect(page.getByRole('dialog')).toContainText(later.name);
  await page.getByRole('button',{name:'Close project intelligence'}).click();
  await page.getByRole('link',{name:'CRM',exact:true}).click();
  await page.locator('select[name="projectId"]').selectOption(later.id);
  await page.locator('select[name="result"]').selectOption('CONTACTED');
  await page.getByRole('button',{name:'Record outcome'}).click();
  await expect.poll(()=>audit.mutations.some(m=>m.path==='/api/pilot/outcomes'&&m.data.evidenceCursor==='next-window'&&m.data.evidenceWindowRecords===25&&m.data.projectId===later.id)).toBe(true);
  await page.getByRole('button',{name:'Previous evidence window',exact:true}).click();
  await expect(page.getByText('Evidence window 1', {exact:false})).toBeVisible();
  await expect(page.locator('select[name="projectId"]')).toContainText(project.name);
});
test('failed window navigation preserves current data and offers retry and restart',async({page})=>{
  await setupAudit(page,{overrides:{universe:{loaded:1,truncated:true,nextCursor:'next-window',windowOnly:true}}});
  await enter(page,'projects');
  await page.route('**/__qa/api/dashboard?cursor=*',route=>route.fulfill({status:400,json:{error:'EVIDENCE_WINDOW_CHANGED_RESTART'}}));
  await page.getByRole('button',{name:'Next evidence window',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded');
  await expect(page.getByText('Evidence window 1',{exact:false})).toBeVisible();
  await expect(page.getByRole('button').filter({hasText:project.name})).toBeVisible();
  await page.getByRole('button',{name:'Restart evidence browsing'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
