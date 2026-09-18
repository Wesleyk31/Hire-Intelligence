import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  verifyAutomationToken,
  assertAutomationJob,
} from '../../backend/automation-auth';

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = {
  ...pair.publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
const now = 1790000000000;
const base = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'hirer-intelligence-production',
  sub: 'repo:Wesleyk31/Hire-Intelligence:ref:refs/heads/main',
  repository: 'Wesleyk31/Hire-Intelligence',
  repository_id: '1371025079',
  repository_owner_id: '323393251',
  ref: 'refs/heads/main',
  event_name: 'schedule',
  sha: 'a'.repeat(40),
  workflow_ref:
    'Wesleyk31/Hire-Intelligence/.github/workflows/source-health.yml@refs/heads/main',
  run_id: '123',
  run_attempt: '1',
  iat: now / 1000,
  nbf: now / 1000,
  exp: now / 1000 + 300,
};
const fakeFetch = (async () =>
  new Response(JSON.stringify({ keys: [key] }), {
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
function token(changes = {}, header = {}) {
  const head = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key', ...header }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...base, ...changes })).toString(
    'base64url',
  );
  return (
    head +
    '.' +
    body +
    '.' +
    sign(
      'RSA-SHA256',
      Buffer.from(head + '.' + body),
      pair.privateKey,
    ).toString('base64url')
  );
}
const verify = (value: string) =>
  verifyAutomationToken(value, { fetcher: fakeFetch, now: () => now });
describe('production automation identity boundary', () => {
  it('accepts cryptographically verified main workflow and immutable repository subject', async () => {
    const identity = await verify(token());
    expect(identity.runId).toBe('123');
    expect(identity.workflow).toBe('source-health.yml');
    await expect(
      verify(
        token({
          sub: 'repo:Wesleyk31@323393251/Hire-Intelligence@1371025079:ref:refs/heads/main',
        }),
      ),
    ).resolves.toBeTruthy();
  });
  it.each([
    { repository_id: '999' },
    { repository_owner_id: '999' },
    { ref: 'refs/heads/dev' },
    { sub: 'repo:attacker/Hire-Intelligence:ref:refs/heads/main' },
    { aud: 'different' },
    { iss: 'https://attacker.test' },
    { exp: now / 1000 - 60 },
    { iat: now / 1000 + 200 },
    { event_name: 'pull_request' },
    {
      workflow_ref:
        'Wesleyk31/Hire-Intelligence/.github/workflows/untrusted.yml@refs/heads/main',
    },
  ])('rejects untrusted claims %j', async (changes) => {
    await expect(verify(token(changes))).rejects.toThrow();
  });
  it('rejects invalid signatures, wrong algorithms and missing credentials', async () => {
    await expect(
      verify(token().slice(0, -20) + 'bad-signature'),
    ).rejects.toThrow();
    await expect(verify(token({}, { alg: 'HS256' }))).rejects.toThrow();
    await expect(verify('')).rejects.toThrow();
  });
  it('binds write operation and reported run/commit to signed identity', async () => {
    const identity = await verify(token());
    expect(() =>
      assertAutomationJob(identity, {
        job: 'source-health',
        runId: '123',
        runAttempt: '1',
        commitSha: base.sha,
      }),
    ).not.toThrow();
    expect(() =>
      assertAutomationJob(identity, {
        job: 'historical-backfill',
        runId: '123',
        runAttempt: '1',
        commitSha: base.sha,
      }),
    ).toThrow();
    expect(() =>
      assertAutomationJob(identity, {
        job: 'source-health',
        runId: '456',
        runAttempt: '1',
        commitSha: base.sha,
      }),
    ).toThrow();
    expect(() =>
      assertAutomationJob(identity, {
        job: 'source-health',
        runId: '123',
        runAttempt: '1',
        commitSha: 'b'.repeat(40),
      }),
    ).toThrow();
  });
});
