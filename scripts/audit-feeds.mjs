import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import ts from 'typescript';
import xlsx from 'xlsx';

// Read-only external audit. Never imports SDK, executes handlers, or writes ingestion data.
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'docs', 'audit');
const startedAt = new Date().toISOString();
class AuditDate extends Date { constructor(...args) { if(args.length) super(...args); else super(startedAt); } static now() { return Date.parse(startedAt); } }
const sampleLimit = 5;
const concurrency = Math.max(1, Math.min(3, Number(process.argv.find(a=>a.startsWith('--concurrency='))?.split('=')[1] || 3)));
const requestTimeoutMs = 18000;
const maxBodyBytes = 25 * 1024 * 1024;
const indexText = fs.readFileSync(path.join(root, 'backend/index.ts'), 'utf8');
const backfillText = fs.readFileSync(path.join(root, 'backend/backfill-fetch.ts'), 'utf8');
const helperText = fs.readFileSync(path.join(root, 'backend/source-helpers.ts'), 'utf8');
const recoveryText = fs.readFileSync(path.join(root, 'backend/feed-recovery.ts'), 'utf8');
const domainText = fs.readFileSync(path.join(root, 'backend/domain-hardening.ts'), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const stripImports = text => {
  const sourceFile=ts.createSourceFile('audit.ts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const spans=sourceFile.statements.filter(node=>ts.isImportDeclaration(node)).map(node=>[node.getStart(sourceFile),node.end]);
  for(const [start,end] of spans.reverse())text=text.slice(0,start)+text.slice(end);
  return text;
};
const domainCode = compile(domainText);
const helperCode = compile(stripImports(helperText));
const recoveryCode = compile(stripImports(recoveryText));
let liveCode = indexText.slice(0, indexText.indexOf('async function upsertState'));
liveCode = stripImports(liveCode).replace(/const\s+opportunities\s*=\s*rows\s*\.filter/, 'globalThis.__rawRows=rows;const opportunities=rows.filter');
liveCode += '\nglobalThis.liveAudit={SOURCES,HISTORICAL_SOURCES,collect};';
liveCode = compile(liveCode);
const historicalCode = compile(stripImports(backfillText));
const metadata = [];
function normalizeRequest(url) {
  const u = new URL(url);
  for (const key of ['limit','resultRecordCount','count','maxFeatures']) if (u.searchParams.has(key)) u.searchParams.set(key, String(sampleLimit));
  for (const key of ['offset','startIndex','resultOffset']) if (u.searchParams.get(key) === '0') u.searchParams.delete(key);
  // Reuse one audit clock for the equivalent live and historical current-window OCDS requests.
  if (u.pathname.includes('/ocds/findByDates/')) {
    const prefix = u.pathname.split('/').slice(0, 4).join('/');
    const end = new Date(startedAt); const start = new Date(end.getTime() - 7 * 86400000);
    u.pathname = prefix + '/' + start.toISOString().replace(/\.\d{3}Z$/, 'Z') + '/' + end.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  u.searchParams.sort();
  return u.toString();
}
function responseShape(buffer, contentType) {
  const result = { bytes: buffer.length, contentType };
  if (/json/i.test(contentType) || buffer[0] === 123 || buffer[0] === 91) {
    try {
      const b = JSON.parse(buffer.toString('utf8'));
      result.topLevelKeys = Object.keys(b).slice(0, 25);
      const records = b.features || b.results || b.result?.records || b.releases || b.records;
      if (Array.isArray(records)) { result.responseRows = records.length; result.sampleFieldNames = Object.keys(records[0]?.attributes || records[0]?.properties || records[0] || {}); }
      result.total = b.total_count ?? b.result?.total ?? b.numberMatched ?? b.totalFeatures ?? undefined;
      if (b.error) result.apiError = b.error;
      if (b.result?.resources) result.resources = b.result.resources.map(r=>({id:r.id,name:r.name,format:r.format,url:r.url,datastoreActive:r.datastore_active,created:r.created,lastModified:r.last_modified}));
      if (b.result?.metadata_modified) result.metadataModified = b.result.metadata_modified;
    } catch { result.jsonParseError = true; }
  } else if (/xml|text|html/i.test(contentType)) {
    const text = buffer.toString('utf8');
    result.featureTypes = [...text.matchAll(/<(?:\w+:)?FeatureType>([\s\S]*?)<\/(?:\w+:)?FeatureType>/gi)].map(m=>m[1].match(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/i)?.[1]);
    result.xmlException = text.match(/<(?:\w+:)?(?:ExceptionText|ServiceException)[^>]*>([\s\S]*?)<\//i)?.[1]?.replace(/<[^>]+>/g,' ').slice(0,500);
    result.looksLikeHtml = /<!doctype html|<html/i.test(text);
  }
  return result;
}
function makeContext(fetcher) {
  const domain = { exports: {}, Date: AuditDate, Set, Map, console }; vm.runInNewContext(domainCode, domain);
  const recovery = { exports: {}, Buffer, Uint8Array, TextDecoder, createHash: crypto.createHash, inflateRawSync };
  vm.runInNewContext(recoveryCode, recovery);
  const helperContext = { ...recovery.exports, exports: {}, createHash:crypto.createHash, fetch: fetcher, URL, AbortController, setTimeout, clearTimeout, Date: AuditDate, TextDecoder, Uint8Array, read: xlsx.read, utils: xlsx.utils };
  vm.runInNewContext(helperCode, helperContext);
  const context = vm.createContext({ ...recovery.exports, ...helperContext.exports, exports: {}, fetch: fetcher, URL, AbortController, AbortSignal, setTimeout, clearTimeout, Date: AuditDate, console, read: xlsx.read, utils: xlsx.utils, ...domain.exports });
  vm.runInContext(liveCode, context);
  const live = context.liveAudit;
  context.exports = {};
  // Isolate lexical declarations in backfill file from those in live module.
  vm.runInContext('(function(){' + historicalCode + '\n globalThis.historicalAudit=exports;})()', context);
  return { context, live, historical: context.historicalAudit };
}
const registry = makeContext(()=>{throw new Error('Registry load must not fetch');}).live;
const sources = [...registry.SOURCES.map(s=>({...s, mode:s.enabled===false?'disabled':'active'})), ...registry.HISTORICAL_SOURCES.map(s=>({...s,mode:'historical-only'}))];
const wanted = process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
const selected = wanted ? sources.filter(s=>wanted.includes(s.key)) : sources;
async function probe(source) {
  const requests = []; const cache = new Map();
  const fetcher = async (input, init={}) => {
    const url = normalizeRequest(String(input));
    if (cache.has(url)) return cache.get(url).clone();
    const start = Date.now(); const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), requestTimeoutMs);
    const item = { url, startedAt:new Date().toISOString() }; requests.push(item);
    try {
      const response = await fetch(url, { ...init, method:'GET', redirect:'follow', signal:controller.signal });
      Object.assign(item, { status:response.status, finalUrl:response.url, redirected:response.redirected });
      const chunks = []; let length = 0;
      if (response.body) for await (const chunk of response.body) { length+=chunk.length; if (length > maxBodyBytes) { controller.abort(); throw new Error('AUDIT_BODY_LIMIT'); } chunks.push(chunk); }
      const bytes=Buffer.concat(chunks);
      Object.assign(item,responseShape(bytes,response.headers.get('content-type')||''));
      const result = new Response(bytes, { status:response.status, statusText:response.statusText, headers:response.headers });
      cache.set(url,result); return result.clone();
    } catch(e) { item.error=e.name==='AbortError'?'AUDIT_TIMEOUT_18000MS':(e.cause?.code || e.message); throw new Error(item.error); }
    finally {clearTimeout(timer);item.durationMs=Date.now()-start;}
  };
  const {context,live,historical}=makeContext(fetcher);
  const result={key:source.key,name:source.name,mode:source.mode,method:source.method,endpoint:source.endpoint,provenance:source.provenance,disableReason:source.disableReason,startedAt:new Date().toISOString(),live:{},backfill:{},requests};
  try {
    const data=await live.collect(source);const rows=context.__rawRows||[];const opportunities=data.opportunities||[];
    const roles={};opportunities.forEach(o=>{roles[o.organisationRole||'UNKNOWN']=(roles[o.organisationRole||'UNKNOWN']||0)+1});
    const dates=opportunities.map(o=>o.sourceObservedAt).filter(Boolean).sort();
    result.live={status:!rows.length?'EMPTY':!opportunities.length?'METADATA_ONLY':'ROWS',recordsFetched:data.recordsFetched,usableRows:opportunities.length,metadataOnlyRows:rows.filter(r=>r.metadataOnly).length,rawFieldNames:Object.keys(rows[0]?.raw||{}),roles,datedRows:dates.length,oldestSourceDate:dates[0]||null,newestSourceDate:dates.at(-1)||null,uniqueIds:new Set(rows.map(r=>r.externalId)).size,normalizedProjectIsExternalId:opportunities.filter(o=>o.project===o.externalId).length};
  } catch(e) {result.live={status:'ERROR',error:e.message};}
  try {
    const page=await historical.collectBackfillPage(source,0);
    const evidence=page.rows.map(row=>historical.normalizeEvidence(source,row,startedAt));
    result.backfill={status:page.rows.length?'ROWS':'EMPTY',rows:page.rows.length,next:page.next,completed:page.completed,hasNextPage:Boolean(page.nextUrl),anchorAt:page.context?.anchorAt,resourceId:page.context?.ckanResource?.id,rawFieldNames:Object.keys(page.rows[0]?.raw||{}),datedRows:evidence.filter(e=>e.sourceObservedAt).length,roles:[...new Set(evidence.map(e=>e.organisationRole))]};
    if (source.method === 'OCDS' && page.nextUrl) { const second=await historical.collectBackfillPage(source,page.next,page.nextUrl,page.context); result.backfill.nextPageProbe={status:second.rows.length?'ROWS':'EMPTY',rows:second.rows.length,overlapIds:second.rows.filter(row=>page.rows.some(first=>first.externalId===row.externalId)).length,hasNextPage:Boolean(second.nextUrl),next:second.next}; }
  } catch(e) {result.backfill={status:'ERROR',error:e.message};}
  result.endpointStatus=requests.some(r=>r.status>=200&&r.status<300)?'REACHABLE':requests.some(r=>r.status)?'HTTP_ERROR':'NETWORK_ERROR';
  result.deployedIngestion='NOT_TESTED_LOCAL_READ_ONLY';
  metadata.push(result);console.log(JSON.stringify({key:result.key,mode:result.mode,live:result.live.status,rows:result.live.usableRows,backfill:result.backfill.status,error:result.live.error,requests:requests.length}));
}
let cursor=0;
await Promise.all(Array.from({length:Math.min(concurrency,selected.length)},async()=>{while(cursor<selected.length){const source=selected[cursor++];await probe(source);}}));
metadata.sort((a,b)=>sources.findIndex(s=>s.key===a.key)-sources.findIndex(s=>s.key===b.key));
const timestamp=startedAt.replace(/[:.]/g,'-');
const report={startedAt,finishedAt:new Date().toISOString(),methodology:{readOnly:true,auditClock:startedAt,concurrency,sampleLimit,requestTimeoutMs,maxBodyBytes,redirects:'follow',parser:'Actual TypeScript collector and backfill code evaluated without SDK handlers; query row limits reduced to five; XLSX bodies bounded by bytes/time. Cursor completion is not meaningful after sample limit reduction.',scope:'All registry sources, including disabled and historical-only; external read access and parser validity only. No deployed ingestion asserted.'},codeHashes:{index:hash(indexText),backfillFetch:hash(backfillText),domainHardening:hash(domainText),sourceHelpers:hash(helperText),feedRecovery:hash(recoveryText)},counts:{configured:registry.SOURCES.length,active:registry.SOURCES.filter(s=>s.enabled!==false).length,disabled:registry.SOURCES.filter(s=>s.enabled===false).length,historicalOnly:registry.HISTORICAL_SOURCES.length,probed:metadata.length,liveRows:metadata.filter(r=>r.live.status==='ROWS').length,liveErrors:metadata.filter(r=>r.live.status==='ERROR').length,liveEmpty:metadata.filter(r=>r.live.status==='EMPTY').length,metadataOnly:metadata.filter(r=>r.live.status==='METADATA_ONLY').length},results:metadata};
fs.mkdirSync(outDir,{recursive:true});
const basename=`FEED_AUDIT_${timestamp}`;
fs.writeFileSync(path.join(outDir,basename+'.json'),JSON.stringify(report,null,2)+'\n');
const cell=s=>String(s??'').replace(/\|/g,'/').replace(/[\r\n]+/g,' ');
const lines=[`# Feed audit — ${startedAt}`,'',`Configured: ${report.counts.configured}; active: ${report.counts.active}; disabled: ${report.counts.disabled}; historical only: ${report.counts.historicalOnly}; probed: ${metadata.length}.`,'',`Read-only external requests. Actual collectors were exercised with five-row query limits, ${concurrency} concurrent source probes and an 18-second full-body timeout. XLSX parsing needs the workbook and can return up to the collector limit. This does not verify deployed ingestion, authentication or scheduler execution. Backfill completion flags from this reduced sample do not establish complete historical coverage. AusTender additionally verifies the next provider page when advertised. Raw personal data is not stored.`,'','| Source | Mode | Method | Endpoint | Live parser / rows | Historical parser / rows | Source dates | HTTP / reason |','|---|---|---|---|---|---|---|---|'];
for(const r of metadata) lines.push(`| ${r.key} | ${r.mode} | ${r.method} | [Endpoint](${r.endpoint}) | ${r.live.status} / ${r.live.usableRows??0} | ${r.backfill.status} / ${r.backfill.rows??0} | ${cell(r.live.newestSourceDate||'Unestablished')} | ${cell(r.live.error||r.requests.map(q=>q.status||q.error).join(', '))} |`);
lines.push('','## Interpretation','','- ROWS confirms the parser emitted records; domain fit, event freshness and complete coverage still need review.','- METADATA_ONLY is a catalogue response without project rows and must not count as a working opportunity feed.','- EMPTY can be legitimate, but is not evidence of an active supply of usable records.','- A disabled source stays disabled regardless of local accessibility until its full ingestion path is approved and verified.','- The JSON includes request URLs, response shapes, field names, source-date coverage and parser results for reproduction.');
fs.writeFileSync(path.join(outDir,basename+'.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({saved:basename,counts:report.counts}));
