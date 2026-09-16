import { normalise } from './domain-hardening';

type ReviewedOutcome = { projectId?: string; project: string; result: string; qa: boolean };
type NamedProject = { id: string; name: string };
const reviewed = new Set(['REQUIREMENT_CONFIRMED', 'QUOTED', 'WON', 'LOST', 'FALSE_POSITIVE']);

// Calibration samples represent distinct projects, not repeated CRM activity on the same project.
export function groupReviewedOutcomes<P extends NamedProject>(projects: P[], outcomes: ReviewedOutcome[]) {
  const byId = new Map(projects.map(project => [project.id, project]));
  const byName = new Map<string, P[]>();
  for (const project of projects) {
    const key = normalise(project.name);
    byName.set(key, [...(byName.get(key) || []), project]);
  }
  const groups = new Map<string, { project: P; results: Set<string> }>();
  const unmatched = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.qa || !reviewed.has(outcome.result)) continue;
    const name = normalise(outcome.project);
    const matches = byName.get(name) || [];
    const project = outcome.projectId ? byId.get(outcome.projectId) : matches.length === 1 ? matches[0] : undefined;
    if (!project) { unmatched.add(outcome.projectId || name); continue; }
    const group = groups.get(project.id) || { project, results: new Set<string>() };
    group.results.add(outcome.result);
    groups.set(project.id, group);
  }
  return { groups: [...groups.values()], unmatched: unmatched.size };
}
