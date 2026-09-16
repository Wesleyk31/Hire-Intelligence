import { read, utils, type WorkBook } from 'xlsx';

const text = (value: unknown) => value == null ? '' : String(value).trim();
const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findField(row: Record<string, unknown>, names: string[]): string {
  const entries = Object.entries(row).map(([name, value]) => [key(name), text(value)]);
  for (const name of names) { const hit = entries.find(([field, value]) => field === key(name) && value); if (hit) return hit[1]; }
  for (const name of names.filter(name => key(name).length > 2)) { const hit = entries.find(([field, value]) => field.includes(key(name)) && value); if (hit) return hit[1]; }
  return '';
}

export function recordIdentity(row: Record<string, unknown>): string {
  const entries = new Map(Object.entries(row).map(([name, value]) => [key(name), text(value)]));
  for (const name of ['geninfounitid', 'aemokciid', 'objectid', 'oid', 'gid', 'id', 'recordid', 'tenid', 'tasid', 'titleid', 'titleno', 'permitnumber', 'authoritynumber', 'permitreference', 'contractreferencenumber', 'councilref', 'projectid', 'duid']) {
    const value = entries.get(name); if (value) return value;
  }
  // Positional IDs overwrite unrelated records when a publisher reorders a page.
  const stable = JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
  let hash = 2166136261;
  for (let i = 0; i < stable.length; i++) hash = Math.imul(hash ^ stable.charCodeAt(i), 16777619);
  return 'record-' + (hash >>> 0).toString(16);
}

async function requestBytes(url: string, accept: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept, 'user-agent': 'HirerIntelligence/1.0 public-open-data-client' } });
    if (!response.ok || response.status === 202 || response.status === 204) throw new Error('HTTP_' + response.status);
    const maximum = 25 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('SOURCE_BODY_TOO_LARGE'); }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        total += part.value.byteLength;
        if (total > maximum) { await reader.cancel(); throw new Error('SOURCE_BODY_TOO_LARGE'); }
        chunks.push(part.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { clearTimeout(timer); }
}

export async function sourceJson(url: string): Promise<any> {
  const data = JSON.parse(new TextDecoder().decode(await requestBytes(url, 'application/json')));
  if (!data || typeof data !== 'object') throw new Error('SCHEMA_INVALID');
  return data;
}
export async function sourceText(url: string): Promise<string> {
  return new TextDecoder().decode(await requestBytes(url, 'application/xml,text/xml,text/plain'));
}
export async function sourceWorkbook(url: string): Promise<WorkBook> {
  const bytes = await requestBytes(url, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('XLSX_INVALID_BODY');
  const book = read(bytes, { type: 'array' });
  if (!book.SheetNames.length) throw new Error('XLSX_EMPTY');
  return book;
}

const aemoDateFields = new Set(['surveylatestupdatedate', 'surveylastrequesteddate', 'publicationdate', 'kcidatatnspvalidationdate', 'kcidataconnectionapplicantnotificationdate']);
function workbookValue(name: string, value: unknown): unknown {
  if (aemoDateFields.has(key(name)) && typeof value === 'number' && value >= 1 && value < 100000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString();
  }
  return value;
}

export function projectWorkbookRows(sourceKey: string, book: WorkBook, preserveHistory = false): Record<string, unknown>[] {
  const all: Record<string, unknown>[] = [];
  const generator = sourceKey === 'aemo-generation-information';
  const kci = sourceKey === 'aemo-key-connection-information';
  const sheets = generator ? book.SheetNames.filter(name => name === 'Generator Information') : book.SheetNames.filter(name => !/background|disclaimer|summary|change log|glossary/i.test(name));
  for (const sheet of sheets) {
    const table = utils.sheet_to_json<unknown[]>(book.Sheets[sheet], { header: 1, defval: '' }) as unknown[][];
    const header = table.slice(0, 40).findIndex(row => {
      const names = row.map(value => key(text(value)));
      if (generator) return names.includes('sitename') && names.includes('geninfounitid') && names.includes('commitmentstatus');
      if (kci) return names.includes('sitename') && names.includes('aemokciid');
      return names.some(name => ['project', 'projectname', 'sitename', 'generatorname', 'facilityname'].includes(name)) && names.some(name => ['state', 'region', 'status', 'company', 'owner', 'siteowner'].includes(name));
    });
    if (header < 0) continue;
    const names = table[header].map(value => text(value));
    for (const row of table.slice(header + 1)) {
      const record: Record<string, unknown> = {};
      names.forEach((name, index) => { if (name && text(row[index])) record[name] = generator || kci ? workbookValue(name, row[index]) : row[index]; });
      const title = findField(record, ['Site Name', 'Project Name', 'Project', 'Generator Name', 'Facility Name']);
      if (!title || /^(site name|project name|project)$/i.test(title)) continue;
      if (generator && !findField(record, ['Gen Info Unit ID'])) continue;
      if (kci && !findField(record, ['AEMO KCI ID'])) continue;
      all.push(record);
      if (all.length >= 20000) break;
    }
    if (all.length >= 20000) break;
  }
  if (!all.length) throw new Error('XLSX_PROJECT_ROWS_MISSING');
  if (!kci || preserveHistory) return all;
  // KCI is an update history; promote the newest published version for each ID.
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of all) {
    const id = recordIdentity(row); const prior = latest.get(id);
    const stamp = (item: Record<string, unknown>) => Number(findField(item, ['KCI datafile compilation date time stamp'])) || 0;
    if (!prior || stamp(row) >= stamp(prior)) latest.set(id, row);
  }
  return [...latest.values()];
}

export type CkanResource = { id?: string; url?: string; format?: string; datastore_active?: boolean; created?: string; last_modified?: string };
export async function ckanResourceRows(endpoint: string, limit: number, offset: number, pinnedResource?: CkanResource) {
  let resource = pinnedResource;
  if (!resource) {
  const body = await sourceJson(endpoint);
  if (body.success !== true || !Array.isArray(body.result?.resources)) throw new Error('CKAN_SCHEMA_INVALID');
  const resources = [...body.result.resources].sort((a, b) => {
    const date = (resource: any) => Date.parse(String(resource.created || resource.last_modified || '')) || 0;
    return date(b) - date(a);
  });
  resource = resources.find(item => item.datastore_active === true && item.id || ['XLSX', 'CSV'].includes(String(item.format).toUpperCase()) && item.url);
  }
  if (!resource) return { rows: [] as Array<{ externalId: string; raw: Record<string, unknown> }>, total: 0 };
  const selectedResource: CkanResource = { id: resource.id, url: resource.url, format: resource.format, datastore_active: resource.datastore_active };
  if (resource.datastore_active === true && resource.id) {
    const url = new URL('/api/3/action/datastore_search', endpoint);
    url.searchParams.set('resource_id', resource.id); url.searchParams.set('limit', String(limit)); url.searchParams.set('offset', String(offset));
    const page = await sourceJson(url.toString());
    if (page.success !== true || !Array.isArray(page.result?.records)) throw new Error('CKAN_SCHEMA_INVALID');
    return { rows: page.result.records.map((raw: Record<string, unknown>) => ({ externalId: recordIdentity(raw), raw })), total: Number(page.result.total || 0), resource: selectedResource };
  }
  let book: WorkBook;
  if (String(resource.format).toUpperCase() === 'CSV') {
    const value = await sourceText(String(resource.url));
    if (!value.trim() || /<html|<!doctype/i.test(value)) throw new Error('CSV_INVALID_BODY');
    book = read(value, { type: 'string' });
  } else book = await sourceWorkbook(String(resource.url));
  const sheet = book.SheetNames[0];
  const all = sheet ? utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheet], { defval: '' }) : [];
  return { rows: all.slice(offset, offset + limit).map(raw => ({ externalId: recordIdentity(raw), raw })), total: all.length, resource: selectedResource };
}
