import { evidenceTimestamp } from './domain-hardening';
import { groupReviewedOutcomes } from './calibration';
import type { ProjectIntelligence } from './intelligence';

export type CommercialSource = {
  key: string;
  territory: string;
  sector: string;
};
export type CommercialOutcome = {
  projectId?: string;
  project: string;
  result:
    | 'CONTACTED'
    | 'REQUIREMENT_CONFIRMED'
    | 'QUOTED'
    | 'WON'
    | 'LOST'
    | 'FALSE_POSITIVE';
  recordedAt: string;
  qa: boolean;
  advanceDays?: number | null;
};

type EventType =
  | 'SHUTDOWN'
  | 'OUTAGE'
  | 'RESTART'
  | 'EXPANSION'
  | 'MOBILISATION'
  | 'MAINTENANCE'
  | 'PROCUREMENT'
  | 'AWARD'
  | 'APPROVAL'
  | 'NEGATIVE';
const normalise = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const contains = (value: string, terms: string[]) =>
  terms.some((term) => value.includes(term));
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function projectText(project: ProjectIntelligence) {
  return project.records
    .map(
      (record) => `${record.project} ${record.description} ${record.sourceKey}`,
    )
    .join(' ')
    .toLowerCase();
}

function eventSignals(project: ProjectIntelligence) {
  const text = projectText(project);
  const recordText = (record: ProjectIntelligence['records'][number]) =>
    `${record.project} ${record.description} ${record.sourceKey}`.toLowerCase();
  const eventDate = (
    matches: (record: ProjectIntelligence['records'][number]) => boolean,
  ) => {
    const latest = Math.max(
      0,
      ...project.records.filter(matches).map(evidenceTimestamp),
    );
    return latest ? new Date(latest).toISOString() : '';
  };
  const signals: Array<{
    type: EventType;
    detectedAt: string;
    projectId: string;
    project: string;
    location: string;
    confidence: number;
    reason: string;
    provenance: string[];
  }> = [];
  const add = (type: EventType, terms: string[], reason: string, bonus = 0) => {
    if (!contains(text, terms)) return;
    signals.push({
      type,
      detectedAt: eventDate((record) => contains(recordText(record), terms)),
      projectId: project.id,
      project: project.name,
      location: project.location,
      confidence: clamp(
        Math.round(
          project.signalQualityScore * 0.7 +
            project.stageConfidence * 0.2 +
            bonus,
        ),
        0,
        96,
      ),
      reason,
      provenance: [
        ...new Set(project.records.map((record) => record.provenance)),
      ].slice(0, 4),
    });
  };
  add(
    'SHUTDOWN',
    ['shutdown', 'turnaround', 'plant stop', 'closure window'],
    'Published evidence contains a shutdown or turnaround signal.',
    8,
  );
  add(
    'OUTAGE',
    ['outage', 'planned outage', 'maintenance outage'],
    'Published evidence contains an outage signal.',
    7,
  );
  add(
    'RESTART',
    [
      'restart',
      'recommission',
      'reactivat',
      'return to production',
      'resume operations',
    ],
    'Published evidence indicates restart, recommissioning or reactivation activity.',
    6,
  );
  add(
    'EXPANSION',
    [
      'expansion',
      'brownfield',
      'capacity increase',
      'extension',
      'new pit',
      'plant upgrade',
    ],
    'Published evidence indicates expansion or capacity-growth work.',
    5,
  );
  add(
    'MOBILISATION',
    [
      'mobilisation',
      'mobilization',
      'site establishment',
      'site setup',
      'early works',
    ],
    'Published evidence indicates mobilisation, early works or site establishment.',
    6,
  );
  add(
    'MAINTENANCE',
    ['maintenance', 'repair', 'rehabilitation', 'renewal', 'asset management'],
    'Published evidence describes maintenance, repair or renewal work.',
    4,
  );
  if (project.stageLabel === 'PROCUREMENT')
    add(
      'PROCUREMENT',
      ['tender', 'procurement', 'request for tender', 'expression of interest'],
      'Project is in an evidence-derived procurement stage.',
      5,
    );
  if (project.stageLabel === 'AWARDED')
    signals.push({
      type: 'AWARD',
      detectedAt: eventDate(
        (record) =>
          record.sourceKey.includes('contract') ||
          contains(recordText(record), [
            'contract awarded',
            'award date',
            'awarded contract',
          ]),
      ),
      projectId: project.id,
      project: project.name,
      location: project.location,
      confidence: clamp(project.stageConfidence, 0, 96),
      reason: 'Project has evidence supporting an awarded-contract stage.',
      provenance: [
        ...new Set(project.records.map((record) => record.provenance)),
      ].slice(0, 4),
    });
  if (project.stageLabel === 'APPROVAL')
    signals.push({
      type: 'APPROVAL',
      detectedAt: eventDate(
        (record) =>
          /environmental|granted/.test(record.sourceKey) ||
          contains(recordText(record), [
            'approval',
            'approved',
            'permit',
            'authority granted',
          ]),
      ),
      projectId: project.id,
      project: project.name,
      location: project.location,
      confidence: clamp(project.stageConfidence, 0, 96),
      reason: 'Project has approval/permit evidence.',
      provenance: [
        ...new Set(project.records.map((record) => record.provenance)),
      ].slice(0, 4),
    });
  add(
    'NEGATIVE',
    [
      'cancelled',
      'canceled',
      'withdrawn',
      'abandoned',
      'deferred',
      'postponed',
      'on hold',
      'suspended',
    ],
    'Published evidence contains a negative, deferred or cancellation signal.',
    3,
  );
  return signals.map((signal) => ({
    ...signal,
    stage: project.stageLabel,
    bdmPriority: project.bdmPriority,
    priorityBand: project.priorityBand,
    action: actionFor(project),
  }));
}

function actionFor(project: ProjectIntelligence) {
  if (project.stageLabel === 'COMPLETE')
    return 'Archive from active BDM focus unless new restart evidence appears.';
  if (!project.contractors.length)
    return 'Identify and verify the delivery contractor from public evidence before outreach.';
  if (project.stageLabel === 'SHUTDOWN' || project.stageLabel === 'MAINTENANCE')
    return 'Verify work window, contractor and equipment requirement before outreach.';
  if (project.stageLabel === 'AWARDED' || project.stageLabel === 'MOBILISATION')
    return 'Verify mobilisation timing and actual equipment requirement with the evidence-backed contractor.';
  if (project.stageLabel === 'PROCUREMENT')
    return 'Track award outcome and identify likely bidders/contractor before mobilisation.';
  if (project.stageLabel === 'APPROVAL')
    return 'Monitor for procurement, award or early-works evidence.';
  return 'Monitor for stronger approval, procurement, award or mobilisation evidence.';
}

function evidenceNeeded(project: ProjectIntelligence) {
  const needs: string[] = [];
  if (!project.contractors.length) needs.push('evidence-backed contractor');
  if (!project.equipmentPrediction.classes.length)
    needs.push('specific work scope for equipment prediction');
  if (project.stageLabel === 'WATCH' || project.stageLabel === 'APPROVAL')
    needs.push('procurement/award evidence');
  if (project.freshnessScore < 50) needs.push('fresh corroborating evidence');
  needs.push(
    'confirmed equipment requirement before treating prediction as demand',
  );
  return needs.join('; ');
}

export function buildCommercialIntelligence(
  projects: ProjectIntelligence[],
  outcomes: CommercialOutcome[],
  sources: CommercialSource[],
) {
  const pilotQueue = projects
    .filter((project) => project.stageLabel !== 'COMPLETE')
    .slice(0, 50)
    .map((project, index) => ({
      rank: index + 1,
      projectId: project.id,
      project: project.name,
      location: project.location,
      stage: project.stageLabel,
      bdmPriority: project.bdmPriority,
      priorityBand: project.priorityBand,
      signalQuality: project.signalQualityScore,
      signalBand: project.signalQualityBand,
      contractors: project.contractors,
      equipment: project.equipmentPrediction.classes,
      equipmentLabel: 'PREDICTED' as const,
      action: actionFor(project),
      evidenceNeeded: evidenceNeeded(project),
    }));

  const events = projects
    .flatMap(eventSignals)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 100);

  const contractorMap = new Map<
    string,
    {
      contractor: string;
      projectIds: Set<string>;
      locations: Set<string>;
      stages: Set<string>;
      equipment: Set<string>;
      highPriority: number;
      priorityTotal: number;
    }
  >();
  for (const project of projects)
    for (const contractor of project.contractors) {
      const key = normalise(contractor);
      const item = contractorMap.get(key) || {
        contractor,
        projectIds: new Set<string>(),
        locations: new Set<string>(),
        stages: new Set<string>(),
        equipment: new Set<string>(),
        highPriority: 0,
        priorityTotal: 0,
      };
      if (!item.projectIds.has(project.id)) {
        item.projectIds.add(project.id);
        item.priorityTotal += project.bdmPriority;
        if (project.priorityBand === 'HIGH') item.highPriority += 1;
      }
      item.locations.add(project.location);
      item.stages.add(project.stageLabel);
      project.equipmentPrediction.classes.forEach((value) =>
        item.equipment.add(value),
      );
      contractorMap.set(key, item);
    }
  const contractorWorkload = [...contractorMap.values()]
    .map((item) => ({
      contractor: item.contractor,
      projectCount: item.projectIds.size,
      highPriorityProjects: item.highPriority,
      averagePriority: item.projectIds.size
        ? Math.round(item.priorityTotal / item.projectIds.size)
        : 0,
      locations: [...item.locations],
      stages: [...item.stages],
      predictedEquipment: [...item.equipment],
    }))
    .sort(
      (a, b) =>
        b.projectCount - a.projectCount ||
        b.averagePriority - a.averagePriority,
    )
    .slice(0, 40);

  const clusterMap = new Map<
    string,
    {
      location: string;
      equipmentClass: string;
      projects: Set<string>;
      priorityTotal: number;
      confidenceTotal: number;
    }
  >();
  for (const project of projects)
    for (const equipmentClass of project.equipmentPrediction.classes) {
      const key = `${normalise(project.location)}|${equipmentClass}`;
      const item = clusterMap.get(key) || {
        location: project.location,
        equipmentClass,
        projects: new Set<string>(),
        priorityTotal: 0,
        confidenceTotal: 0,
      };
      if (!item.projects.has(project.id)) {
        item.projects.add(project.id);
        item.priorityTotal += project.bdmPriority;
        item.confidenceTotal += project.equipmentPrediction.confidence;
      }
      clusterMap.set(key, item);
    }
  const equipmentClusters = [...clusterMap.values()]
    .map((item) => ({
      label: 'PREDICTED' as const,
      location: item.location,
      equipmentClass: item.equipmentClass,
      projectCount: item.projects.size,
      averagePriority: Math.round(item.priorityTotal / item.projects.size),
      confidence: Math.round(item.confidenceTotal / item.projects.size),
      projectIds: [...item.projects],
    }))
    .sort(
      (a, b) =>
        b.projectCount * b.averagePriority - a.projectCount * a.averagePriority,
    )
    .slice(0, 40);
  const fleetPositioning = equipmentClusters
    .filter(
      (cluster) => cluster.projectCount >= 2 || cluster.averagePriority >= 65,
    )
    .slice(0, 15)
    .map((cluster) => ({
      ...cluster,
      recommendation: `PREDICTED watch: review ${cluster.equipmentClass} fleet availability for ${cluster.location}; verify actual hire requirements before moving assets.`,
      demandIndex: clamp(
        Math.round(
          cluster.averagePriority * 0.75 +
            Math.min(25, cluster.projectCount * 5),
        ),
        0,
        100,
      ),
    }));

  const deciles = Array.from({ length: 10 }, (_, index) => ({
    decile: index + 1,
    reviewed: 0,
    confirmed: 0,
    quoted: 0,
    won: 0,
    falsePositive: 0,
  }));
  const { groups, unmatched } = groupReviewedOutcomes(projects, outcomes);
  const linkedRealOutcomes = groups.length;
  const unmatchedRealOutcomes = unmatched;
  for (const { project, results } of groups) {
    const decile = clamp(Math.floor(project.bdmPriority / 10) + 1, 1, 10);
    const bucket = deciles[decile - 1];
    bucket.reviewed += 1;
    if (
      ['REQUIREMENT_CONFIRMED', 'QUOTED', 'WON'].some((result) =>
        results.has(result),
      )
    )
      bucket.confirmed += 1;
    if (results.has('QUOTED') || results.has('WON')) bucket.quoted += 1;
    if (results.has('WON')) bucket.won += 1;
    if (results.has('FALSE_POSITIVE')) bucket.falsePositive += 1;
  }

  const sourceCoverage = [...new Set(sources.map((source) => source.territory))]
    .sort()
    .map((territory) => ({
      territory,
      feedCount: sources.filter((source) => source.territory === territory)
        .length,
      sectors: [
        ...new Set(
          sources
            .filter((source) => source.territory === territory)
            .map((source) => source.sector),
        ),
      ].sort(),
    }));
  const scopeProgram = [
    {
      from: 2001,
      to: 2020,
      name: 'Commercial measurement & calibration',
      status: linkedRealOutcomes ? 'OPERATIONAL' : 'DATA_GATED',
      note: linkedRealOutcomes
        ? `${linkedRealOutcomes} distinct projects with genuine reviewed outcomes.`
        : 'Framework operational; genuine linked BDM outcomes are required before conversion calibration can be meaningful.',
    },
    {
      from: 2021,
      to: 2050,
      name: 'Event, transition, contractor & action intelligence',
      status: 'OPERATIONAL',
      note: 'Evidence-derived event detection, contractor workload, pilot queue and action guidance are active.',
    },
    {
      from: 2051,
      to: 2100,
      name: 'National coverage expansion',
      status: 'SOURCE_GATED',
      note: 'National ingestion framework is active; additional feeds are admitted only after licence, provenance and machine-readable access verification.',
    },
    {
      from: 2101,
      to: 2130,
      name: 'Proprietary outcome learning',
      status: linkedRealOutcomes >= 20 ? 'OPERATIONAL' : 'DATA_GATED',
      note:
        linkedRealOutcomes >= 20
          ? 'Outcome calibration has enough linked observations to begin comparison.'
          : 'Requires a larger genuine outcome sample; no synthetic performance history is generated.',
    },
    {
      from: 2131,
      to: 2150,
      name: 'Equipment demand & fleet-positioning decision layer',
      status: 'OPERATIONAL',
      note: 'Regional equipment clusters and fleet-positioning watch recommendations are active and explicitly PREDICTED.',
    },
  ];

  return {
    implementedThrough: 2150,
    scopeCount: 150,
    pilotQueue,
    events,
    contractorWorkload,
    equipmentClusters,
    fleetPositioning,
    calibration: {
      linkedRealOutcomes,
      unmatchedRealOutcomes,
      sufficientSample: linkedRealOutcomes >= 20,
      priorityDeciles: deciles,
    },
    sourceCoverage,
    scopeProgram,
  };
}
