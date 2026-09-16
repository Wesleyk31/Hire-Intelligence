export type OrganisationRole = 'DELIVERY_CONTRACTOR' | 'OWNER_PROPONENT' | 'APPLICANT_HOLDER' | 'SUPPLIER' | 'OPERATOR' | 'UNKNOWN';

export type EvidenceLike = {
  sourceKey: string;
  externalId: string;
  project: string;
  location: string;
  company?: string;
  description?: string;
  observedAt?: string;
  sourceObservedAt?: string;
  organisationRole?: OrganisationRole;
};

export type StageSignalLike<TStage extends string = string> = {
  label: TStage;
  confidence: number;
  reliability: number;
  observedAt: string;
};

export type OutcomeLike = {
  projectId?: string;
  project: string;
  result: 'CONTACTED' | 'REQUIREMENT_CONFIRMED' | 'QUOTED' | 'WON' | 'LOST' | 'FALSE_POSITIVE';
  quoteValue?: number | null;
  wonValue?: number | null;
  advanceDays?: number | null;
  recordedAt?: string;
  qa: boolean;
};

const STOP_WORDS = new Set([
  'project', 'projects', 'development', 'developments', 'works', 'work', 'stage', 'phase', 'package', 'contract', 'permit',
  'approval', 'application', 'authority', 'roadworks', 'roadwork', 'mine', 'mining', 'the', 'and', 'for', 'of', 'at', 'in', 'to',
  'pty', 'ltd', 'limited', 'australia', 'australian'
]);

export const normalise = (value: string) => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

const meaningfulTokens = (value: string) => normalise(value)
  .split(' ')
  .filter(token => token.length > 2 && !STOP_WORDS.has(token));

const locationKey = (location: string) => {
  const value = normalise(location);
  const codes = ['wa', 'qld', 'nsw', 'vic', 'sa', 'nt', 'tas', 'act'];
  const code = codes.find(item => new RegExp(`(?:^| )${item}(?: |$)`).test(value));
  if (code) return code;
  return value.split(' ').filter(Boolean).slice(0, 3).join('-') || 'unknown';
};

const jaccard = (left: string[], right: string[]) => {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter(item => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
};

export function groupCanonicalEvidence<T extends EvidenceLike>(records: T[]): Map<string, T[]> {
  type Group = { key: string; location: string; tokens: string[]; rows: T[] };
  const groups: Group[] = [];
  for (const record of records) {
    const tokens = meaningfulTokens(record.project);
    const loc = locationKey(record.location);
    if (tokens.length < 2) {
      const key = `${record.sourceKey}:${record.externalId}`;
      groups.push({ key, location: loc, tokens, rows: [record] });
      continue;
    }
    let best: Group | undefined;
    let bestScore = 0;
    for (const group of groups) {
      if (group.location !== loc || group.tokens.length < 2) continue;
      const score = jaccard(tokens, group.tokens);
      const intersection = tokens.filter(token => group.tokens.includes(token)).length;
      const overlap = intersection / Math.max(1, Math.min(tokens.length, group.tokens.length));
      const combined = Math.max(score, overlap);
      if (combined > bestScore) {
        best = group;
        bestScore = combined;
      }
    }
    if (best && bestScore >= 0.8) {
      best.rows.push(record);
      best.tokens = [...new Set([...best.tokens, ...tokens])];
      continue;
    }
    const fingerprint = [...new Set(tokens)].sort().slice(0, 7).join('-');
    groups.push({ key: `${loc}:${fingerprint}`, location: loc, tokens, rows: [record] });
  }
  return new Map(groups.map(group => [group.key, group.rows]));
}

const parseTimestamp = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function evidenceTimestamp(record: EvidenceLike): number {
  return parseTimestamp(record.sourceObservedAt) || parseTimestamp(record.observedAt);
}

export function chooseCurrentStage<TStage extends string>(
  signals: StageSignalLike<TStage>[],
  rank: Record<TStage, number>,
  recentWindowDays = 45
): StageSignalLike<TStage> {
  if (!signals.length) throw new Error('No stage signals supplied');
  const newest = Math.max(...signals.map(signal => parseTimestamp(signal.observedAt)));
  if (!newest) {
    return [...signals].sort((a, b) => b.confidence - a.confidence || b.reliability - a.reliability || rank[b.label] - rank[a.label])[0];
  }
  const cutoff = newest - recentWindowDays * 86400000;
  const recent = signals.filter(signal => parseTimestamp(signal.observedAt) >= cutoff);
  return [...recent].sort((a, b) => rank[b.label] - rank[a.label] || b.confidence - a.confidence || b.reliability - a.reliability || parseTimestamp(b.observedAt) - parseTimestamp(a.observedAt))[0];
}

function firstValue(raw: Record<string, unknown>, keys: string[]) {
  for (const [key, value] of Object.entries(raw)) {
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!keys.some(candidate => compact.includes(candidate))) continue;
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (text) return text;
  }
  return '';
}

export function inferOrganisation(sourceKey: string, raw: Record<string, unknown>) {
  const key = sourceKey.toLowerCase();
  const contractor = firstValue(raw, ['contractorname', 'contractor']);
  if (contractor) return { name: contractor, role: 'DELIVERY_CONTRACTOR' as OrganisationRole };
  const supplier = firstValue(raw, ['suppliername', 'supplier']);
  if (supplier) return { name: supplier, role: 'SUPPLIER' as OrganisationRole };
  const operator = firstValue(raw, ['operatorname', 'operator']);
  if (operator) return { name: operator, role: 'OPERATOR' as OrganisationRole };
  const proponent = firstValue(raw, ['proponent', 'clientname', 'client', 'ownername', 'owner']);
  if (proponent) return { name: proponent, role: 'OWNER_PROPONENT' as OrganisationRole };
  const applicant = firstValue(raw, ['applicant', 'holder', 'ownname']);
  if (applicant) return { name: applicant, role: 'APPLICANT_HOLDER' as OrganisationRole };
  const company = firstValue(raw, ['company', 'organisation', 'organization']);
  if (!company) return { name: '', role: 'UNKNOWN' as OrganisationRole };
  if (key.includes('contract') || key.includes('award')) return { name: company, role: 'DELIVERY_CONTRACTOR' as OrganisationRole };
  if (key.includes('tenement') || key.includes('authority') || key.includes('environmental')) return { name: company, role: 'APPLICANT_HOLDER' as OrganisationRole };
  return { name: company, role: 'UNKNOWN' as OrganisationRole };
}

export function extractSourceDate(raw: Record<string, unknown>, fallback: string) {
  const keys = ['issuedate', 'issue_date', 'awarddate', 'award_date', 'contractdate', 'contract_date', 'date', 'lastmodified', 'last_modified', 'created'];
  const value = firstValue(raw, keys.map(key => key.replace(/[^a-z0-9]/g, '')));
  const timestamp = parseTimestamp(value);
  return timestamp ? new Date(timestamp).toISOString() : fallback;
}

const RESULT_RANK: Record<OutcomeLike['result'], number> = {
  CONTACTED: 1,
  REQUIREMENT_CONFIRMED: 2,
  QUOTED: 3,
  WON: 5,
  LOST: 4,
  FALSE_POSITIVE: 4,
};

export function aggregateOutcomeFunnel(rows: OutcomeLike[]) {
  const real = rows.filter(row => !row.qa);
  const grouped = new Map<string, OutcomeLike[]>();
  for (const row of real) {
    const key = row.projectId || normalise(row.project);
    const existing = grouped.get(key) || [];
    existing.push(row);
    grouped.set(key, existing);
  }
  const projects = [...grouped.values()];
  const contacted = projects.length;
  const reviewed = projects.filter(history => history.some(row => ['REQUIREMENT_CONFIRMED', 'QUOTED', 'WON', 'LOST', 'FALSE_POSITIVE'].includes(row.result))).length;
  const falsePositive = projects.filter(history => history.some(row => row.result === 'FALSE_POSITIVE')).length;
  const quoted = projects.filter(history => history.some(row => row.result === 'QUOTED' || row.result === 'WON')).length;
  const won = projects.filter(history => history.some(row => row.result === 'WON')).length;
  const quotedValue = projects.reduce((sum, history) => sum + Math.max(0, ...history.map(row => Number(row.quoteValue) || 0)), 0);
  const wonValue = projects.reduce((sum, history) => sum + Math.max(0, ...history.map(row => Number(row.wonValue) || 0)), 0);
  const advance = projects.flatMap(history => history.map(row => row.advanceDays).filter((value): value is number => typeof value === 'number'));
  const pct = (a: number, b: number) => b ? `${Math.round(a / b * 100)}%` : '—';
  return {
    contacted,
    reviewed,
    precision: reviewed ? pct(reviewed - falsePositive, reviewed) : '—',
    falsePositiveRate: pct(falsePositive, reviewed),
    advanceDays: advance.length ? (advance.reduce((a, b) => a + b, 0) / advance.length).toFixed(1) : '—',
    quoteConversion: pct(quoted, contacted),
    leadToHire: pct(won, contacted),
    quotedValue,
    wonValue,
  };
}

export type CallNowCandidate = {
  stageLabel: string;
  bdmPriority: number;
  signalQualityBand: string;
  freshnessScore: number;
  contractorConfidence?: number;
  contractors?: string[];
  equipmentPrediction?: { classes?: string[]; confidence?: number };
};

export function isCallNowCandidate(project: CallNowCandidate) {
  const stageReady = ['AWARDED', 'MOBILISATION', 'CONSTRUCTION', 'MAINTENANCE', 'SHUTDOWN'].includes(project.stageLabel);
  const contractorReady = (project.contractors?.length || 0) > 0 && (project.contractorConfidence || 0) >= 70;
  const equipmentReady = (project.equipmentPrediction?.classes?.length || 0) > 0 && (project.equipmentPrediction?.confidence || 0) >= 55;
  return stageReady && contractorReady && equipmentReady && project.bdmPriority >= 80 && ['A', 'B'].includes(project.signalQualityBand) && project.freshnessScore >= 65;
}

export function uniqueProjectMapStats<T extends { projectId: string; priority: number; equipment: string[] }>(points: T[]) {
  const byProject = new Map<string, T>();
  for (const point of points) {
    const existing = byProject.get(point.projectId);
    if (!existing || point.priority > existing.priority) byProject.set(point.projectId, point);
  }
  const projects = [...byProject.values()];
  const equipment = new Map<string, number>();
  for (const project of projects) for (const item of project.equipment) equipment.set(item, (equipment.get(item) || 0) + 1);
  return {
    projectCount: projects.length,
    highCount: projects.filter(project => project.priority >= 80).length,
    equipmentSummary: [...equipment.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function validateDemoRequest(input: Record<string, unknown>) {
  const name = String(input.name || '').trim();
  const company = String(input.company || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').trim();
  const message = String(input.message || '').trim();
  const honeypot = String(input.website || '').trim();
  if (honeypot) return { ok: false as const, error: 'Rejected' };
  if (name.length < 2 || company.length < 2) return { ok: false as const, error: 'Name and company are required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: 'A valid business email is required.' };
  if (message.length > 2000 || phone.length > 80) return { ok: false as const, error: 'Input is too long.' };
  return { ok: true as const, value: { name, company, email, phone, message } };
}
