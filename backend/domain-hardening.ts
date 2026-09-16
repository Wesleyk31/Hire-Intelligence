export type OrganisationRole =
  | 'DELIVERY_CONTRACTOR'
  | 'OWNER_PROPONENT'
  | 'APPLICANT_HOLDER'
  | 'SUPPLIER'
  | 'OPERATOR'
  | 'UNKNOWN';

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
  result:
    | 'CONTACTED'
    | 'REQUIREMENT_CONFIRMED'
    | 'QUOTED'
    | 'WON'
    | 'LOST'
    | 'FALSE_POSITIVE';
  quoteValue?: number | null;
  wonValue?: number | null;
  advanceDays?: number | null;
  recordedAt?: string;
  qa: boolean;
};

const STOP_WORDS = new Set([
  'project',
  'projects',
  'development',
  'developments',
  'works',
  'work',
  'stage',
  'phase',
  'package',
  'contract',
  'permit',
  'approval',
  'application',
  'authority',
  'roadworks',
  'roadwork',
  'mine',
  'mining',
  'the',
  'and',
  'for',
  'of',
  'at',
  'in',
  'to',
  'pty',
  'ltd',
  'limited',
  'australia',
  'australian',
]);

export const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const meaningfulTokens = (value: string) =>
  normalise(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const locationKey = (location: string) => {
  let value = normalise(location);
  const states: Record<string, string> = {
    'western australia': 'wa',
    queensland: 'qld',
    'new south wales': 'nsw',
    victoria: 'vic',
    'south australia': 'sa',
    'northern territory': 'nt',
    tasmania: 'tas',
    'australian capital territory': 'act',
  };
  for (const [name, code] of Object.entries(states))
    value = value.replace(name, code);
  return value.split(' ').filter(Boolean).join('-') || 'unknown';
};

export function groupCanonicalEvidence<T extends EvidenceLike>(
  records: T[],
): Map<string, T[]> {
  type Group = {
    key: string;
    location: string;
    tokens: string[];
    tokenSet: Set<string>;
    rows: T[];
    order: number;
  };
  const groups: Group[] = [];
  const candidatesByLocation = new Map<string, Map<string, Set<Group>>>();
  const indexToken = (location: string, token: string, group: Group) => {
    let postings = candidatesByLocation.get(location);
    if (!postings) {
      postings = new Map();
      candidatesByLocation.set(location, postings);
    }
    let matches = postings.get(token);
    if (!matches) {
      matches = new Set();
      postings.set(token, matches);
    }
    matches.add(group);
  };
  // Compute pure title/location values once; the stable representative ordering is unchanged.
  const ordered = records
    .map((record) => ({
      record,
      tokens: meaningfulTokens(record.project),
      title: normalise(record.project),
      location: locationKey(record.location),
      identity: `${record.sourceKey}:${record.externalId}`,
    }))
    .sort(
      (a, b) =>
        a.tokens.length - b.tokens.length ||
        a.title.localeCompare(b.title) ||
        a.identity.localeCompare(b.identity),
    );
  for (const { record, tokens, location } of ordered) {
    const tokenSet = new Set(tokens);
    if (tokens.length < 2) {
      groups.push({
        key: `${record.sourceKey}:${record.externalId}`,
        location,
        tokens,
        tokenSet,
        rows: [record],
        order: groups.length,
      });
      continue;
    }
    // A group with no shared token has both similarity scores zero and cannot win.
    const candidates = new Set<Group>();
    const postings = candidatesByLocation.get(location);
    for (const token of tokenSet)
      for (const group of postings?.get(token) || []) candidates.add(group);
    let best: Group | undefined;
    let bestScore = 0;
    for (const group of candidates) {
      // A prior merge may have collapsed repeated tokens to a single meaningful token.
      if (group.tokens.length < 2) continue;
      let uniqueIntersection = 0,
        intersection = 0;
      for (const token of tokenSet)
        if (group.tokenSet.has(token)) uniqueIntersection++;
      for (const token of tokens) if (group.tokenSet.has(token)) intersection++;
      const union = tokenSet.size + group.tokenSet.size - uniqueIntersection;
      const score = union ? uniqueIntersection / union : 0;
      const overlap =
        intersection /
        Math.max(1, Math.min(tokens.length, group.tokens.length));
      const combined = Math.max(score, overlap);
      // Posting traversal is not insertion order. Preserve the exhaustive algorithm's first tie.
      if (
        combined > bestScore ||
        (combined === bestScore &&
          best !== undefined &&
          group.order < best.order)
      ) {
        best = group;
        bestScore = combined;
      }
    }
    if (best && bestScore >= 0.8) {
      best.rows.push(record);
      for (const token of tokenSet)
        if (!best.tokenSet.has(token)) {
          best.tokenSet.add(token);
          indexToken(location, token, best);
        }
      // The original merge also removes repeated title tokens, even when no new token is added.
      best.tokens = [...best.tokenSet];
      continue;
    }
    const group = {
      key: `${location}:${[...tokenSet].sort().join('-')}`,
      location,
      tokens,
      tokenSet,
      rows: [record],
      order: groups.length,
    };
    groups.push(group);
    for (const token of tokenSet) indexToken(location, token, group);
  }
  const result = new Map<string, T[]>();
  for (const group of groups)
    result.set(group.key, [...(result.get(group.key) || []), ...group.rows]);
  return result;
}

const parseTimestamp = (value?: string | number) => {
  let parsed = 0;
  if (typeof value === 'number' && Math.abs(value) >= 1e10) parsed = value;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value))
    parsed = Date.parse(value);
  // Expiry dates, unknown serial formats and future dates cannot establish recency.
  return Number.isFinite(parsed) &&
    parsed >= Date.UTC(1900, 0, 1) &&
    parsed <= Date.now()
    ? parsed
    : 0;
};

export function evidenceTimestamp(record: EvidenceLike): number {
  return parseTimestamp(record.sourceObservedAt);
}

export function chooseCurrentStage<
  TStage extends string,
  TSignal extends StageSignalLike<TStage>,
>(
  signals: TSignal[],
  rank: Record<TStage, number>,
  recentWindowDays = 45,
): TSignal {
  if (!signals.length) throw new Error('No stage signals supplied');
  const newest = Math.max(
    ...signals.map((signal) => parseTimestamp(signal.observedAt)),
  );
  if (!newest) {
    return [...signals].sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.reliability - a.reliability ||
        rank[b.label] - rank[a.label],
    )[0];
  }
  const cutoff = newest - recentWindowDays * 86400000;
  const recent = signals.filter(
    (signal) => parseTimestamp(signal.observedAt) >= cutoff,
  );
  return [...recent].sort(
    (a, b) =>
      rank[b.label] - rank[a.label] ||
      b.confidence - a.confidence ||
      b.reliability - a.reliability ||
      parseTimestamp(b.observedAt) - parseTimestamp(a.observedAt),
  )[0];
}

function firstValue(raw: Record<string, unknown>, keys: string[]) {
  const entries = Object.entries(raw).map(
    ([key, value]) =>
      [key.toLowerCase().replace(/[^a-z0-9]/g, ''), value] as const,
  );
  for (const key of keys) {
    const value = entries.find(([name]) => name === key)?.[1];
    if (typeof value === 'string' && /[a-z]/i.test(value) && value.trim())
      return value.trim();
  }
  return '';
}

export function inferOrganisation(
  sourceKey: string,
  raw: Record<string, unknown>,
) {
  const contractor = firstValue(raw, ['contractorname', 'contractor']);
  if (contractor)
    return {
      name: contractor,
      role: 'DELIVERY_CONTRACTOR' as OrganisationRole,
    };
  const supplier = firstValue(raw, ['suppliername', 'supplier']);
  if (supplier) return { name: supplier, role: 'SUPPLIER' as OrganisationRole };
  const operator = firstValue(raw, ['operatorname', 'operator']);
  if (operator) return { name: operator, role: 'OPERATOR' as OrganisationRole };
  const explicitHolder = firstValue(raw, [
    'permitholders',
    'permitholder',
    'authorisedholder',
    'authorizedholder',
    'holder1',
  ]);
  if (explicitHolder)
    return {
      name: explicitHolder,
      role: 'APPLICANT_HOLDER' as OrganisationRole,
    };
  const titleRegister =
    /^qld-.*resource-authorities$|^wa-(?:mining-tenements|tenements-.*)$|^tas-.*(?:licences|leases|tenements)$/.test(
      sourceKey,
    );
  const titleHolder = titleRegister
    ? firstValue(raw, ['clientname', 'owner', 'holder', 'ownname'])
    : '';
  if (titleHolder)
    return {
      name: titleHolder,
      role: 'APPLICANT_HOLDER' as OrganisationRole,
    };
  const aemoProponent = sourceKey.startsWith('aemo-')
    ? firstValue(raw, ['organisationname', 'organizationname'])
    : '';
  const proponent =
    aemoProponent ||
    firstValue(raw, [
      'proponent',
      'siteowner',
      'clientname',
      'client',
      'ownername',
      'owner',
    ]);
  if (proponent)
    return { name: proponent, role: 'OWNER_PROPONENT' as OrganisationRole };
  const applicant = firstValue(raw, ['applicant', 'holder', 'ownname']);
  if (applicant)
    return {
      name: applicant,
      role: 'APPLICANT_HOLDER' as OrganisationRole,
    };
  const company = firstValue(raw, ['company', 'organisation', 'organization']);
  if (!company) return { name: '', role: 'UNKNOWN' as OrganisationRole };
  return { name: company, role: 'UNKNOWN' as OrganisationRole };
}

export function extractSourceDate(
  raw: Record<string, unknown>,
  _collectionTime: string,
) {
  const entries = new Map(
    Object.entries(raw).map(([key, value]) => [
      key.toLowerCase().replace(/[^a-z0-9]/g, ''),
      value,
    ]),
  );
  for (const key of [
    'surveylatestupdatedate',
    'kcidatatnspvalidationdate',
    'lastmodified',
    'updatedat',
    'completiondate',
    'issuedate',
    'effectivedate',
    'granteddate',
    'grantdate',
    'awardcontractdate',
    'awarddate',
    'contractdate',
    'publishedat',
    'publicationdate',
    'created',
    'date',
  ]) {
    const value = entries.get(key);
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const timestamp = parseTimestamp(value);
    if (timestamp) return new Date(timestamp).toISOString();
  }
  return '';
}

export function aggregateOutcomeFunnel(rows: OutcomeLike[]) {
  const real = rows.filter((row) => !row.qa);
  const grouped = new Map<string, OutcomeLike[]>();
  for (const row of real) {
    const key = row.projectId || normalise(row.project);
    const existing = grouped.get(key) || [];
    existing.push(row);
    grouped.set(key, existing);
  }
  const projects = [...grouped.values()];
  const contacted = projects.length;
  const reviewed = projects.filter((history) =>
    history.some((row) =>
      [
        'REQUIREMENT_CONFIRMED',
        'QUOTED',
        'WON',
        'LOST',
        'FALSE_POSITIVE',
      ].includes(row.result),
    ),
  ).length;
  const falsePositive = projects.filter((history) =>
    history.some((row) => row.result === 'FALSE_POSITIVE'),
  ).length;
  const quoted = projects.filter((history) =>
    history.some((row) => row.result === 'QUOTED' || row.result === 'WON'),
  ).length;
  const won = projects.filter((history) =>
    history.some((row) => row.result === 'WON'),
  ).length;
  const quotedValue = projects.reduce(
    (sum, history) =>
      sum + Math.max(0, ...history.map((row) => Number(row.quoteValue) || 0)),
    0,
  );
  const wonValue = projects.reduce(
    (sum, history) =>
      sum + Math.max(0, ...history.map((row) => Number(row.wonValue) || 0)),
    0,
  );
  const advance = projects.flatMap((history) =>
    history
      .map((row) => row.advanceDays)
      .filter((value): value is number => typeof value === 'number'),
  );
  const pct = (a: number, b: number) =>
    b ? `${Math.round((a / b) * 100)}%` : '—';
  return {
    contacted,
    reviewed,
    precision: reviewed ? pct(reviewed - falsePositive, reviewed) : '—',
    falsePositiveRate: pct(falsePositive, reviewed),
    advanceDays: advance.length
      ? (advance.reduce((a, b) => a + b, 0) / advance.length).toFixed(1)
      : '—',
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

export function isCallNowCandidate(
  project: CallNowCandidate & { promotionEligible?: boolean },
) {
  if (project.promotionEligible === false) return false;
  const stageReady = [
    'AWARDED',
    'MOBILISATION',
    'CONSTRUCTION',
    'MAINTENANCE',
    'SHUTDOWN',
  ].includes(project.stageLabel);
  const contractorReady =
    (project.contractors?.length || 0) > 0 &&
    (project.contractorConfidence || 0) >= 70;
  const equipmentReady =
    (project.equipmentPrediction?.classes?.length || 0) > 0 &&
    (project.equipmentPrediction?.confidence || 0) >= 55;
  return (
    stageReady &&
    contractorReady &&
    equipmentReady &&
    project.bdmPriority >= 80 &&
    ['A', 'B'].includes(project.signalQualityBand) &&
    project.freshnessScore >= 65
  );
}

export function uniqueProjectMapStats<
  T extends { projectId: string; priority: number; equipment: string[] },
>(points: T[]) {
  const byProject = new Map<string, T>();
  for (const point of points) {
    const existing = byProject.get(point.projectId);
    if (!existing || point.priority > existing.priority)
      byProject.set(point.projectId, point);
  }
  const projects = [...byProject.values()];
  const equipment = new Map<string, number>();
  for (const project of projects)
    for (const item of project.equipment)
      equipment.set(item, (equipment.get(item) || 0) + 1);
  return {
    projectCount: projects.length,
    highCount: projects.filter((project) => project.priority >= 80).length,
    equipmentSummary: [...equipment.entries()].sort((a, b) => b[1] - a[1]),
  };
}

export function validateDemoRequest(input: Record<string, unknown>) {
  const name = String(input.name || '').trim();
  const company = String(input.company || '').trim();
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  const phone = String(input.phone || '').trim();
  const message = String(input.message || '').trim();
  const honeypot = String(input.website || '').trim();
  if (honeypot) return { ok: false as const, error: 'Rejected' };
  if (name.length < 2 || company.length < 2)
    return { ok: false as const, error: 'Name and company are required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return {
      ok: false as const,
      error: 'A valid business email is required.',
    };
  if (
    name.length > 200 ||
    company.length > 300 ||
    email.length > 254 ||
    message.length > 2000 ||
    phone.length > 80
  )
    return { ok: false as const, error: 'Input is too long.' };
  return {
    ok: true as const,
    value: { name, company, email, phone, message },
  };
}
