import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
const root=path.resolve(import.meta.dirname,'..');
const audit=JSON.parse(fs.readFileSync(path.join(root,'docs/audit/FEED_AUDIT_2026-09-16T01-13-57-411Z.json'),'utf8'));
const results=[];
async function get(label,url,kind='text') {
  if(process.argv.includes('--retry-core') && !['SA mining capabilities','NSW capabilities','aemo-generation-information','aemo-key-connection-information','QLD granted newest August XLSX'].includes(label))return;
  const at=new Date().toISOString();const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),18000);let detail={label,url,at};
  try {const r=await fetch(url,{redirect:'follow',signal:ctl.signal,headers:{'user-agent':'HirerIntelligence/1.0 public-open-data-client'}});const b=Buffer.from(await r.arrayBuffer());detail={...detail,status:r.status,finalUrl:r.url,bytes:b.length,contentType:r.headers.get('content-type')};
    if(kind==='xlsx' && b[0]===80 && b[1]===75) {const book=xlsx.read(b,{type:'buffer'});detail.sheets=book.SheetNames.map(name=>{const rows=xlsx.utils.sheet_to_json(book.Sheets[name],{header:1,defval:''});const headers=[];for(let i=0;i<Math.min(40,rows.length);i++){const cells=rows[i].map(v=>String(v));if(cells.filter(Boolean).length>=4||/glossary|definitions/i.test(name)){headers.push({row:i+1,cells:cells.map(v=>v.slice(0,130))});if(headers.length>=3)break;}}return{name,rowCount:rows.length,headers};});}
    else if(kind==='xml') {const t=b.toString();detail.first500=t.slice(0,500);const types=[...t.matchAll(/<(?:\w+:)?FeatureType\b[^>]*>([\s\S]*?)<\/(?:\w+:)?FeatureType>/gi)];detail.featureTypeCount=types.length;detail.types=types.map(m=>({openingTag:m[0].slice(0,m[0].indexOf('>')+1),name:m[1].match(/<(?:\w+:)?Name\b[^>]*>([^<]+)<\//i)?.[1],title:m[1].match(/<(?:\w+:)?Title\b[^>]*>([^<]+)<\//i)?.[1]}));}
    else if(kind==='json') {const data=JSON.parse(b.toString());const rows=data.result?.records||data.features||data.results||[];detail.total=data.result?.total??data.total_count??data.numberMatched;detail.fields=Object.keys(rows[0]?.properties||rows[0]?.attributes||rows[0]||{});detail.dates=rows.slice(0,5).map(row=>Object.fromEntries(Object.entries(row.properties||row.attributes||row).filter(([k,v])=>/date|updated|time|issued|lodged/i.test(k)&&/^(\d{4}-|\d{1,2}[/.-]\d{1,2}[/.-]|\d{10,13}$|\d{5}$)/.test(String(v)))));detail.resourceMetadata=data.result?.resources?.map(r=>({id:r.id,name:r.name,url:r.url,format:r.format,created:r.created,lastModified:r.last_modified,datastoreActive:r.datastore_active}));}
    else detail.first500=b.toString().slice(0,500);
  }catch(e){detail.error=e.message;detail.cause=e.cause?.code;}finally{clearTimeout(timer);}results.push(detail);console.log(JSON.stringify(detail));
}
const lookup=k=>audit.results.find(r=>r.key===k);
await get('SA mining capabilities',lookup('sa-mining-projects').endpoint+'?service=WFS&version=1.1.0&request=GetCapabilities','xml');
await get('NSW capabilities','https://public-gs.geoscience.nsw.gov.au/geoserver/ows?service=WFS&version=2.0.0&request=GetCapabilities','xml');
for(const key of ['aemo-generation-information','aemo-key-connection-information']) await get(key,lookup(key).endpoint,'xlsx');
const grant=lookup('qld-granted-resource-authorities').requests[0].resources;
await get('QLD granted newest August XLSX',grant[0].url,'xlsx');
await get('QLD granted July datastore','https://www.data.qld.gov.au/api/3/action/datastore_search?resource_id='+grant[1].id+'&limit=5','json');
await get('QLD Stadiums workbook',lookup('qld-stadiums-contracts-jul-dec-2025').requests[0].resources[0].url,'xlsx');
for(const key of ['wa-mining-tenements','qld-environmental-authorities','qld-renewed-resource-authorities','qld-state-development-contracts','vic-current-mining-licences','tas-current-mining-leases','melbourne-building-permits','wa-2d-seismic-surveys','wa-3d-seismic-surveys']) {const r=lookup(key);const req=r.requests.findLast(q=>q.responseRows);if(req)await get('date fields '+key,req.url,'json');}
fs.writeFileSync(path.join(root,'docs/audit/FEED_AUDIT_DETAILS_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'),JSON.stringify({finishedAt:new Date().toISOString(),results},null,2)+'\n');
