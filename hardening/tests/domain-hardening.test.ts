import {
  aggregateOutcomeFunnel,
  chooseCurrentStage,
  groupCanonicalEvidence,
  inferOrganisation,
  isCallNowCandidate,
  uniqueProjectMapStats,
  validateDemoRequest,
} from '../backend/domain-hardening.js';

function equal<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function deepEqual(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const groups = groupCanonicalEvidence([
  { sourceKey: 'a', externalId: '1', project: 'West Angelas Project', location: 'Pilbara WA' },
  { sourceKey: 'b', externalId: '2', project: 'West Angelas sustaining works', location: 'Pilbara WA' },
  { sourceKey: 'c', externalId: '3', project: 'Generic Permit', location: 'QLD' },
]);
equal(groups.size, 2, 'similar named projects in the same region should resolve together without merging unrelated records');

const stageRank: Record<string, number> = { WATCH: 0, PROCUREMENT: 2, COMPLETE: 8 };
const stage = chooseCurrentStage([
  { label: 'COMPLETE', confidence: .95, reliability: .95, observedAt: '2025-01-01T00:00:00Z' },
  { label: 'PROCUREMENT', confidence: .88, reliability: .92, observedAt: '2026-09-01T00:00:00Z' },
], stageRank);
equal(stage.label, 'PROCUREMENT', 'stale later-stage evidence must not dominate fresh current evidence');

deepEqual(inferOrganisation('qld-environmental-authorities', { applicant: 'Example Resources' }), { name: 'Example Resources', role: 'APPLICANT_HOLDER' }, 'environmental applicant role');
deepEqual(inferOrganisation('qld-contract-disclosure', { supplier: 'Civil Delivery Pty Ltd' }), { name: 'Civil Delivery Pty Ltd', role: 'SUPPLIER' }, 'contract supplier role');

const funnel = aggregateOutcomeFunnel([
  { projectId: 'p1', project: 'P1', result: 'CONTACTED', qa: false },
  { projectId: 'p1', project: 'P1', result: 'QUOTED', quoteValue: 1000, qa: false },
  { projectId: 'p1', project: 'P1', result: 'WON', quoteValue: 1000, wonValue: 900, qa: false },
]);
equal(funnel.contacted, 1, 'one project moving through three outcomes must be one contacted lead');
equal(funnel.quoteConversion, '100%', 'quote conversion');
equal(funnel.leadToHire, '100%', 'lead to hire');
equal(funnel.quotedValue, 1000, 'quote value must not be double counted across outcome history');

equal(isCallNowCandidate({ stageLabel: 'MOBILISATION', bdmPriority: 88, signalQualityBand: 'A', freshnessScore: 90, contractorConfidence: 85, contractors: ['Delivery Co'], equipmentPrediction: { classes: ['Excavators'], confidence: 75 } }), true, 'qualified mobilisation should be call now');
equal(isCallNowCandidate({ stageLabel: 'APPROVAL', bdmPriority: 95, signalQualityBand: 'A', freshnessScore: 95, contractorConfidence: 90, contractors: ['Delivery Co'], equipmentPrediction: { classes: ['Excavators'], confidence: 80 } }), false, 'approval-only project must not be call now');

const stats = uniqueProjectMapStats([
  { projectId: 'p1', priority: 90, equipment: ['Excavators'] },
  { projectId: 'p1', priority: 90, equipment: ['Excavators'] },
  { projectId: 'p2', priority: 70, equipment: ['Excavators', 'Graders'] },
]);
equal(stats.projectCount, 2, 'unique map project count');
equal(stats.highCount, 1, 'unique high priority count');
deepEqual(stats.equipmentSummary, [['Excavators', 2], ['Graders', 1]], 'equipment summary must count projects, not event points');

equal(validateDemoRequest({ name: 'A', company: 'B', email: 'bad' }).ok, false, 'invalid demo request');
equal(validateDemoRequest({ name: 'Alex', company: 'Rental Co', email: 'alex@example.com' }).ok, true, 'valid demo request');
console.log('domain-hardening tests passed');
