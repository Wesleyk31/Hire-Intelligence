import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, sequence: 0, rejectCursor: 0, rejectArchive: 0, rejectControl: false, quota: false, archiveCalls: 0, rejectArchiveAt: 0 }));
vi.mock('@appdeploy/sdk', () => ({
  router: (routes: unknown) => routes, requireAuth: () => 'SDK_AUTH_REQUIRED',
  json: (body: unknown, statusCode = 200) => ({statusCode, body: JSON.stringify(body)}),
  error: (error: string, statusCode = 500) => ({statusCode, body: JSON.stringify({error})}),
  db: {
    list: async (table: string, options: any = {}) => {
      const all = memory.tables[table] || [], start = Number(options.nextToken || 0), end = start + (options.limit || 100);
      return {items: structuredClone(all.slice(start, end)), nextToken: end < all.length ? String(end) : undefined};
    },
    add: async (table: string, rows: any[]) => {
      if (table === 'evidence_pages' && ++memory.archiveCalls === memory.rejectArchiveAt) return rows.map(() => null);
      if (memory.quota && table === 'evidence_pages') throw Object.assign(new Error('AppDatabaseQuotaExceeded'), {statusCode: 429});
      if (table === 'evidence_pages' && memory.rejectArchive-- > 0) return rows.map(() => null);
      if (table === 'backfill_control' && memory.rejectControl) return rows.map(() => null);
      return rows.map(row => {
        if (Buffer.byteLength(JSON.stringify(row)) > 256 * 1024) return null;
        const id = 'qa-' + ++memory.sequence;
        (memory.tables[table] ||= []).push({...structuredClone(row), id}); return id;
      });
    },
    update: async (table: string, updates: any[]) => updates.map(({id, record}) => {
      if (table === 'backfill_cursors' && record.processed > 0 && memory.rejectCursor-- > 0) return false;
      if (table === 'backfill_control' && memory.rejectControl) return false;
      const rows = memory.tables[table] || [], at = rows.findIndex(row => row.id === id);
      if (at < 0) return false; rows[at] = {...structuredClone(record), id}; return true;
    }),
  },
}));
import { handler, SOURCES } from '../../backend/index';
import { runBackfillBatch } from '../../backend/backfill';
const routes = handler as unknown as Record<string, any[]>;
const source = SOURCES[0];
const call = async (route: string, body?: unknown) => {
  const steps = routes[route], response = await steps[steps.length - 1]({user: {userId:'qa-a',scope:''},body,params:{},query:{}});
  return {status:response.statusCode,data:JSON.parse(response.body)};
};
const evidence = (extra: any = {}) => ({sourceKey:source.key, externalId:'archive-1', project:'QA Archived Bridge', company:'', location:'Perth WA', description:'Bridge construction approval', observedAt:'2026-09-16T00:00:00Z', sourceObservedAt:'2020-01-01T00:00:00Z', provenance:'https://example.test/archive', evidenceType:'EXPLICIT', ...extra});
const archive = (events: any[], extra: any = {}) => ({id:'page-' + memory.sequence++,sourceKey:source.key,count:events.length,createdAt:'2026-09-16T00:00:00Z',cursorStart:0,cursorEnd:events.length,events,...extra});
const feed = (rows = [{objectid:1,name:'QA Archived Bridge',description:'Bridge construction',grantdate:'2020-01-01'}]) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({features:rows.map(attributes=>({attributes}))}),{headers:{'content-type':'application/json'}}));
  vi.stubGlobal('fetch',fetch); return fetch;
};
beforeEach(() => {
  memory.tables={}; memory.sequence=0; memory.rejectCursor=0; memory.rejectArchive=0; memory.rejectControl=false; memory.quota=false; memory.archiveCalls=0; memory.rejectArchiveAt=0;
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
});
afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();});

it('loads a legacy archived project without treating collection time as current activity', async () => {
  memory.tables.evidence_pages=[archive([evidence()])];
  const result=await call('GET /api/dashboard');
  expect(result.data.projects).toHaveLength(1);
  expect(result.data.projects[0]).toMatchObject({name:'QA Archived Bridge',callNow:false});
  expect(result.data.projects[0].records[0].sourceObservedAt).toBe('2020-01-01T00:00:00Z');
  expect(result.data.universe).toMatchObject({loaded:1,liveLoaded:0,archiveRecordsLoaded:1,archiveUnique:1});
});

it('suppresses replayed and live/archive duplicate identities without losing the current revision', async () => {
  memory.tables.opportunities=[{id:'live',...evidence({project:'QA Revised Bridge',sourceObservedAt:'2026-09-15T00:00:00Z',value:'Not stated'})}];
  memory.tables.evidence_pages=[archive([evidence()]),archive([evidence()])];
  const result=await call('GET /api/dashboard');
  expect(result.data.projects).toHaveLength(1);
  expect(result.data.projects[0].name).toBe('QA Revised Bridge');
  expect(result.data.projects[0].evidenceCount).toBe(1);
  expect(result.data.universe.duplicateRecords).toBe(2);
  expect(memory.tables.evidence_pages).toHaveLength(2);
});

it('uses latest source activity among archived revisions and preserves all stored revisions', async () => {
  memory.tables.evidence_pages=[archive([evidence(),evidence({project:'QA New Bridge',sourceObservedAt:'2025-01-01T00:00:00Z',observedAt:'2025-02-01T00:00:00Z'})])];
  const result=await call('GET /api/dashboard');
  expect(result.data.projects[0].name).toBe('QA New Bridge');
  expect(result.data.projects[0].evidenceCount).toBe(1);
  expect(memory.tables.evidence_pages[0].events).toHaveLength(2);
});

it('accepts CRM for an archive-only project using the same dashboard evidence universe', async () => {
  memory.tables.evidence_pages=[archive([evidence()])];
  const dashboard=await call('GET /api/dashboard');
  expect(dashboard.data.projects).toHaveLength(1);
  const result=await call('POST /api/pilot/outcomes',{projectId:dashboard.data.projects[0].id,result:'CONTACTED'});
  expect(result.status).toBe(201);
  expect(memory.tables['pilot_outcomes:qa-a'][0].project).toBe('QA Archived Bridge');
});

it('skips malformed and mixed-source archive rows and exposes the rejected count', async () => {
  memory.tables.evidence_pages=[archive([null,evidence({externalId:''}),evidence({sourceKey:'wrong-source'}),evidence({sourceObservedAt:undefined})])];
  const result=await call('GET /api/dashboard');
  expect(result.data.projects).toHaveLength(1);
  expect(result.data.projects[0].callNow).toBe(false);
  expect(result.data.universe.invalidArchiveRecords).toBe(3);
});

it('bounds archived event scanning and declares that additional archived records exist', async () => {
  memory.tables.evidence_pages=Array.from({length:16},(_,p)=>archive(Array.from({length:100},(_,i)=>evidence({externalId:String(p*100+i)}))));
  const result=await call('GET /api/dashboard');
  expect(result.data.universe.archiveRecordsLoaded).toBe(250);
  expect(result.data.universe.archiveTruncated).toBe(true);
  expect(result.data.universe.truncated).toBe(true);
});

it('does not fetch providers or write archived records during dashboard reads', async () => {
  memory.tables.evidence_pages=[archive([evidence()])]; const fetch=feed();
  await call('GET /api/dashboard'); await call('GET /api/dashboard');
  expect(fetch).not.toHaveBeenCalled();
  expect(memory.tables.evidence_pages).toHaveLength(1);
  expect(memory.tables.backfill_cursors).toBeUndefined();
});

it('splits large UTF-8 archive batches below the actual database item limit', async () => {
  feed(Array.from({length:6},(_,i)=>({objectid:i+1,name:'QA Archived Bridge '+i,description:'界'.repeat(15000),grantdate:'2020-01-01'})));
  const result=await runBackfillBatch([source]);
  expect(result.lastError).toBe('');
  const pages=memory.tables.evidence_pages;
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.flatMap(page=>page.events)).toHaveLength(6);
  expect(pages.every(page=>Buffer.byteLength(JSON.stringify(page)) < 256*1024)).toBe(true);
  expect(memory.tables.backfill_cursors[0].processed).toBe(6);
});

it('rejects a single oversized archived record before writing partial data or advancing', async () => {
  feed([{objectid:1,name:'QA Oversize',description:'界'.repeat(100000),grantdate:'2020-01-01'}]);
  const result=await runBackfillBatch([source]);
  expect(result.lastError).toContain('EVIDENCE_RECORD_TOO_LARGE');
  expect(memory.tables.evidence_pages || []).toHaveLength(0);
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
});

it('retains a failed archive checkpoint and retries to a single visible evidence record', async () => {
  memory.rejectArchive=1; feed();
  const first=await runBackfillBatch([source]);
  expect(first.lastError).toContain('EVIDENCE_PAGE_SAVE_FAILED');
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
  await runBackfillBatch([source]);
  const result=await call('GET /api/dashboard');
  expect(result.data.projects).toHaveLength(1);
  expect(result.data.projects[0].evidenceCount).toBe(1);
});

it('reports failed cursor acknowledgement and does not inflate evidence when that batch replays', async () => {
  memory.rejectCursor=1; feed();
  const first=await runBackfillBatch([source]);
  expect(first.lastError).toContain('BACKFILL_CURSOR_SAVE_FAILED');
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
  await runBackfillBatch([source]);
  const result=await call('GET /api/dashboard');
  expect(result.data.projects[0].evidenceCount).toBe(1);
  expect(memory.tables.backfill_cursors[0].processed).toBe(1);
});

it('propagates a rejected scheduler control write instead of claiming success', async () => {
  memory.rejectControl=true; feed();
  await expect(runBackfillBatch([source])).rejects.toThrow('BACKFILL_CONTROL_SAVE_FAILED');
});

it('propagates database quota errors without hidden retry or successful status', async () => {
  memory.quota=true; feed();
  await expect(runBackfillBatch([source])).rejects.toThrow('AppDatabaseQuotaExceeded');
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
});

it('keeps a CKAN resource pinned when publication changes after an archive write failure', async () => {
  const s=SOURCES.find(item=>item.key==='qld-granted-resource-authorities')!;
  let resource='old'; const selected:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async (input:string|URL)=>{
    const url=new URL(input);
    if(url.pathname.endsWith('package_show'))return new Response(JSON.stringify({success:true,result:{resources:[{id:resource,datastore_active:true,created:'2026-09-01'}]}}));
    selected.push(url.searchParams.get('resource_id')!);
    return new Response(JSON.stringify({success:true,result:{records:[{_id:1,name:'QA Archive',date:'2020-01-01'}],total:1}}));
  }));
  memory.rejectArchive=1;
  await runBackfillBatch([s]); resource='new'; await runBackfillBatch([s]);
  expect(selected).toEqual(['old','old']);
});

it('keeps the AusTender date anchor fixed when archive persistence fails across days', async () => {
  const s=SOURCES.find(item=>item.key==='austender-contract-notices')!, requests:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL)=>{requests.push(String(input));return new Response(JSON.stringify({releases:[{id:'one',date:'2020-01-01',tender:{title:'QA Archive'}}]}));}));
  memory.rejectArchive=1;
  await runBackfillBatch([s]); vi.setSystemTime(new Date('2026-09-23T00:00:00Z')); await runBackfillBatch([s]);
  expect(requests[1]).toBe(requests[0]);
});

it('retains progress after a later archive chunk fails and deduplicates its replay', async () => {
  feed(Array.from({length:6},(_,i)=>({objectid:i+1,name:'QA Bridge '+i,description:'x'.repeat(45000),grantdate:'2020-01-01'})));
  memory.rejectArchiveAt=2;
  const first=await runBackfillBatch([source]);
  expect(first.lastError).toContain('EVIDENCE_PAGE_SAVE_FAILED');
  expect(memory.tables.evidence_pages).toHaveLength(1);
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
  await runBackfillBatch([source]);
  const result=await call('GET /api/dashboard');
  expect(result.data.universe.loaded).toBe(6);
  expect(result.data.universe.duplicateRecords).toBe(0);
  expect(memory.tables.evidence_pages.flatMap(page=>page.events)).toHaveLength(6);
  expect(memory.tables.backfill_cursors[0].processed).toBe(6);
});

it('rejects a normalized batch exceeding the write budget before any archive writes', async () => {
  feed(Array.from({length:25},(_,i)=>({objectid:i+1,name:'QA Bridge '+i,description:'x'.repeat(45000),grantdate:'2020-01-01'})));
  const result=await runBackfillBatch([source]);
  expect(result.lastError).toContain('EVIDENCE_BATCH_TOO_LARGE');
  expect(memory.tables.evidence_pages || []).toHaveLength(0);
  expect(memory.tables.backfill_cursors[0].cursor).toBe(0);
});

it('continues past malformed archive pages and reports their presence', async () => {
  memory.tables.evidence_pages=[archive([],{events:null}),archive([evidence()])];
  const result=await call('GET /api/dashboard');
  expect(result.data.universe.invalidArchivePages).toBe(1);
  expect(result.data.projects).toHaveLength(1);
});
