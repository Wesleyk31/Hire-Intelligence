from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path('.').resolve()


def read(rel):
    p = ROOT / rel
    if not p.exists():
        raise SystemExit(f'Missing required file: {rel}')
    return p.read_text()


def write(rel, text):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)
    print(f'updated {rel}')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one anchor, found {count}')
    return text.replace(old, new)


def replace_all(text, old, new, label):
    count = text.count(old)
    if not count:
        raise SystemExit(f'{label}: anchor not found')
    return text.replace(old, new)

# --- new files ---
for rel in ['backend/domain-hardening.ts', 'backend/data-access.ts', 'backend/operations.ts', 'src/AuthGate.tsx', 'src/DemoRequestForm.tsx', 'src/legal-content.ts']:
    source = Path(__file__).resolve().parents[1] / rel
    write(rel, source.read_text())
write('src/reporting.ts', (Path(__file__).resolve().parents[1] / 'src/reporting.hardened.ts').read_text())

# --- App auth gate ---
app = read('src/App.tsx')
app = replace_once(app, "import FunctionalApp from './FunctionalApp';\nimport LandingPage from './LandingPage';", "import FunctionalApp from './FunctionalApp';\nimport LandingPage from './LandingPage';\nimport AuthGate from './AuthGate';", 'App auth import')
app = replace_once(app, "      <FunctionalApp/>", "      <AuthGate onExit={openHome}><FunctionalApp/></AuthGate>", 'App auth wrap')
write('src/App.tsx', app)

# --- backend/index.ts ---
idx = read('backend/index.ts')
idx = replace_once(idx, "import { router,json,error,db } from '@appdeploy/sdk';", "import { router,json,error,db,requireAuth } from '@appdeploy/sdk';", 'backend auth import')
idx = replace_once(idx, "import { buildCommercialIntelligence } from './commercial-intelligence';", "import { buildCommercialIntelligence } from './commercial-intelligence';\nimport { aggregateOutcomeFunnel, extractSourceDate, inferOrganisation, isCallNowCandidate } from './domain-hardening';\nimport { listBounded } from './data-access';\nimport { listReportHistory, saveDemoRequest, saveReportHistory } from './operations';", 'backend hardening imports')
idx = replace_once(idx, "type Opportunity={sourceKey:string;externalId:string;project:string;location:string;stage:'WATCH'|'RISING'|'PREPARE';score:number;window:string;equipment:string;action:string;company:string;description:string;value:string;observedAt:string;provenance:string;evidenceType:'EXPLICIT'};", "type Opportunity={sourceKey:string;externalId:string;project:string;location:string;stage:'WATCH'|'RISING'|'PREPARE';score:number;window:string;equipment:string;action:string;company:string;organisationRole?:'DELIVERY_CONTRACTOR'|'OWNER_PROPONENT'|'APPLICANT_HOLDER'|'SUPPLIER'|'OPERATOR'|'UNKNOWN';description:string;value:string;observedAt:string;sourceObservedAt?:string;provenance:string;evidenceType:'EXPLICIT'};", 'Opportunity role/date type')

old_raw = "function rawOpportunity(source:SourceDef,externalId:string,raw:Record<string,unknown>,observedAt:string):Opportunity{\n const title=find(raw,['projectname','projecttitle','tenement','tenure','tno','permitnumber','permitreference','authoritynumber','authorityno','eanumber','contractid','wellname','sitename','title','road','description','name'])||externalId;\n const holder=find(raw,['holder','clientname','applicant','proponent','suppliername','supplier','company','organisation','organization','ownname','operator']);\n const location=find(raw,['locality','location','suburb','shire','lga','miningdistrict','region','district','area','state'])||source.territory;\n const description=find(raw,['worktype','description','descriptio','activity','purpose','commodity','resource','permittype','eventsubtype','eventdueto','type','status','industry']);\n const amount=num(find(raw,['contractvalue','value','amount']));const low=(title+' '+description).toLowerCase();\n const equipment=low.includes('road')||low.includes('earth')?'PREDICTED · Excavators · graders · rollers':low.includes('mine')||low.includes('mining')?'PREDICTED · Excavators · loaders · support fleet':'Equipment demand not yet evidenced';\n const stage:Opportunity['stage']=source.key.includes('granted')||source.key.includes('transferred')?'PREPARE':source.key.includes('environmental')?'RISING':'WATCH';const score=stage==='PREPARE'?64:stage==='RISING'?56:44;\n return {sourceKey:source.key,externalId,project:title,location,stage,score,window:stage==='PREPARE'?'Procurement timing requires verification':stage==='RISING'?'Early movement detected':'Early signal only',equipment,action:stage==='PREPARE'?'Verify contractor, timing and equipment requirement':stage==='RISING'?'Monitor progression and identify contractor':'Watch for corroborating evidence',company:holder,description,value:formatValue(amount),observedAt,provenance:source.provenance,evidenceType:'EXPLICIT'};\n}"
new_raw = "function rawOpportunity(source:SourceDef,externalId:string,raw:Record<string,unknown>,observedAt:string):Opportunity{\n const title=find(raw,['projectname','projecttitle','tenement','tenure','tno','permitnumber','permitreference','authoritynumber','authorityno','eanumber','contractid','wellname','sitename','title','road','description','name'])||externalId;\n const organisation=inferOrganisation(source.key,raw);\n const location=find(raw,['locality','location','suburb','shire','lga','miningdistrict','region','district','area','state'])||source.territory;\n const description=find(raw,['worktype','description','descriptio','activity','purpose','commodity','resource','permittype','eventsubtype','eventdueto','type','status','industry']);\n const amount=num(find(raw,['contractvalue','value','amount']));const low=(title+' '+description).toLowerCase();\n const equipment=low.includes('road')||low.includes('earth')?'PREDICTED · Excavators · graders · rollers':low.includes('mine')||low.includes('mining')?'PREDICTED · Excavators · loaders · support fleet':'Equipment demand not yet evidenced';\n const stage:Opportunity['stage']=source.key.includes('granted')||source.key.includes('transferred')?'PREPARE':source.key.includes('environmental')?'RISING':'WATCH';const score=stage==='PREPARE'?64:stage==='RISING'?56:44;\n return {sourceKey:source.key,externalId,project:title,location,stage,score,window:stage==='PREPARE'?'Procurement timing requires verification':stage==='RISING'?'Early movement detected':'Early signal only',equipment,action:stage==='PREPARE'?'Verify delivery organisation, timing and equipment requirement':stage==='RISING'?'Monitor progression and identify the delivery organisation':'Watch for corroborating evidence',company:organisation.name,organisationRole:organisation.role,description,value:formatValue(amount),observedAt,sourceObservedAt:extractSourceDate(raw,observedAt),provenance:source.provenance,evidenceType:'EXPLICIT'};\n}"
idx = replace_once(idx, old_raw, new_raw, 'rawOpportunity hardening')

pilot_old = re.search(r"function pilotMetrics\(rows:PilotOutcome\[\]\)\{.*?\}\nasync function buildDashboard\(\)", idx, re.S)
if not pilot_old:
    raise SystemExit('pilotMetrics anchor not found')
idx = idx[:pilot_old.start()] + "function pilotMetrics(rows:PilotOutcome[]){return aggregateOutcomeFunnel(rows)}\nasync function buildDashboard()" + idx[pilot_old.end():]

v2 = re.search(r"async function buildDashboardV2\(\)\{.*?\}\n\nexport const refreshSourcesHandler", idx, re.S)
if not v2:
    raise SystemExit('buildDashboardV2 anchor not found')
new_v2 = """async function buildDashboardV2(){
 await ensureActivation();
 let backfill=await getBackfillStatus(BACKFILL_SOURCES);
 if(!backfill.processed)backfill=await runBackfillBatch(BACKFILL_SOURCES);
 const s=await listBounded<SourceState>('source_states',{pageSize:100,maxItems:500});
 const o=await listBounded<Opportunity>('opportunities',{pageSize:500,maxItems:1500});
 const p=await listBounded<PilotOutcome>('pilot_outcomes',{pageSize:250,maxItems:1000});
 const raw=[...o.items].sort((a,b)=>(b.sourceObservedAt||b.observedAt).localeCompare(a.sourceObservedAt||a.observedAt));
 const baseProjects=await buildProjectIntelligence(raw,LIVE_SOURCES);
 const projects=baseProjects.map(project=>({...project,callNow:isCallNowCandidate(project)}));
 const calibration=buildCalibrationMetrics(projects,p.items);
 const commercial=buildCommercialIntelligence(projects,p.items,LIVE_SOURCES);
 const liveKeys=new Set(LIVE_SOURCES.map(x=>x.key));
 const states=s.items.filter(x=>liveKeys.has(x.sourceKey));
 const success=states.filter(x=>x.status==='SUCCESS').length;
 const fetched=states.reduce((n,x)=>n+x.recordsFetched,0);
 const metrics=pilotMetrics(p.items);
 const feed=projects.slice(0,6).map(x=>x.name+' · '+x.stageLabel+' · priority '+x.bdmPriority);
 return {metrics:{callNow:projects.filter(project=>project.callNow).length,active:projects.length,genesis:projects.filter(x=>x.stageLabel==='WATCH').length,approvals:projects.filter(x=>x.stageLabel==='APPROVAL').length,tenders:projects.filter(x=>x.stageLabel==='PROCUREMENT'||x.stageLabel==='AWARDED').length,stageMoves:projects.filter(x=>x.stageChanged).length,highPriority:projects.filter(x=>x.priorityBand==='HIGH').length,pilotQueue:commercial.pilotQueue.length,eventSignals:commercial.events.length,fleetWatch:commercial.fleetPositioning.length,workforce:0},projects,opportunities:raw.slice(0,500),feed,commercial,sources:{configured:LIVE_SOURCES.length,active:success,runtimeFetched:fetched,rights:'Lawful source automation',states,deferred:SOURCES.filter(x=>x.enabled===false).map(x=>({sourceKey:x.key,name:x.name,licence:x.licence,provenance:x.provenance,reason:x.disableReason||'Deferred pending revalidation'}))},pilot:{...metrics,recentOutcomes:[...p.items].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).slice(0,25),humanEnteredOnly:true,calibration,wonValueLabel:metrics.wonValue?'AUD '+metrics.wonValue.toLocaleString('en-AU'):'—',quotedValueLabel:metrics.quotedValue?'AUD '+metrics.quotedValue.toLocaleString('en-AU'):'—'},backfill,coverage:success===LIVE_SOURCES.length?LIVE_SOURCES.length+'/'+LIVE_SOURCES.length+' lawful feeds successful':states.length?'Latest source cycle '+success+'/'+LIVE_SOURCES.length+' successful':'Sources configured · refresh required',universe:{loaded:o.items.length,truncated:o.truncated,pagesRead:o.pagesRead,outcomesLoaded:p.items.length,outcomesTruncated:p.truncated}}}

export const refreshSourcesHandler"""
idx = idx[:v2.start()] + new_v2 + idx[v2.end():]
idx = idx.replace("export const refreshSourcesHandler=async()=>{const states=await refreshAllSources();const failed=states.filter(x=>x.status==='FAILED');if(failed.length)throw new Error('LIVE_SOURCE_REFRESH_FAILED '+failed.map(x=>x.sourceKey+':'+x.message).join('|'));return {statusCode:200}};", "export const refreshSourcesHandler=async()=>{const states=await refreshAllSources();const failed=states.filter(x=>x.status==='FAILED');if(failed.length)console.warn('LIVE_SOURCE_REFRESH_DEGRADED',failed.map(x=>x.sourceKey+':'+x.message).join('|'));return {statusCode:200,body:JSON.stringify({status:failed.length?'DEGRADED':'SUCCESS',failed:failed.map(x=>x.sourceKey)})}};")
idx = idx.replace("export const backfillSourcesHandler=async()=>{for(let i=0;i<4;i++){const status=await runBackfillBatch(BACKFILL_SOURCES);if(status.lastSource&&status.lastError.startsWith(status.lastSource+': '))throw new Error('BACKFILL_SOURCE_FAILED '+status.lastError)}return {statusCode:200}};", "export const backfillSourcesHandler=async()=>{let last=await getBackfillStatus(BACKFILL_SOURCES);for(let i=0;i<4;i++)last=await runBackfillBatch(BACKFILL_SOURCES);if(last.lastError)console.warn('BACKFILL_DEGRADED',last.lastError);return {statusCode:200,body:JSON.stringify({status:last.lastError?'DEGRADED':'SUCCESS',backfill:last})}};")
idx = replace_once(idx, "'POST /api/sources/refresh':[async()=>json({sources:await refreshAllSources()})],\n'GET /api/backfill/status':[async()=>json(await getBackfillStatus(BACKFILL_SOURCES))],\n'POST /api/backfill/run':[async()=>json(await runBackfillBatch(BACKFILL_SOURCES))],\n'GET /api/pilot/outcomes':[async()=>json((await db.list<PilotOutcome>('pilot_outcomes',{limit:100})).items)],", "'POST /api/sources/refresh':[requireAuth(),async()=>json({sources:await refreshAllSources()})],\n'GET /api/backfill/status':[requireAuth(),async()=>json(await getBackfillStatus(BACKFILL_SOURCES))],\n'POST /api/backfill/run':[requireAuth(),async()=>json(await runBackfillBatch(BACKFILL_SOURCES))],\n'GET /api/pilot/outcomes':[requireAuth(),async()=>json((await listBounded<PilotOutcome>('pilot_outcomes',{pageSize:250,maxItems:1000})).items)],\n'GET /api/reports/history':[requireAuth(),async(ctx)=>json(await listReportHistory(ctx.user!))],\n'POST /api/reports/history':[requireAuth(),async(ctx)=>{const saved=await saveReportHistory(ctx.user!,ctx.body);return saved?json(saved,201):error('Report history save failed',500)}],\n'POST /api/demo-request':[async({body})=>{const saved=await saveDemoRequest(body);return saved.ok?json(saved,201):error(saved.error,400)}],", 'protected routes and public demo route')
idx = idx.replace("'POST /api/pilot/outcomes':[async({body})=>{", "'POST /api/pilot/outcomes':[requireAuth(),async({body})=>{")
idx = idx.replace("const opportunityPage=await db.list<Opportunity>('opportunities',{limit:100});const currentProjects=await buildProjectIntelligence(opportunityPage.items,LIVE_SOURCES);", "const opportunityPage=await listBounded<Opportunity>('opportunities',{pageSize:500,maxItems:1500});const currentProjects=await buildProjectIntelligence(opportunityPage.items,LIVE_SOURCES);")
idx = idx.replace("metrics:pilotMetrics((await db.list<PilotOutcome>('pilot_outcomes',{limit:100})).items)", "metrics:pilotMetrics((await listBounded<PilotOutcome>('pilot_outcomes',{pageSize:250,maxItems:1000})).items)")
write('backend/index.ts', idx)

# --- backend/intelligence.ts ---
intel = read('backend/intelligence.ts')
intel = replace_once(intel, "import { db } from '@appdeploy/sdk';", "import { db } from '@appdeploy/sdk';\nimport { chooseCurrentStage, evidenceTimestamp, groupCanonicalEvidence } from './domain-hardening';\nimport { listBounded } from './data-access';", 'intelligence imports')
intel = replace_once(intel, "  observedAt: string;\n  provenance: string;", "  observedAt: string;\n  sourceObservedAt?: string;\n  organisationRole?: 'DELIVERY_CONTRACTOR' | 'OWNER_PROPONENT' | 'APPLICANT_HOLDER' | 'SUPPLIER' | 'OPERATOR' | 'UNKNOWN';\n  provenance: string;", 'intelligence evidence fields')
intel = replace_once(intel, "  const timestamp = Date.parse(record.observedAt);", "  const timestamp = evidenceTimestamp(record);", 'freshness source date')
intel = replace_once(intel, "  const base = { sourceKey: record.sourceKey, observedAt: record.observedAt, reliability: sourceReliability(record.sourceKey, source) };", "  const base = { sourceKey: record.sourceKey, observedAt: record.sourceObservedAt || record.observedAt, reliability: sourceReliability(record.sourceKey, source) };", 'stage evidence date')
intel = replace_once(intel, "  const named = records.filter(record => record.company.trim());", "  const named = records.filter(record => record.company.trim() && record.organisationRole === 'DELIVERY_CONTRACTOR');", 'contractor confidence role')
old_group = "  const groups = new Map<string, IntelligenceEvidence[]>();\n  for (const record of records) {\n    const key = normaliseKey(record.project || record.externalId);\n    if (!key) continue;\n    const group = groups.get(key) || [];\n    group.push(record);\n    groups.set(key, group);\n  }\n  const snapshotPage = await db.list<StageSnapshot>('project_stage_snapshots', { limit: 100 });"
new_group = "  const groups = groupCanonicalEvidence(records);\n  const snapshotPage = await listBounded<StageSnapshot>('project_stage_snapshots', { pageSize: 500, maxItems: 2000 });"
intel = replace_once(intel, old_group, new_group, 'canonical grouping and snapshot paging')
intel = replace_once(intel, "  const snapshotByKey = new Map(snapshotPage.items.map(item => [item.projectKey, item]));", "  const snapshotByKey = new Map(snapshotPage.items.map(item => [item.projectKey, item]));", 'snapshot map')
intel = replace_once(intel, "    stageSignals.sort((a, b) => stageRank[b.label] - stageRank[a.label] || b.confidence - a.confidence || b.observedAt.localeCompare(a.observedAt));\n    const currentStage = stageSignals[0];", "    const currentStage = chooseCurrentStage(stageSignals, stageRank, 45);", 'recency-aware stage')
intel = replace_once(intel, "    const contractors = [...new Set(projectRecords.map(record => record.company.trim()).filter(Boolean))];", "    const contractors = [...new Set(projectRecords.filter(record => record.organisationRole === 'DELIVERY_CONTRACTOR').map(record => record.company.trim()).filter(Boolean))];", 'delivery contractor filter')
intel = replace_once(intel, "    const lead = [...projectRecords].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];", "    const lead = [...projectRecords].sort((a, b) => evidenceTimestamp(b) - evidenceTimestamp(a))[0];", 'lead evidence source date')
intel = replace_once(intel, "  if (updates.length) await db.update('project_stage_snapshots', updates.slice(0, 100));\n  const availableSlots = Math.max(0, 100 - snapshotPage.items.length);\n  if (additions.length && availableSlots) await db.add('project_stage_snapshots', additions.slice(0, availableSlots));", "  for (let i=0;i<updates.length;i+=500) await db.update('project_stage_snapshots', updates.slice(i,i+500));\n  for (let i=0;i<additions.length;i+=500) await db.add('project_stage_snapshots', additions.slice(i,i+500));", 'snapshot scaling')
intel = replace_once(intel, "  return projects.sort((a, b) => b.bdmPriority - a.bdmPriority || b.signalQualityScore - a.signalQualityScore || b.evidenceCount - a.evidenceCount).slice(0, 50);", "  return projects.sort((a, b) => b.bdmPriority - a.bdmPriority || b.signalQualityScore - a.signalQualityScore || b.evidenceCount - a.evidenceCount).slice(0, 500);", 'project ceiling')
write('backend/intelligence.ts', intel)

# --- backfill source fixes ---
bf = read('backend/backfill-fetch.ts')
bf = replace_once(bf, "import { read, utils } from 'xlsx';", "import { read, utils } from 'xlsx';\nimport { extractSourceDate, inferOrganisation } from './domain-hardening';", 'backfill hardening imports')
bf = replace_once(bf, "export type Evidence = { sourceKey: string; externalId: string; project: string; company: string; location: string; description: string; observedAt: string; provenance: string; evidenceType: 'EXPLICIT' };", "export type Evidence = { sourceKey: string; externalId: string; project: string; company: string; organisationRole?: 'DELIVERY_CONTRACTOR'|'OWNER_PROPONENT'|'APPLICANT_HOLDER'|'SUPPLIER'|'OPERATOR'|'UNKNOWN'; location: string; description: string; observedAt: string; sourceObservedAt?: string; provenance: string; evidenceType: 'EXPLICIT' };", 'backfill evidence fields')
old_norm = "export function normalizeEvidence(source: BackfillSource, row: RawRow, observedAt: string): Evidence { return { sourceKey: source.key, externalId: row.externalId, project: find(row.raw, ['projectname','projecttitle','tenement','tenure','permitnumber','authoritynumber','contractid','title','name','description']) || row.externalId, company: find(row.raw, ['holder','clientname','applicant','proponent','suppliername','supplier','company','organisation','organization']), location: find(row.raw, ['locality','location','shire','lga','miningdistrict','region','district','area','state']) || source.territory, description: find(row.raw, ['description','activity','purpose','commodity','resource','permittype','type','status','industry']), observedAt, provenance: source.provenance, evidenceType: 'EXPLICIT' }; }"
new_norm = "export function normalizeEvidence(source: BackfillSource, row: RawRow, observedAt: string): Evidence { const organisation=inferOrganisation(source.key,row.raw); return { sourceKey: source.key, externalId: row.externalId, project: find(row.raw, ['projectname','projecttitle','tenement','tenure','permitnumber','authoritynumber','contractid','title','name','description']) || row.externalId, company: organisation.name, organisationRole: organisation.role, location: find(row.raw, ['locality','location','shire','lga','miningdistrict','region','district','area','state']) || source.territory, description: find(row.raw, ['description','activity','purpose','commodity','resource','permittype','type','status','industry']), observedAt, sourceObservedAt: extractSourceDate(row.raw, observedAt), provenance: source.provenance, evidenceType: 'EXPLICIT' }; }"
bf = replace_once(bf, old_norm, new_norm, 'backfill normalize roles/source dates')
old_ods = "async function ods(source: BackfillSource, cursor: number): Promise<Page> { const body = await jsonFetch(params(source.endpoint, { limit: String(BATCH), offset: String(cursor) })) as any; if (!Array.isArray(body.results)) throw new Error('ODS_SCHEMA_INVALID'); const rows = body.results.map((row: any, index: number) => ({ externalId: text(row.recordid || row.id || row.permit_number || row.project_id || cursor + index + 1), raw: row as Record<string, unknown> })); const total = Number(body.total_count || 0); return { rows, next: cursor + rows.length, completed: rows.length < BATCH || (total > 0 && cursor + rows.length >= total) }; }"
new_ods = "async function ods(source: BackfillSource, cursor: number): Promise<Page> { const url=new URL(source.endpoint);url.searchParams.delete('order_by');url.searchParams.set('limit',String(BATCH));url.searchParams.set('offset',String(cursor)); let body:any; try{body=await jsonFetch(url.toString()) as any}catch(error){if(error instanceof Error&&error.message==='HTTP_400'&&cursor===0){url.searchParams.delete('offset');body=await jsonFetch(url.toString()) as any}else throw error} if (!Array.isArray(body.results)) throw new Error('ODS_SCHEMA_INVALID'); const rows = body.results.map((row: any, index: number) => ({ externalId: text(row.recordid || row.id || row.permit_number || row.project_id || cursor + index + 1), raw: row as Record<string, unknown> })); const total = Number(body.total_count || 0); return { rows, next: cursor + rows.length, completed: rows.length < BATCH || (total > 0 && cursor + rows.length >= total) }; }"
bf = replace_once(bf, old_ods, new_ods, 'OpenDataSoft backfill repair')
write('backend/backfill-fetch.ts', bf)

# --- FunctionalApp product cleanup ---
fa = read('src/FunctionalApp.tsx')
fa = replace_all(fa, "'Companies & Contacts'", "'Organisations & Delivery Teams'", 'rename organisations view literals')
fa = replace_all(fa, "Companies & Contacts", "Organisations & Delivery Teams", 'rename organisations copy')
fa = replace_all(fa, "companies-contacts", "organisations-delivery-teams", 'rename organisations route slug')
fa = fa.replace("setMessage('GREEN source refresh complete.');", "setMessage('Source refresh complete. Review source health for any degraded feeds.');")
fa = fa.replace("{refreshing ? 'Refreshing…' : 'Refresh GREEN feeds'}", "{refreshing ? 'Refreshing…' : 'Refresh sources'}")
fa = fa.replace("<CardHeader title='Scope 2150 Programme' subtitle='Operational status is explicit; data-gated and source-gated blocks are not presented as completed.'/>", "<CardHeader title='Engine Capability Status' subtitle='Operational, data-limited and source-limited capabilities are shown explicitly.'/>")
fa = fa.replace("<small>SCOPES {block.from}–{block.to}</small>", "<small>{block.status}</small>")
fa = fa.replace("title='Contractor Workload' subtitle='Evidence-linked workload, not invented contacts.'", "title='Delivery Organisation Workload' subtitle='Evidence-backed delivery organisations only; owners and applicants are not treated as contractors.'")
fa = fa.replace("<small>PREDICTED · {item.confidence}% confidence</small>", "<small>PREDICTED · {item.confidence}% heuristic confidence</small>")
fa = fa.replace("<small>{item.confidence}% confidence</small><b>{item.equipmentClass}</b>", "<small>{item.confidence}% heuristic confidence</small><b>{item.equipmentClass}</b>")
fa = fa.replace("<span>GREEN runnable</span>", "<span>Runnable sources</span>")
fa = fa.replace("title='GREEN / Runtime Sources'", "title='Current Source Health'")
fa = fa.replace("<small>AMBER · NOT RUNNING</small>", "<small>CANDIDATE · NOT RUNNING</small>")
# Decision Desk activity becomes clickable.
old_event = "{events.slice(0, 10).map((event, index) => <div key={`${event.projectId}-${event.type}-${index}`}>\n            <Activity size={15}/>\n            <span><b>{event.type}</b><small>{event.project} · {event.location}</small></span>\n            <em>{event.confidence}%</em>\n          </div>)}"
new_event = "{events.slice(0, 10).map((event, index) => <button type='button' key={`${event.projectId}-${event.type}-${index}`} onClick={() => { const project=projects.find(item=>item.id===event.projectId); if(project) open(project); }}>\n            <Activity size={15}/>\n            <span><b>{event.type}</b><small>{event.project} · {event.location}</small></span>\n            <em>{event.confidence}%</em>\n          </button>)}"
fa = replace_once(fa, old_event, new_event, 'Decision Desk event drilldown')
write('src/FunctionalApp.tsx', fa)

# --- GeoMap accuracy fixes ---
gm = read('src/GeoMap.tsx')
gm = gm.replace("function locate(project: ProjectPoint): Resolution {", "function locate(project: ProjectPoint): Resolution | null {")
gm = gm.replace("return { latitude: -25.27, longitude: 133.78, precision: 'STATE_LEVEL', label: 'Australia - location unresolved' }; }", "return null; }")
gm = gm.replace("const projectPoints = projects.map(project => { const geo = locate(project); return {", "const projectPoints = projects.flatMap(project => { const geo = locate(project); if(!geo)return []; return [{")
gm = gm.replace("detectedAt: newestProjectDate(project) }; }); const eventPoints", "detectedAt: newestProjectDate(project) }]; }); const eventPoints")
gm = gm.replace("const geo = locate(project); return [{", "const geo = locate(project); if(!geo)return []; return [{")
gm = gm.replace("const visiblePoints = useMemo(() => points.filter(point => inBounds(point, bounds)), [points, bounds]); const visibleProjectIds = useMemo(() => new Set(visiblePoints.map(point => point.projectId)), [visiblePoints]); const visibleProjects = projects.filter(project => visibleProjectIds.has(project.id)); const visibleEvents = visiblePoints.filter(point => point.kind === 'OPPORTUNITY'); const highCount = visiblePoints.filter(point => point.priority >= 80).length; const shutdownCount = visibleEvents.filter(point => /SHUTDOWN|OUTAGE/.test(point.signalType || '')).length; const procurementCount = visiblePoints.filter(point => /PROCUREMENT|AWARDED/.test(point.stage)).length; const equipmentSummary = [...new Map(visiblePoints.flatMap(point => point.equipment.map(item => [item, visiblePoints.filter(candidate => candidate.equipment.includes(item)).length] as const))).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);", "const visiblePoints = useMemo(() => points.filter(point => inBounds(point, bounds)), [points, bounds]); const visibleProjectIds = useMemo(() => new Set(visiblePoints.map(point => point.projectId)), [visiblePoints]); const visibleProjects = projects.filter(project => visibleProjectIds.has(project.id)); const visibleEvents = visiblePoints.filter(point => point.kind === 'OPPORTUNITY'); const unmappedCount=projects.filter(project=>!locate(project)).length; const highCount = visibleProjects.filter(project => project.bdmPriority >= 80).length; const shutdownCount = new Set(visibleEvents.filter(point => /SHUTDOWN|OUTAGE/.test(point.signalType || '')).map(point=>point.projectId)).size; const procurementCount = visibleProjects.filter(project => /PROCUREMENT|AWARDED/.test(project.stageLabel)).length; const equipmentCounts=new Map<string,number>(); for(const project of visibleProjects)for(const item of project.equipmentPrediction.classes)equipmentCounts.set(item,(equipmentCounts.get(item)||0)+1); const equipmentSummary=[...equipmentCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);")
gm = gm.replace("Pan/zoom changes the regional intelligence summary and visible opportunity list in real time.", "Pan/zoom changes the current regional intelligence summary and visible opportunity list.")
gm = gm.replace("<span>{visiblePoints.length} visible · {highCount} high · zoom {zoom}</span>", "<span>{visibleProjectIds.size} projects · {visibleEvents.length} signals · {unmappedCount} unmapped · {highCount} high · zoom {zoom}</span>")
write('src/GeoMap.tsx', gm)

# --- Landing truthfulness, dynamic preview, forms/legal ---
lp = read('src/LandingPage.tsx')
lp = replace_once(lp, "import { api } from '@appdeploy/client';", "import { api } from '@appdeploy/client';\nimport DemoRequestForm from './DemoRequestForm';\nimport { PRIVACY_SECTIONS, TERMS_SECTIONS } from './legal-content';", 'landing imports')
lp = lp.replace("from public and private sources, before demand hits.", "from lawful public sources and user-entered commercial outcomes, before demand hits.")
lp = lp.replace("Backed by real-time data.", "Backed by current scheduled source data.")
lp = lp.replace("Real-time signals across Australia", "Current signals across Australia")
lp = lp.replace("Companies & Contacts", "Organisations & Delivery Teams")
# Dynamic regional counts.
anchor = "  const topProject = dashboard?.projects?.[0];"
insert = "  const topProject = dashboard?.projects?.[0];\n  const regionCount = (code: string) => (dashboard?.projects || []).filter(project => new RegExp(`(?:^|[\\s,()\\-])${code}(?=$|[\\s,()\\-])`, 'i').test(project.location || '')).length;"
lp = replace_once(lp, anchor, insert, 'landing regional count helper')
lp = lp.replace("<div className='hi2-map-pill wa'>WA<br/><b>142</b></div>", "<div className='hi2-map-pill wa'>WA<br/><b>{regionCount('WA') || '—'}</b></div>")
lp = lp.replace("<div className='hi2-map-pill qld'>QLD<br/><b>311</b></div>", "<div className='hi2-map-pill qld'>QLD<br/><b>{regionCount('QLD') || '—'}</b></div>")
lp = lp.replace("<div className='hi2-map-pill nsw'>NSW<br/><b>198</b></div>", "<div className='hi2-map-pill nsw'>NSW<br/><b>{regionCount('NSW') || '—'}</b></div>")
# Remove fake social marker.
lp = lp.replace("<button onClick={() => openPublicPage('contact')}>Contact</button><span>in</span>", "<button onClick={() => openPublicPage('contact')}>Contact</button>")
# Real demo modal.
old_modal = "<div className='hi2-eyebrow'>HIRE INTELLIGENCE</div>\n        <h2>See the platform in action.</h2>\n        <p>Open the live platform now to explore the current intelligence workspace and its existing modules.</p>\n        <button className='hi2-red-button hi2-large' onClick={onExplore}>Explore the live platform <ArrowRight size={16}/></button>"
new_modal = "<div className='hi2-eyebrow'>REQUEST A DEMO</div>\n        <h2>See Hire Intelligence in action.</h2>\n        <p>Tell us who you are and what you want to evaluate. The request is recorded for follow-up; the operational workspace remains sign-in protected.</p>\n        <DemoRequestForm compact/>"
lp = replace_once(lp, old_modal, new_modal, 'demo workflow')
# Legal page card content injection by replacing detail cards at render time.
old_detail = "  const detail = PUBLIC_DETAILS[page];\n  return <main className='hi2-public-page' data-public-page={page}>"
new_detail = "  const detail = PUBLIC_DETAILS[page];\n  const cards = page==='privacy' ? PRIVACY_SECTIONS.map(([title,copy])=>({title,copy})) : page==='terms' ? TERMS_SECTIONS.map(([title,copy])=>({title,copy})) : detail.cards;\n  return <main className='hi2-public-page' data-public-page={page}>"
lp = replace_once(lp, old_detail, new_detail, 'legal card source')
lp = lp.replace("{detail.cards.map(card =>", "{cards.map(card =>")
# Contact page gets actual form.
lp = lp.replace("{page === 'contact' && <section className='hi2-public-contact-actions'>\n      <button className='hi2-red-button hi2-large' onClick={onDemo}>Request a demo <ArrowRight size={16}/></button>\n      <button className='hi2-outline-button hi2-large' onClick={onExplore}>Open live platform</button>\n    </section>}", "{page === 'contact' && <section className='hi2-public-contact-actions'><DemoRequestForm/><button className='hi2-outline-button hi2-large' onClick={onExplore}>Open secure workspace</button></section>}")
write('src/LandingPage.tsx', lp)

# --- CSS additions ---
css = read('src/index.css')
css += "\n.auth-gate{min-height:100vh;display:grid;place-items:center;background:#f3f5f7;padding:24px}.auth-panel{width:min(520px,94vw);background:#fff;border:1px solid #dde2e6;border-top:4px solid #ef2029;padding:30px;box-shadow:0 18px 50px rgba(0,0,0,.08)}.auth-panel small{font-weight:900;color:#ef2029;letter-spacing:.12em}.auth-panel h1{margin:8px 0;font-size:32px}.auth-panel p{color:#59626b;line-height:1.5}.auth-panel button,.auth-userbar button{border:0;background:#ef2029;color:#fff;padding:10px 14px;font-weight:800}.auth-panel button.secondary{background:#fff;color:#222;border:1px solid #dfe3e6;margin-left:8px}.auth-error{background:#fff2f2;color:#9d262c;padding:9px;margin:12px 0}.auth-userbar{position:fixed;right:12px;bottom:12px;z-index:1500;background:#fff;border:1px solid #dfe3e6;box-shadow:0 6px 20px rgba(0,0,0,.1);display:flex;gap:10px;align-items:center;padding:7px 8px;font-size:11px}.demo-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;width:100%}.demo-form label{font-size:11px;font-weight:700;color:#404850}.demo-form input,.demo-form textarea{display:block;width:100%;margin-top:4px;border:1px solid #d8dde1;padding:9px;background:#fff}.demo-form .wide{grid-column:1/-1}.demo-form button{grid-column:1/-1;border:0;background:#ef2029;color:#fff;padding:11px;font-weight:900}.demo-status{grid-column:1/-1;font-size:11px}.demo-honeypot{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important}.demo-form.compact{grid-template-columns:1fr}.demo-form.compact .wide,.demo-form.compact button,.demo-form.compact .demo-status{grid-column:auto}@media(max-width:640px){.demo-form{grid-template-columns:1fr}.demo-form .wide,.demo-form button,.demo-form .demo-status{grid-column:auto}.auth-userbar{position:static;justify-content:space-between}}\n"
write('src/index.css', css)

print('Repair overlay applied successfully.')

# --- second-pass privacy/security and product integrity ---
idx = read('backend/index.ts')
idx = idx.replace("async function refreshAllSources(){return Promise.all(LIVE_SOURCES.map(runSource))}", "async function refreshAllSources(){const states:SourceState[]=[];for(let i=0;i<LIVE_SOURCES.length;i+=6){states.push(...await Promise.all(LIVE_SOURCES.slice(i,i+6).map(runSource)))}return states}")
if "async function buildPublicSummary(" not in idx:
    marker = "export const handler=router({\n'GET /api/_healthcheck'"
    helper = "async function buildPublicSummary(){const s=await listBounded<SourceState>('source_states',{pageSize:100,maxItems:500});const o=await listBounded<Opportunity>('opportunities',{pageSize:250,maxItems:750});const liveKeys=new Set(LIVE_SOURCES.map(x=>x.key));const states=s.items.filter(x=>liveKeys.has(x.sourceKey));const success=states.filter(x=>x.status==='SUCCESS').length;const counts:Record<string,number>={WA:0,QLD:0,NSW:0,VIC:0,SA:0,NT:0,TAS:0,ACT:0};const unique=new Set<string>();let prioritySignals=0;for(const item of o.items){unique.add(text(item.project).toLowerCase()+'|'+text(item.location).toLowerCase());if(item.stage==='PREPARE')prioritySignals+=1;const upper=String(item.location||'').toUpperCase();for(const code of Object.keys(counts)){const re=new RegExp('(?:^|[\\s,()\\-])'+code+'(?=$|[\\s,()\\-])');if(re.test(upper)){counts[code]+=1;break}}}return {metrics:{active:unique.size,eventSignals:o.items.length,highPriority:prioritySignals,callNow:0},sources:{active:success,configured:LIVE_SOURCES.length},coverage:success+'/'+LIVE_SOURCES.length+' sources successful in latest stored state',regionalCounts:counts,universe:{loaded:o.items.length,truncated:o.truncated,pagesRead:o.pagesRead}}}\n\nexport const handler=router({\n'GET /api/_healthcheck'"
    idx = replace_once(idx, marker, helper, 'public summary helper')
idx = idx.replace("'GET /api/dashboard':[async()=>json(await buildDashboardV2())],", "'GET /api/public/summary':[async()=>json(await buildPublicSummary())],\n'GET /api/dashboard':[requireAuth(),async()=>json(await buildDashboardV2())],")
write('backend/index.ts', idx)

# Calibration resolves canonical id first, then name for legacy records.
intel = read('backend/intelligence.ts')
intel = intel.replace("export type PilotCalibrationOutcome = {\n  project: string;", "export type PilotCalibrationOutcome = {\n  projectId?: string;\n  project: string;")
intel = intel.replace("  const projectByKey = new Map(projects.map(project => [normaliseKey(project.name), project]));", "  const projectById = new Map(projects.map(project => [project.id, project]));\n  const projectByKey = new Map(projects.map(project => [normaliseKey(project.name), project]));")
intel = intel.replace("    const project = projectByKey.get(normaliseKey(outcome.project));", "    const project = (outcome.projectId ? projectById.get(outcome.projectId) : undefined) || projectByKey.get(normaliseKey(outcome.project));")
write('backend/intelligence.ts', intel)

commercial = read('backend/commercial-intelligence.ts')
commercial = commercial.replace("  const resolveProject = (outcome: CommercialOutcome) => outcome.projectId ? projectById.get(outcome.projectId) : projectByName.get(normalise(outcome.project));", "  const resolveProject = (outcome: CommercialOutcome) => (outcome.projectId ? projectById.get(outcome.projectId) : undefined) || projectByName.get(normalise(outcome.project));")
write('backend/commercial-intelligence.ts', commercial)

# Public marketing gets aggregate-only API; project-level data stays behind auth.
lp = read('src/LandingPage.tsx')
lp = lp.replace("  projects?: Array<{ id: string; name: string; location: string; stageLabel: string; bdmPriority: number }>;", "  regionalCounts?: Record<string, number>;\n  universe?: { loaded?: number; truncated?: boolean };")
lp = lp.replace("api.get('/api/dashboard').then(response => {", "api.get('/api/public/summary').then(response => {")
lp = lp.replace("    projects: dashboard?.projects?.length || 0,", "    projects: dashboard?.metrics?.active || 0,")
# Remove project-level public preview state if still present.
lp = re.sub(r"\n  const topProject = dashboard\?\.projects\?\.\[0\];", "", lp)
lp = re.sub(r"\n  const regionCount = \(code: string\) => \(dashboard\?\.projects \|\| \[\]\)\.filter\(.*?\)\.length;", "\n  const regionCount = (code: string) => dashboard?.regionalCounts?.[code] || 0;", lp)
lp = lp.replace("<div className='hi2-project-card'><span>NEW PROJECT SIGNAL</span><b>{topProject?.name || 'Priority project signal'}</b><small>{topProject ? `${topProject.location} · ${topProject.stageLabel}` : 'Evidence-linked project intelligence'}</small></div>", "<div className='hi2-project-card'><span>CURRENT INTELLIGENCE</span><b>{stats.high || '—'} high-priority projects</b><small>{stats.events || '—'} current evidence-derived signals · sign in for project detail</small></div>")
lp = lp.replace("function PublicPageView({ page, stats, projects, onExplore, onDemo }: { page: Exclude<PublicPage, 'home'>; stats: PublicStats; projects: PublicProject[]; onExplore: () => void; onDemo: () => void }) {", "function PublicPageView({ page, stats, onExplore, onDemo }: { page: Exclude<PublicPage, 'home'>; stats: PublicStats; onExplore: () => void; onDemo: () => void }) {")
# Replace public project list with a secure-detail disclosure.
pattern = re.compile(r"\s*\{page === 'insights' && <section className='hi2-public-projects'>.*?</section>\}\n", re.S)
lp = pattern.sub("\n    {page === 'insights' && <section className='hi2-public-projects'><div className='hi2-public-section-head'><div className='hi2-eyebrow'>SECURE DETAIL</div><h2>Project-level intelligence is available after sign-in.</h2><p>Public pages show aggregate coverage only. Canonical projects, organisations, map drill-downs, CRM and evidence provenance are protected inside the operational workspace.</p></div></section>}\n", lp)
lp = lp.replace("<PublicPageView page={publicPage} stats={stats} projects={dashboard?.projects || []} onExplore={onExplore} onDemo={() => setDemoOpen(true)}/>", "<PublicPageView page={publicPage} stats={stats} onExplore={onExplore} onDemo={() => setDemoOpen(true)}/>")
write('src/LandingPage.tsx', lp)

# Server-backed report history plus a real visible current report preview.
fa = read('src/FunctionalApp.tsx')
load_anchor = "  useEffect(() => {\n    void load();\n  }, []);"
if load_anchor in fa:
    fa = fa.replace(load_anchor, "  useEffect(() => {\n    void load();\n    api.get('/api/reports/history').then(response => {\n      const rows = Array.isArray(response.data) ? response.data : [];\n      setReports(rows.map((row: any) => ({ id: row.id, at: row.generatedAt, summary: row.headline, filename: row.filename })));\n    }).catch(() => {});\n  }, []);")
fa = fa.replace("    localStorage.setItem('hirer-reports', JSON.stringify(next));", "    localStorage.setItem('hirer-reports', JSON.stringify(next));\n    void api.post('/api/reports/history', { generatedAt: summary.generatedAt, headline: summary.headline, filename, projectCount: summary.projectCount, opportunityCount: summary.opportunityCount }).catch(() => {});")
fa = fa.replace("Executive report preview generated from the current evidence set.", "Current report snapshot saved from the visible evidence set.")
fa = fa.replace("<div><button type='button' onClick={generateReport}><FileText size={15}/>Generate preview</button><button type='button' className='primary' onClick={downloadReport}><Download size={15}/>Download PDF</button></div>", "<div><button type='button' onClick={generateReport}><FileText size={15}/>Save report snapshot</button><button type='button' className='primary' onClick={downloadReport}><Download size={15}/>Download PDF</button></div>")
report_anchor = "    </section>\n    <div className='hi-kpi-grid hi-kpi-grid-6'>"
if report_anchor in fa:
    fa = fa.replace(report_anchor, "    </section>\n    <section className='hi-card hi-report-preview'><CardHeader title='Current Report Preview' subtitle={summary.headline}/><div className='hi-governance-note'><FileText size={15}/><span><b>Decision view:</b> {summary.highPriorityCount} high-priority projects · {dashboard.metrics?.callNow || 0} CALL NOW · source health {summary.liveFeeds} · {dashboard.universe?.truncated ? 'bounded data window disclosed' : 'current bounded window complete'}.</span></div></section>\n    <div className='hi-kpi-grid hi-kpi-grid-6'>", 1)
write('src/FunctionalApp.tsx', fa)

print('Second-pass privacy and integrity repairs applied.')


# --- tenant isolation and cron-only source mutation ---
idx = read('backend/index.ts')
idx = idx.replace("async function buildDashboardV2(){", "async function buildDashboardV2(userId:string){")
idx = idx.replace("const p=await listBounded<PilotOutcome>('pilot_outcomes',{pageSize:250,maxItems:1000});", "const p=await listBounded<PilotOutcome>(`pilot_outcomes:${userId}`,{pageSize:250,maxItems:1000});")
idx = idx.replace("'GET /api/dashboard':[requireAuth(),async()=>json(await buildDashboardV2())],", "'GET /api/dashboard':[requireAuth(),async(ctx)=>json(await buildDashboardV2(ctx.user!.userId))],")
idx = idx.replace("'POST /api/sources/refresh':[requireAuth(),async()=>json({sources:await refreshAllSources()})],\n'GET /api/backfill/status':[requireAuth(),async()=>json(await getBackfillStatus(BACKFILL_SOURCES))],\n'POST /api/backfill/run':[requireAuth(),async()=>json(await runBackfillBatch(BACKFILL_SOURCES))],\n", "")
idx = idx.replace("'GET /api/pilot/outcomes':[requireAuth(),async()=>json((await listBounded<PilotOutcome>('pilot_outcomes',{pageSize:250,maxItems:1000})).items)],", "'GET /api/pilot/outcomes':[requireAuth(),async(ctx)=>json((await listBounded<PilotOutcome>(`pilot_outcomes:${ctx.user!.userId}`,{pageSize:250,maxItems:1000})).items)],")
idx = idx.replace("const [id]=await db.add('pilot_outcomes',[{...row}]);", "const [id]=await db.add(`pilot_outcomes:${ctx.user!.userId}`,[{...row}]);")
idx = idx.replace("metrics:pilotMetrics((await listBounded<PilotOutcome>('pilot_outcomes',{pageSize:250,maxItems:1000})).items)", "metrics:pilotMetrics((await listBounded<PilotOutcome>(`pilot_outcomes:${ctx.user!.userId}`,{pageSize:250,maxItems:1000})).items)")
idx = idx.replace("'POST /api/pilot/outcomes':[requireAuth(),async({body})=>{", "'POST /api/pilot/outcomes':[requireAuth(),async(ctx)=>{const body=ctx.body;")
write('backend/index.ts', idx)

fa = read('src/FunctionalApp.tsx')
fa = fa.replace("  RefreshCw,\n", "")
fa = fa.replace("  const [refreshing, setRefreshing] = useState(false);\n", "")
fa = re.sub(r"\n  const refresh = async \(\) => \{.*?\n  \};\n", "\n", fa, flags=re.S)
fa = re.sub(r"\n  const runBackfill = async \(\) => \{.*?\n  \};\n", "\n", fa, flags=re.S)
fa = re.sub(r"\n        <button className='hi-refresh'.*?</button>", "", fa, flags=re.S)
fa = fa.replace("{view === 'Source Admin' && <SourceAdminPage dashboard={dashboard} runBackfill={runBackfill}/>} ", "{view === 'Source Admin' && <SourceAdminPage dashboard={dashboard}/>} ")
fa = fa.replace("function SourceAdminPage({ dashboard, runBackfill }: { dashboard: Dashboard; runBackfill: () => void }) {", "function SourceAdminPage({ dashboard }: { dashboard: Dashboard }) {")
fa = re.sub(r"\n\s*<button type='button' className='hi-action-button' onClick=\{\(\) => void runBackfill\(\)\}>Run backfill batch</button>", "", fa)
write('src/FunctionalApp.tsx', fa)

print('Tenant isolation and cron-only source mutation applied.')

write('tests/tests.txt', (Path(__file__).resolve().parents[1] / 'tests/tests.txt.replacement').read_text())
print('Acceptance suite updated.')


# --- stable canonical identity migration and type completeness ---
intel = read('backend/intelligence.ts')
intel = intel.replace("    const previous = snapshotByKey.get(projectKey);", "    const aliases=[...new Set(projectRecords.map(record=>normaliseKey(record.project)).filter(Boolean))];\n    const previous=snapshotByKey.get(projectKey)||aliases.map(alias=>snapshotByKey.get(alias)).find((item):item is StageSnapshot & {id:string}=>Boolean(item));\n    const stableProjectKey=previous?.projectKey||projectKey;")
intel = intel.replace("    const nextSnapshot: StageSnapshot = { projectKey, stageLabel: currentStage.label,", "    const nextSnapshot: StageSnapshot = { projectKey: stableProjectKey, stageLabel: currentStage.label,")
intel = intel.replace("    projects.push({ id: projectKey, name: lead.project,", "    projects.push({ id: stableProjectKey, name: lead.project,")
write('backend/intelligence.ts', intel)

fa = read('src/FunctionalApp.tsx')
fa = fa.replace("  coverage: string;\n};", "  coverage: string;\n  universe?: { loaded?: number; truncated?: boolean; pagesRead?: number; outcomesLoaded?: number; outcomesTruncated?: boolean };\n};")
write('src/FunctionalApp.tsx', fa)

lp = read('src/LandingPage.tsx')
lp = re.sub(r"\ntype PublicProject = \{.*?\};\n", "\n", lp, flags=re.S)
write('src/LandingPage.tsx', lp)

print('Stable identity migration and frontend type completeness applied.')

# --- semantic accuracy pass ---
lp = read('src/LandingPage.tsx')
lp = lp.replace("Track planned shutdowns and major maintenance across mining, energy and industrial sites.", "Surface published shutdown, outage and maintenance signals across mining, energy and industrial evidence sources.")
lp = lp.replace("See which contractors are active, where they’re working and what they’re likely to need.", "See evidence-backed delivery organisations, where work is appearing and what equipment classes may be relevant.")
lp = lp.replace("<small>Live Feeds</small>", "<small>Current Feeds</small>")
lp = lp.replace("High-Priority Projects", "Priority-Stage Signals")
lp = lp.replace("high-priority projects", "priority-stage signals")
lp = lp.replace("<span>Canonical projects<br/>currently tracked</span>", "<span>Project signals<br/>in current public window</span>")
lp = lp.replace("<span>Canonical projects</span>", "<span>Project signals</span>")
write('src/LandingPage.tsx', lp)

fa = read('src/FunctionalApp.tsx')
fa = fa.replace("<small>DEMAND INDEX {item.demandIndex}</small>", "<small>HEURISTIC DEMAND INDEX {item.demandIndex}</small>")
fa = fa.replace("<small>INDEX {item.demandIndex}</small>", "<small>HEURISTIC INDEX {item.demandIndex}</small>")
fa = fa.replace("{project.equipmentPrediction.confidenceBand} confidence · {project.equipmentPrediction.confidence}% · {project.equipmentPrediction.reason}", "{project.equipmentPrediction.confidenceBand} heuristic confidence · {project.equipmentPrediction.confidence}% · {project.equipmentPrediction.reason}")
# Visible disclosure when bounded current dataset is truncated.
head_anchor = "      {message && <div className='hi-message'>{message}</div>}"
if head_anchor in fa:
    fa = fa.replace(head_anchor, head_anchor + "\n      {dashboard.universe?.truncated && <div className='hi-message'>Data window disclosure: {dashboard.universe.loaded || 0} current records are loaded in this bounded view and additional stored records exist. Rankings and counts on this screen apply to the loaded window.</div>}")
write('src/FunctionalApp.tsx', fa)

print('Semantic accuracy pass applied.')
