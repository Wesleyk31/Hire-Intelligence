import { describe, expect, it } from 'vitest';
import { groupCanonicalEvidence, type EvidenceLike } from '../../backend/domain-hardening';

// Frozen exhaustive algorithm from the pre-optimization domain-hardening implementation.
// Kept only as a differential oracle; production must not import this reference.
const stopWords = new Set(['project', 'projects', 'development', 'developments', 'works', 'work', 'stage', 'phase', 'package', 'contract', 'permit', 'approval', 'application', 'authority', 'roadworks', 'roadwork', 'mine', 'mining', 'the', 'and', 'for', 'of', 'at', 'in', 'to', 'pty', 'ltd', 'limited', 'australia', 'australian']);
const normal = (value: string) => value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const tokensFor = (value: string) => normal(value).split(' ').filter(token => token.length > 2 && !stopWords.has(token));
function locationFor(location: string) {
  let value = normal(location);
  for (const [name, code] of Object.entries({ 'western australia': 'wa', 'queensland': 'qld', 'new south wales': 'nsw', 'victoria': 'vic', 'south australia': 'sa', 'northern territory': 'nt', 'tasmania': 'tas', 'australian capital territory': 'act' })) value = value.replace(name, code);
  return value.split(' ').filter(Boolean).join('-') || 'unknown';
}
function exhaustive(records: EvidenceLike[]) {
  const groups: Array<{ key: string; location: string; tokens: string[]; rows: EvidenceLike[] }> = [];
  const ordered = [...records].sort((a, b) => tokensFor(a.project).length - tokensFor(b.project).length || normal(a.project).localeCompare(normal(b.project)) || `${a.sourceKey}:${a.externalId}`.localeCompare(`${b.sourceKey}:${b.externalId}`));
  for (const record of ordered) {
    const tokens = tokensFor(record.project), location = locationFor(record.location);
    if (tokens.length < 2) { groups.push({ key: `${record.sourceKey}:${record.externalId}`, location, tokens, rows: [record] }); continue; }
    let best: typeof groups[number] | undefined, bestScore = 0;
    for (const group of groups) {
      if (group.location !== location || group.tokens.length < 2) continue;
      const a = new Set(tokens), b = new Set(group.tokens);
      const intersect = [...a].filter(item => b.has(item)).length, union = new Set([...a, ...b]).size;
      const score = union ? intersect / union : 0;
      const overlap = tokens.filter(token => group.tokens.includes(token)).length / Math.max(1, Math.min(tokens.length, group.tokens.length));
      const combined = Math.max(score, overlap);
      if (combined > bestScore) { best = group; bestScore = combined; }
    }
    if (best && bestScore >= 0.8) { best.rows.push(record); best.tokens = [...new Set([...best.tokens, ...tokens])]; continue; }
    groups.push({ key: `${location}:${[...new Set(tokens)].sort().join('-')}`, location, tokens, rows: [record] });
  }
  const result = new Map<string, EvidenceLike[]>();
  for (const group of groups) result.set(group.key, [...(result.get(group.key) || []), ...group.rows]);
  return result;
}
const evidence = (externalId: string, project: string, location = 'Perth WA'): EvidenceLike => ({ sourceKey: 'synthetic', externalId, project, location });
const snapshot = (groups: Map<string, EvidenceLike[]>) => [...groups].map(([key, rows]) => [key, rows.map(row => [row.sourceKey, row.externalId, row.project, row.location])]);

describe('canonical grouping candidate index', () => {
  it('preserves insertion-order tie breaking when another group is found through the first token', () => {
    const rows = [evidence('a', 'alpha beta gamma delta epsilon'), evidence('b', 'alpha beta gamma theta zeta'), evidence('tie', 'zeta alpha beta gamma delta bridge')];
    const grouped = groupCanonicalEvidence(rows);
    expect([...grouped.values()].map(group => group.map(row => row.externalId))).toEqual([['a', 'tie'], ['b']]);
    expect(snapshot(grouped)).toEqual(snapshot(exhaustive(rows)));
  });

  it('finds a later match through tokens added by an earlier title expansion', () => {
    const additions = 'newone newtwo newthree newfour newfive newsix newseven neweight newnine newten';
    const rows = [evidence('short', 'alpha beta'), evidence('expanded', 'alpha beta ' + additions), evidence('later', additions + ' later extra')];
    const grouped = groupCanonicalEvidence(rows);
    expect(grouped.size).toBe(1);
    expect([...grouped.values()][0].map(row => row.externalId)).toEqual(['short', 'expanded', 'later']);
    expect(snapshot(grouped)).toEqual(snapshot(exhaustive(rows)));
  });

  it('preserves short names, zero-token groups, repeated tokens and location aliases', () => {
    const rows = [evidence('empty', 'The project'), evidence('empty', 'The project'), evidence('generic', 'Upgrade'), evidence('one', 'alpha alpha beta beta'), evidence('two', 'alpha gamma'), evidence('three', 'alpha beta delta', 'Perth Western Australia'), evidence('elsewhere', 'alpha beta delta', 'Albany WA')];
    expect(snapshot(groupCanonicalEvidence(rows))).toEqual(snapshot(exhaustive(rows)));
    expect([...groupCanonicalEvidence(rows).values()].flat()).toHaveLength(7);
  });

  it('matches exhaustive keys and memberships across deterministic adversarial title mixtures', () => {
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'theta', 'iota', 'kappa', 'lambda', 'project', 'mine', 'stage'];
    for (let seed = 1; seed <= 20; seed++) {
      let state = seed;
      const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
      const rows = Array.from({ length: 150 }, (_, index) => evidence(String(index), Array.from({ length: 1 + random() % 12 }, () => words[random() % words.length]).join(' '), ['Perth WA', 'Perth Western Australia', 'Albany WA', 'Hunter NSW', ''][random() % 5]));
      const before = JSON.stringify(rows);
      expect(snapshot(groupCanonicalEvidence(rows))).toEqual(snapshot(exhaustive(rows)));
      expect(snapshot(groupCanonicalEvidence([...rows].reverse()))).toEqual(snapshot(exhaustive([...rows].reverse())));
      expect(JSON.stringify(rows)).toBe(before);
    }
  });
});

it('stops fuzzy matching a group when a merge reduces repeated tokens to one token', () => {
  const rows = [evidence('a', 'alpha alpha'), evidence('b', 'alpha alpha'), evidence('c', 'alpha beta beta')];
  const grouped = groupCanonicalEvidence(rows);
  expect(grouped.size).toBe(2);
  expect([...grouped.values()].map(group => group.map(row => row.externalId))).toEqual([['a', 'b'], ['c']]);
  expect(snapshot(grouped)).toEqual(snapshot(exhaustive(rows)));
});
