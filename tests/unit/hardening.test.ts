import { describe, expect, it, vi } from 'vitest';
import { aggregateOutcomeFunnel, evidenceTimestamp, extractSourceDate, groupCanonicalEvidence, inferOrganisation } from '../../backend/domain-hardening';

const storage = vi.hoisted(() => ({ list: vi.fn(async () => ({ items: [], nextToken: undefined })), add: vi.fn(async () => []), update: vi.fn(async () => []) }));
vi.mock('@appdeploy/sdk', () => ({ db: storage }));
import { buildProjectIntelligence } from '../../backend/intelligence';

const evidence = (sourceKey: string, externalId: string, project: string, location = 'Pilbara WA') => ({ sourceKey, externalId, project, location });

describe('canonical evidence integrity', () => {
  it('keeps distinct localities separate', () => {
    const groups = groupCanonicalEvidence([evidence('a', '1', 'Bridge Street Upgrade', 'Perth WA'), evidence('b', '2', 'Bridge Street Upgrade', 'Albany WA')]);
    expect(groups.size).toBe(2);
  });
  it('produces the same identity when evidence order changes', () => {
    const rows = [evidence('a', '1', 'West Angelas Project'), evidence('b', '2', 'West Angelas sustaining works')];
    expect([...groupCanonicalEvidence(rows).keys()]).toEqual([...groupCanonicalEvidence([...rows].reverse()).keys()]);
    expect(groupCanonicalEvidence(rows).size).toBe(1);
  });
  it('retains every record when long titles share a seven-token prefix', () => {
    const rows = [evidence('a', '1', 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'), evidence('b', '2', 'alpha bravo charlie delta echo foxtrot golf kilo lima mike')];
    const groups = groupCanonicalEvidence(rows);
    expect(groups.size).toBe(2);
    expect([...groups.values()].flat()).toHaveLength(2);
  });
  it('does not give two generic projects the same legacy identity', async () => {
    storage.list.mockResolvedValue({ items: [{ id: 'legacy', projectKey: 'generic permit', sourceKey: 'a', stageLabel: 'WATCH', observedAt: '2026-09-01', stageConfidence: 0.5, reason: '' }] as never[], nextToken: undefined });
    const rows = [evidence('a', '1', 'Generic Permit', 'WA'), evidence('a', '2', 'Generic Permit', 'QLD')].map(row => ({ ...row, observedAt: '2026-09-01', sourceObservedAt: '2026-09-01', company: '', description: '', value: 'Not stated', provenance: 'QA fixture' }));
    const projects = await buildProjectIntelligence(rows, []);
    expect(new Set(projects.map(p => p.id)).size).toBe(2);
  });
});

describe('persisted project identity', () => {
  const complete = (externalId: string, location: string, project = 'Bridge Street Upgrade') => ({
    ...evidence('source', externalId, project, location), observedAt: '2026-09-01', sourceObservedAt: '2026-09-01',
    company: '', description: '', value: 'Not stated', provenance: 'QA fixture',
  });
  const snapshot = (id: string, projectKey: string, evidenceKeys: string[]) => ({
    id, projectKey, evidenceKeys, sourceKey: 'source', stageLabel: 'WATCH', observedAt: '2026-09-01', stageConfidence: 0.5, reason: '',
  });
  it('preserves a direct identity when an old group splits across locations', async () => {
    storage.list.mockResolvedValue({ items: [snapshot('existing', 'perth-wa:bridge-street-upgrade', ['source:1', 'source:2'])] as never[], nextToken: undefined });
    const projects = await buildProjectIntelligence([complete('1', 'Albany WA'), complete('2', 'Perth WA')], []);
    expect(projects.find(project => project.location === 'Perth WA')?.id).toBe('perth-wa:bridge-street-upgrade');
    expect(projects.find(project => project.location === 'Albany WA')?.id).toBe('albany-wa:bridge-street-upgrade');
    expect(new Set(projects.map(project => project.id)).size).toBe(2);
  });
  it('never emits duplicate IDs from duplicate persisted keys', async () => {
    storage.list.mockResolvedValue({ items: [snapshot('old-a', 'legacy-key', ['source:1']), snapshot('old-b', 'legacy-key', ['source:2'])] as never[], nextToken: undefined });
    const projects = await buildProjectIntelligence([complete('1', 'Albany WA'), complete('2', 'Perth WA')], []);
    expect(new Set(projects.map(project => project.id)).size).toBe(2);
  });
  it('retains the persisted ID when one source record changes its title', async () => {
    storage.list.mockResolvedValue({ items: [snapshot('old-a', 'perth-wa:bridge-street-upgrade', ['source:1'])] as never[], nextToken: undefined });
    const projects = await buildProjectIntelligence([complete('1', 'Perth WA', 'Bridge Street Upgrade Phase Two')], []);
    expect(projects[0].id).toBe('perth-wa:bridge-street-upgrade');
  });
});

describe('evidence dates and organisation roles', () => {
  it('uses the source issue date instead of a future expiry date', () => {
    expect(extractSourceDate({ expiry_date: '2035-01-01', issue_date: '2020-01-01' }, '2026-09-16')).toBe('2020-01-01T00:00:00.000Z');
  });
  it('does not treat spreadsheet serials or collection time as source freshness', () => {
    expect(extractSourceDate({ issue_date: 45000 }, '2026-09-16')).toBe('');
    expect(evidenceTimestamp({ ...evidence('a', '1', 'Unknown date'), sourceObservedAt: '', observedAt: '2026-09-16' })).toBe(0);
  });
  it('finds a valid issue date after an invalid unrelated date', () => {
    expect(extractSourceDate({ date: 'not a date', issue_date: '2020-02-01' }, '2026-09-16')).toBe('2020-02-01T00:00:00.000Z');
  });
  it('requires an explicit named delivery role', () => {
    expect(inferOrganisation('qld-contract-disclosure', { company: 'Example Agency' }).role).toBe('UNKNOWN');
    expect(inferOrganisation('a', { contractor_count: 2, contractor_name: 'Delivery Co' })).toEqual({ name: 'Delivery Co', role: 'DELIVERY_CONTRACTOR' });
    expect(inferOrganisation('a', { contractor_name: 'Delivery Co' }).role).toBe('DELIVERY_CONTRACTOR');
  });
  it('counts each project once through a CRM lifecycle', () => {
    const rows = ['CONTACTED', 'QUOTED', 'WON'].map(result => ({ projectId: 'p1', project: 'QA project', result, qa: false, quoteValue: 1000, wonValue: result === 'WON' ? 900 : 0 }));
    expect(aggregateOutcomeFunnel(rows as never).contacted).toBe(1);
    expect(aggregateOutcomeFunnel(rows as never).quotedValue).toBe(1000);
  });
});
