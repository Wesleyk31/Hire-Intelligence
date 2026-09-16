import { db } from '@appdeploy/sdk';

export type IntelligenceSource = {
  key: string;
  name: string;
  sector: string;
  territory: string;
};

export type IntelligenceEvidence = {
  id?: string;
  sourceKey: string;
  externalId: string;
  project: string;
  location: string;
  company: string;
  description: string;
  value: string;
  observedAt: string;
  provenance: string;
};

type StageLabel = 'WATCH' | 'APPROVAL' | 'PROCUREMENT' | 'AWARDED' | 'MOBILISATION' | 'CONSTRUCTION' | 'MAINTENANCE' | 'SHUTDOWN' | 'COMPLETE';
type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';
type SignalQualityBand = 'A' | 'B' | 'C' | 'D';

type StageSignal = {
  label: StageLabel;
  confidence: number;
  reason: string;
  sourceKey: string;
  observedAt: string;
  reliability: number;
};

type StageSnapshot = {
  projectKey: string;
  stageLabel: StageLabel;
  stageConfidence: number;
  observedAt: string;
  sourceKey: string;
  reason: string;
};

export type PilotCalibrationOutcome = {
  project: string;
  result: 'CONTACTED' | 'REQUIREMENT_CONFIRMED' | 'QUOTED' | 'WON' | 'LOST' | 'FALSE_POSITIVE';
  qa: boolean;
};

export type ProjectIntelligence = {
  id: string;
  name: string;
  location: string;
  company: string;
  contractors: string[];
  contractorConfidence: number;
  contractorConfidenceBand: ConfidenceBand;
  sources: string[];
  records: IntelligenceEvidence[];
  evidenceCount: number;
  value: string;
  stageLabel: StageLabel;
  stageConfidence: number;
  stageReason: string;
  stageChanged: boolean;
  previousStage: StageLabel | '';
  stageEvidence: string;
  stageTransitionQualified: boolean;
  equipmentPrediction: {
    label: 'PREDICTED';
    classes: string[];
    confidence: number;
    confidenceBand: ConfidenceBand;
    reason: string;
  };
  sourceReliability: number;
  freshnessScore: number;
  corroborationScore: number;
  contradictionPenalty: number;
  signalQualityScore: number;
  signalQualityBand: SignalQualityBand;
  bdmPriority: number;
  priorityBand: 'HIGH' | 'MEDIUM' | 'WATCH';
  priorityFactors: string[];
};

export type CalibrationBand = {
  band: SignalQualityBand;
  reviewed: number;
  confirmed: number;
  quoted: number;
  won: number;
  falsePositive: number;
};

export type CalibrationMetrics = {
  matchedReviewed: number;
  unmatchedReviewed: number;
  bands: CalibrationBand[];
};

const stageRank: Record<StageLabel, number> = {
  WATCH: 0,
  APPROVAL: 1,
  PROCUREMENT: 2,
  AWARDED: 3,
  MOBILISATION: 4,
  CONSTRUCTION: 5,
  MAINTENANCE: 6,
  SHUTDOWN: 7,
  COMPLETE: 8,
};

const normaliseKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const includesAny = (value: string, words: string[]) => words.some(word => value.includes(word));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const confidenceBand = (value: number): ConfidenceBand => value >= 75 ? 'HIGH' : value >= 50 ? 'MEDIUM' : 'LOW';

function sourceReliability(sourceKey: string, source?: IntelligenceSource) {
  const key = sourceKey.toLowerCase();
  const sector = (source?.sector || '').toLowerCase();
  if (includesAny(key, ['contract', 'tender', 'procurement'])) return 0.96;
  if (includesAny(key, ['granted', 'environmental', 'approval'])) return 0.92;
  if (includesAny(key, ['qtrip', 'infrastructure', 'generation', 'connection'])) return 0.9;
  if (includesAny(sector, ['infrastructure', 'procurement', 'rail', 'energy'])) return 0.88;
  if (includesAny(sector, ['mining', 'resources', 'oil & gas'])) return 0.84;
  if (includesAny(sector, ['exploration', 'building', 'development'])) return 0.8;
  return 0.74;
}

function freshness(record: IntelligenceEvidence) {
  const timestamp = Date.parse(record.observedAt);
  if (!timestamp) return 10;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
  if (ageDays <= 1) return 100;
  if (ageDays <= 7) return 92;
  if (ageDays <= 30) return 75;
  if (ageDays <= 90) return 52;
  if (ageDays <= 180) return 32;
  if (ageDays <= 365) return 18;
  return 8;
}

function classifyStage(record: IntelligenceEvidence, source?: IntelligenceSource): StageSignal {
  const haystack = [record.project, record.description, record.sourceKey, source?.sector || ''].join(' ').toLowerCase();
  const base = { sourceKey: record.sourceKey, observedAt: record.observedAt, reliability: sourceReliability(record.sourceKey, source) };
  if (includesAny(haystack, ['completed', 'completion', 'works complete', 'project complete'])) return { ...base, label: 'COMPLETE', confidence: 0.94, reason: 'Published evidence indicates the work is complete.' };
  if (includesAny(haystack, ['shutdown', 'turnaround', 'outage', 'plant stop', 'closure window'])) return { ...base, label: 'SHUTDOWN', confidence: 0.92, reason: 'Published evidence contains a shutdown, turnaround or outage signal.' };
  if (includesAny(haystack, ['maintenance', 'repair', 'rehabilitation', 'renewal', 'asset management'])) return { ...base, label: 'MAINTENANCE', confidence: 0.86, reason: 'Published evidence describes maintenance, repair or asset-renewal work.' };
  if (includesAny(haystack, ['mobilisation', 'mobilization', 'site establishment', 'site setup'])) return { ...base, label: 'MOBILISATION', confidence: 0.9, reason: 'Published evidence contains a mobilisation or site-establishment signal.' };
  if (record.sourceKey.includes('contract') || includesAny(haystack, ['contract awarded', 'award date', 'awarded contract'])) return { ...base, label: 'AWARDED', confidence: 0.91, reason: 'The evidence is an awarded-contract disclosure or explicitly states an award.' };
  if (record.sourceKey.includes('tender') || record.sourceKey.includes('procurement') || includesAny(haystack, ['request for tender', 'expression of interest', 'tender', 'procurement'])) return { ...base, label: 'PROCUREMENT', confidence: 0.88, reason: 'Published evidence indicates tendering or procurement activity.' };
  if (includesAny(haystack, ['construction', 'civil works', 'earthworks', 'roadworks', 'upgrade works', 'build works'])) return { ...base, label: 'CONSTRUCTION', confidence: 0.82, reason: 'Published evidence describes construction or physical works.' };
  if (record.sourceKey.includes('environmental') || record.sourceKey.includes('granted') || includesAny(haystack, ['approval', 'approved', 'permit', 'authority granted'])) return { ...base, label: 'APPROVAL', confidence: 0.8, reason: 'Published evidence indicates an approval, permit or granted authority.' };
  return { ...base, label: 'WATCH', confidence: 0.5, reason: 'Evidence confirms activity but not a later commercial stage.' };
}

function predictEquipment(records: IntelligenceEvidence[], sources: Map<string, IntelligenceSource>) {
  const haystack = records.map(record => [record.project, record.description, record.sourceKey, sources.get(record.sourceKey)?.sector || ''].join(' ').toLowerCase()).join(' ');
  const classes = new Set<string>();
  const reasons: string[] = [];
  let matchedGroups = 0;
  if (includesAny(haystack, ['road', 'earthwork', 'earthworks', 'civil', 'excavat', 'mine', 'mining', 'quarry'])) { ['Excavators', 'Loaders', 'Graders', 'Rollers', 'Support fleet'].forEach(item => classes.add(item)); reasons.push('civil, earthworks or mining work'); matchedGroups += 1; }
  if (includesAny(haystack, ['water', 'pipeline', 'sewer', 'drainage', 'dewater', 'dam'])) { ['Excavators', 'Pumps / dewatering', 'Generators'].forEach(item => classes.add(item)); reasons.push('water, pipeline or dewatering work'); matchedGroups += 1; }
  if (includesAny(haystack, ['rail', 'track', 'station'])) { ['Excavators', 'Telehandlers', 'Lighting towers'].forEach(item => classes.add(item)); reasons.push('rail or track work'); matchedGroups += 1; }
  if (includesAny(haystack, ['shutdown', 'maintenance', 'outage', 'turnaround', 'repair'])) { ['Access equipment', 'Telehandlers', 'Generators', 'Lighting towers'].forEach(item => classes.add(item)); reasons.push('maintenance or shutdown work'); matchedGroups += 1; }
  if (includesAny(haystack, ['energy', 'substation', 'transmission', 'solar', 'wind', 'generator', 'power'])) { ['Cranes / material handling', 'Telehandlers', 'Access equipment', 'Generators'].forEach(item => classes.add(item)); reasons.push('energy or electrical infrastructure work'); matchedGroups += 1; }
  if (includesAny(haystack, ['building', 'hospital', 'stadium', 'facility', 'facilities'])) { ['Access equipment', 'Telehandlers', 'Generators'].forEach(item => classes.add(item)); reasons.push('building or facilities work'); matchedGroups += 1; }
  const averageReliability = records.length ? records.reduce((sum, record) => sum + sourceReliability(record.sourceKey, sources.get(record.sourceKey)), 0) / records.length : 0;
  const confidence = classes.size ? Math.round(clamp((45 + matchedGroups * 9 + Math.min(10, records.length * 2)) * (0.75 + averageReliability * 0.25), 0, 92)) : 0;
  return { label: 'PREDICTED' as const, classes: [...classes], confidence, confidenceBand: confidenceBand(confidence), reason: reasons.length ? 'Predicted from observed ' + reasons.join(', ') + '.' : 'No sufficiently specific work-type evidence to infer an equipment class.' };
}

function contradictionPenalty(records: IntelligenceEvidence[]) {
  const haystack = records.map(record => `${record.project} ${record.description}`.toLowerCase()).join(' ');
  let penalty = 0;
  if (includesAny(haystack, ['cancelled', 'canceled', 'withdrawn', 'abandoned'])) penalty += 30;
  if (includesAny(haystack, ['deferred', 'postponed', 'on hold', 'suspended'])) penalty += 18;
  if (includesAny(haystack, ['completed', 'works complete', 'project complete'])) penalty += 12;
  return clamp(penalty, 0, 40);
}

function scoreSignalQuality(records: IntelligenceEvidence[], sources: Map<string, IntelligenceSource>) {
  const averageReliability = records.length ? records.reduce((sum, record) => sum + sourceReliability(record.sourceKey, sources.get(record.sourceKey)), 0) / records.length : 0;
  const newestFreshness = Math.max(...records.map(freshness));
  const uniqueSources = new Set(records.map(record => record.sourceKey)).size;
  const corroboration = clamp((uniqueSources - 1) * 12 + Math.max(0, records.length - uniqueSources) * 3, 0, 25);
  const contradiction = contradictionPenalty(records);
  const score = Math.round(clamp(averageReliability * 45 + newestFreshness * 0.3 + corroboration - contradiction, 0, 100));
  const qualityBand: SignalQualityBand = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  return { reliabilityScore: Math.round(averageReliability * 100), freshnessScore: Math.round(newestFreshness), corroborationScore: corroboration, contradictionPenalty: contradiction, score, band: qualityBand };
}

function scoreContractorConfidence(records: IntelligenceEvidence[], sources: Map<string, IntelligenceSource>) {
  const named = records.filter(record => record.company.trim());
  if (!named.length) return { score: 0, band: 'LOW' as ConfidenceBand };
  const uniqueCompanies = new Set(named.map(record => normaliseKey(record.company))).size;
  const reliability = named.reduce((sum, record) => sum + sourceReliability(record.sourceKey, sources.get(record.sourceKey)), 0) / named.length;
  const score = Math.round(clamp(40 + reliability * 35 + Math.min(20, named.length * 5) - Math.max(0, uniqueCompanies - 1) * 5, 0, 95));
  return { score, band: confidenceBand(score) };
}

function scorePriority(records: IntelligenceEvidence[], stage: StageSignal, equipment: ReturnType<typeof predictEquipment>, signalQuality: ReturnType<typeof scoreSignalQuality>) {
  const relevanceMultiplier = equipment.classes.length ? 1 : 0.4;
  const freshnessPoints = Math.round(signalQuality.freshnessScore * 0.25 * relevanceMultiplier);
  const stagePoints: Record<StageLabel, number> = { WATCH: 4, APPROVAL: 10, PROCUREMENT: 18, AWARDED: 15, MOBILISATION: 25, CONSTRUCTION: 22, MAINTENANCE: 20, SHUTDOWN: 24, COMPLETE: 0 };
  const contractor = records.some(record => record.company.trim()) ? 15 : 0;
  const equipmentRelevance = equipment.classes.length ? Math.min(15, 8 + equipment.classes.length) : 0;
  const reliabilityPoints = Math.round(signalQuality.reliabilityScore * 0.1);
  const corroborationPoints = Math.round(signalQuality.corroborationScore * 0.4);
  const contradictionPoints = Math.round(signalQuality.contradictionPenalty * 0.5);
  const priority = clamp(freshnessPoints + stagePoints[stage.label] + contractor + equipmentRelevance + reliabilityPoints + corroborationPoints - contradictionPoints, 0, 100);
  return { priority, factors: [`Freshness decay ${freshnessPoints}/25`, `Stage/timing ${stagePoints[stage.label]}/25`, `Contractor evidence ${contractor}/15`, `Equipment relevance ${equipmentRelevance}/15`, `Source reliability ${reliabilityPoints}/10`, `Independent corroboration ${corroborationPoints}/10`, `Contradiction penalty -${contradictionPoints}`] };
}

export async function buildProjectIntelligence(records: IntelligenceEvidence[], sourceList: IntelligenceSource[]): Promise<ProjectIntelligence[]> {
  const sourceMap = new Map(sourceList.map(source => [source.key, source]));
  const groups = new Map<string, IntelligenceEvidence[]>();
  for (const record of records) {
    const key = normaliseKey(record.project || record.externalId);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const snapshotPage = await db.list<StageSnapshot>('project_stage_snapshots', { limit: 100 });
  const snapshotByKey = new Map(snapshotPage.items.map(item => [item.projectKey, item]));
  const additions: StageSnapshot[] = [];
  const updates: Array<{ id: string; record: StageSnapshot }> = [];
  const projects: ProjectIntelligence[] = [];
  for (const [projectKey, projectRecords] of groups) {
    const stageSignals = projectRecords.map(record => classifyStage(record, sourceMap.get(record.sourceKey)));
    stageSignals.sort((a, b) => stageRank[b.label] - stageRank[a.label] || b.confidence - a.confidence || b.observedAt.localeCompare(a.observedAt));
    const currentStage = stageSignals[0];
    const previous = snapshotByKey.get(projectKey);
    const uniqueSources = new Set(projectRecords.map(record => record.sourceKey)).size;
    const transitionQualified = currentStage.confidence >= 0.78 && currentStage.reliability >= 0.82 && (uniqueSources >= 2 || currentStage.reliability >= 0.92);
    const advanced = Boolean(previous && transitionQualified && stageRank[currentStage.label] > stageRank[previous.stageLabel] && currentStage.observedAt >= previous.observedAt);
    const nextSnapshot: StageSnapshot = { projectKey, stageLabel: currentStage.label, stageConfidence: currentStage.confidence, observedAt: currentStage.observedAt, sourceKey: currentStage.sourceKey, reason: currentStage.reason };
    if (!previous) additions.push(nextSnapshot);
    else if (advanced) updates.push({ id: previous.id, record: nextSnapshot });
    const equipmentPrediction = predictEquipment(projectRecords, sourceMap);
    const signalQuality = scoreSignalQuality(projectRecords, sourceMap);
    const priority = scorePriority(projectRecords, currentStage, equipmentPrediction, signalQuality);
    const contractorConfidence = scoreContractorConfidence(projectRecords, sourceMap);
    const contractors = [...new Set(projectRecords.map(record => record.company.trim()).filter(Boolean))];
    const sources = [...new Set(projectRecords.map(record => record.sourceKey))];
    const lead = [...projectRecords].sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
    projects.push({ id: projectKey, name: lead.project, location: lead.location, company: contractors[0] || '', contractors, contractorConfidence: contractorConfidence.score, contractorConfidenceBand: contractorConfidence.band, sources, records: projectRecords, evidenceCount: projectRecords.length, value: projectRecords.find(record => record.value && record.value !== 'Not stated')?.value || 'Not stated', stageLabel: currentStage.label, stageConfidence: Math.round(currentStage.confidence * 100), stageReason: currentStage.reason, stageChanged: advanced, previousStage: advanced && previous ? previous.stageLabel : '', stageEvidence: `${currentStage.sourceKey} · ${currentStage.observedAt}`, stageTransitionQualified: transitionQualified, equipmentPrediction, sourceReliability: signalQuality.reliabilityScore, freshnessScore: signalQuality.freshnessScore, corroborationScore: signalQuality.corroborationScore, contradictionPenalty: signalQuality.contradictionPenalty, signalQualityScore: signalQuality.score, signalQualityBand: signalQuality.band, bdmPriority: priority.priority, priorityBand: priority.priority >= 80 ? 'HIGH' : priority.priority >= 60 ? 'MEDIUM' : 'WATCH', priorityFactors: priority.factors });
  }
  if (updates.length) await db.update('project_stage_snapshots', updates.slice(0, 100));
  const availableSlots = Math.max(0, 100 - snapshotPage.items.length);
  if (additions.length && availableSlots) await db.add('project_stage_snapshots', additions.slice(0, availableSlots));
  return projects.sort((a, b) => b.bdmPriority - a.bdmPriority || b.signalQualityScore - a.signalQualityScore || b.evidenceCount - a.evidenceCount).slice(0, 50);
}

export function buildCalibrationMetrics(projects: ProjectIntelligence[], outcomes: PilotCalibrationOutcome[]): CalibrationMetrics {
  const reviewedResults = new Set(['REQUIREMENT_CONFIRMED', 'QUOTED', 'WON', 'LOST', 'FALSE_POSITIVE']);
  const projectByKey = new Map(projects.map(project => [normaliseKey(project.name), project]));
  const bands: CalibrationBand[] = ['A', 'B', 'C', 'D'].map(value => ({ band: value as SignalQualityBand, reviewed: 0, confirmed: 0, quoted: 0, won: 0, falsePositive: 0 }));
  let matchedReviewed = 0;
  let unmatchedReviewed = 0;
  for (const outcome of outcomes) {
    if (outcome.qa || !reviewedResults.has(outcome.result)) continue;
    const project = projectByKey.get(normaliseKey(outcome.project));
    if (!project) { unmatchedReviewed += 1; continue; }
    matchedReviewed += 1;
    const bucket = bands.find(item => item.band === project.signalQualityBand)!;
    bucket.reviewed += 1;
    if (outcome.result === 'REQUIREMENT_CONFIRMED' || outcome.result === 'QUOTED' || outcome.result === 'WON') bucket.confirmed += 1;
    if (outcome.result === 'QUOTED' || outcome.result === 'WON') bucket.quoted += 1;
    if (outcome.result === 'WON') bucket.won += 1;
    if (outcome.result === 'FALSE_POSITIVE') bucket.falsePositive += 1;
  }
  return { matchedReviewed, unmatchedReviewed, bands };
}
