import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import {
  error,
  type RouterContext,
  type RouterMiddleware,
} from '@appdeploy/sdk';

export const AUTOMATION_REPOSITORY = 'Wesleyk31/Hire-Intelligence';
export const AUTOMATION_AUDIENCE = 'hirer-intelligence-production';
const ISSUER = 'https://token.actions.githubusercontent.com';
const REF = 'refs/heads/main';
const WORKFLOW_JOBS: Record<string, readonly string[]> = {
  'live-source-refresh.yml': ['live-refresh'],
  'source-health.yml': ['source-health'],
  'historical-backfill.yml': ['historical-backfill'],
  'source-validation.yml': ['source-validation'],
  'deployment-qa.yml': ['deployment-qa', 'e2e'],
  'workflow-watchdog.yml': ['workflow-watchdog'],
};
export type AutomationIdentity = {
  workflow: string;
  runId: string;
  runAttempt: string;
  commitSha: string;
};
type SigningKey = JsonWebKey & { kid?: string; alg?: string; use?: string };
let cachedKeys: { keys: SigningKey[]; expires: number } | undefined;
const contexts = new WeakMap<object, AutomationIdentity>();

function denied(): never {
  throw new Error('AUTOMATION_IDENTITY_REJECTED');
}
function part(value: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return denied();
  const result: unknown = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  );
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return denied();
  return result as Record<string, unknown>;
}

/** Trust only GitHub's signed identity for this exact repository, main and named workflow. */
export async function verifyAutomationToken(
  token: string,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<AutomationIdentity> {
  if (typeof token !== 'string' || token.length < 100 || token.length > 16384)
    return denied();
  const segments = token.split('.');
  if (segments.length !== 3) return denied();
  const [encodedHeader, encodedBody, encodedSignature] = segments;
  const header = part(encodedHeader),
    claims = part(encodedBody);
  if (
    header.alg !== 'RS256' ||
    header.typ !== 'JWT' ||
    typeof header.kid !== 'string' ||
    !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
  )
    return denied();
  const now = (options.now || Date.now)();
  const seconds = now / 1000;
  if (
    claims.iss !== ISSUER ||
    claims.aud !== AUTOMATION_AUDIENCE ||
    claims.repository !== AUTOMATION_REPOSITORY ||
    claims.repository_id !== '1371025079' ||
    claims.repository_owner_id !== '323393251' ||
    claims.ref !== REF ||
    !['schedule', 'workflow_dispatch', 'push', 'deployment_status'].includes(
      String(claims.event_name),
    ) ||
    ![
      `repo:${AUTOMATION_REPOSITORY}:ref:${REF}`,
      `repo:Wesleyk31@323393251/Hire-Intelligence@1371025079:ref:${REF}`,
    ].includes(String(claims.sub)) ||
    typeof claims.exp !== 'number' ||
    typeof claims.iat !== 'number' ||
    typeof claims.nbf !== 'number' ||
    claims.exp <= seconds ||
    claims.nbf > seconds + 30 ||
    claims.iat > seconds + 30 ||
    claims.iat < seconds - 900 ||
    claims.exp - claims.iat > 900 ||
    !/^\d{1,20}$/.test(String(claims.run_id)) ||
    !/^\d{1,6}$/.test(String(claims.run_attempt)) ||
    !/^[a-f0-9]{40}$/.test(String(claims.sha))
  )
    return denied();
  const workflow = Object.keys(WORKFLOW_JOBS).find(
    (file) =>
      claims.workflow_ref ===
      `${AUTOMATION_REPOSITORY}/.github/workflows/${file}@${REF}`,
  );
  if (!workflow) return denied();
  const fetcher = options.fetcher || fetch;
  let keys =
    !options.fetcher && cachedKeys && cachedKeys.expires > now
      ? cachedKeys.keys
      : undefined;
  if (!keys?.some((key) => key.kid === header.kid)) {
    const response = await fetcher(ISSUER + '/.well-known/jwks', {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('json'))
      return denied();
    const body = await response.text();
    if (body.length > 65536) return denied();
    const parsed = JSON.parse(body) as { keys?: SigningKey[] };
    if (!Array.isArray(parsed.keys) || parsed.keys.length > 30) return denied();
    keys = parsed.keys;
    if (!options.fetcher) cachedKeys = { keys, expires: now + 300000 };
  }
  const key = keys.find(
    (item) =>
      item.kid === header.kid &&
      item.kty === 'RSA' &&
      (!item.alg || item.alg === 'RS256') &&
      (!item.use || item.use === 'sig'),
  );
  if (
    !key ||
    !verify(
      'RSA-SHA256',
      Buffer.from(encodedHeader + '.' + encodedBody),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    )
  )
    return denied();
  return {
    workflow,
    runId: String(claims.run_id),
    runAttempt: String(claims.run_attempt),
    commitSha: String(claims.sha),
  };
}

export function assertAutomationJob(
  identity: AutomationIdentity,
  request: Record<string, unknown>,
) {
  if (
    !WORKFLOW_JOBS[identity.workflow]?.includes(String(request.job)) ||
    String(request.runId) !== identity.runId ||
    String(request.runAttempt) !== identity.runAttempt ||
    request.commitSha !== identity.commitSha
  )
    return denied();
}
export const requireAutomation: RouterMiddleware = async (ctx) => {
  try {
    const headers = ctx.event?.headers as Record<string, unknown> | undefined;
    const token = Object.entries(headers || {}).find(
      ([key]) => key.toLowerCase() === 'x-hirer-automation-token',
    )?.[1];
    if (typeof token !== 'string')
      return error('Automation identity required', 401);
    contexts.set(ctx, await verifyAutomationToken(token));
  } catch {
    return error('Automation identity rejected', 401);
  }
};
export function automationIdentity(ctx: RouterContext) {
  const identity = contexts.get(ctx);
  if (!identity) return denied();
  return identity;
}
