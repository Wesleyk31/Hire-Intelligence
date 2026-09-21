import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isDatabaseQuotaError } from './archive-storage';
import {
  db,
  error,
  json,
  secrets,
  type RouterContext,
  type RouterMiddleware,
  type RouterResponse,
  type RouterRoutes,
} from '@appdeploy/sdk';

type OwnerConfig = {
  version: 1;
  username: string;
  ownerId: string;
  salt: string;
  passwordHash: string;
};
type Owner = { userId: string; name: string };
type OwnerRequest = { method: 'GET' | 'POST'; path: string; body?: unknown };
type SessionRecord = {
  version: 1;
  ownerId: string;
  fingerprint: string;
  expiresAt: string;
  revoked: boolean;
};
type AttemptRecord = { version: 1; bucket: number; count: number };
type Dependencies = {
  dispatch: (
    ctx: RouterContext,
    owner: Owner,
    request: OwnerRequest,
  ) => Promise<RouterResponse>;
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const privateResponse = (response: RouterResponse): RouterResponse => ({
  ...response,
  headers: { ...response.headers, 'Cache-Control': 'no-store' },
});
class AccessFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const unavailable = () => new AccessFailure(503, 'Owner access unavailable');
const unauthorized = () => new AccessFailure(401, 'Unauthorized');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AccessFailure(400, 'Invalid request');
  return value as Record<string, unknown>;
}

async function readConfig(): Promise<OwnerConfig> {
  const raw = await secrets.readSecret('HIRER_OWNER_ACCESS');
  if (typeof raw !== 'string' || raw.length > 2048) throw unavailable();
  let value: Record<string, unknown>;
  try {
    value = object(JSON.parse(raw));
  } catch {
    throw unavailable();
  }
  if (
    value.version !== 1 ||
    typeof value.username !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.username) ||
    typeof value.ownerId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.ownerId,
    ) ||
    typeof value.salt !== 'string' ||
    !/^[0-9a-f]{32}$/.test(value.salt) ||
    typeof value.passwordHash !== 'string' ||
    !/^[0-9a-f]{128}$/.test(value.passwordHash)
  )
    throw unavailable();
  return {
    version: 1,
    username: value.username,
    ownerId: value.ownerId,
    salt: value.salt,
    passwordHash: value.passwordHash,
  };
}

const fingerprint = (config: OwnerConfig) => sha256(JSON.stringify(config));
const identity = (config: OwnerConfig): Owner => ({
  userId: config.ownerId,
  name: config.username,
});

async function singleton<T>(
  table: string,
): Promise<(Omit<T, 'id'> & { id: string }) | undefined> {
  const page = await db.list<T>(table, { limit: 2 });
  if (page.items.length > 1 || page.nextToken) throw unavailable();
  return page.items[0];
}

async function save(
  table: string,
  record: Record<string, unknown>,
  id?: string,
) {
  if (id) {
    const ack = await db.update(table, [{ id, record }]);
    if (ack.length !== 1 || ack[0] !== true) throw unavailable();
  } else {
    const ack = await db.add(table, [record]);
    if (ack.length !== 1 || typeof ack[0] !== 'string' || !ack[0])
      throw unavailable();
  }
}

async function reserveAttempt(ctx: RouterContext) {
  // Only gateway-populated identity is trusted; caller headers never select a budget.
  const source =
    ctx.event?.requestContext?.http?.sourceIp ??
    ctx.event?.requestContext?.identity?.sourceIp;
  const address =
    typeof source === 'string' && source.length <= 128 ? source : 'unknown';
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const table = `owner_attempt:${sha256(`${address}:${bucket}`)}`;
  const existing = await singleton<AttemptRecord>(table);
  if (
    existing &&
    (existing.version !== 1 ||
      existing.bucket !== bucket ||
      !Number.isSafeInteger(existing.count) ||
      existing.count < 1)
  )
    throw unavailable();
  if (existing && existing.count >= 10)
    throw new AccessFailure(429, 'Too many sign-in attempts. Try again later.');
  // SDK has no compare-and-swap: concurrent updates can lose increments. This is
  // a durable best-effort budget, not an atomic distributed rate limiter.
  await save(
    table,
    { version: 1, bucket, count: (existing?.count ?? 0) + 1 },
    existing?.id,
  );
  const persisted = await singleton<AttemptRecord>(table);
  if (!persisted || persisted.count < (existing?.count ?? 0) + 1)
    throw unavailable();
}

async function passwordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(salt, 'hex'),
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

async function verifiedSession(body: Record<string, unknown>) {
  const config = await readConfig();
  if (
    typeof body.session !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(body.session)
  )
    throw unauthorized();
  const table = `owner_session:${sha256(body.session)}`;
  const record = await singleton<SessionRecord>(table);
  if (
    !record ||
    record.version !== 1 ||
    record.revoked !== false ||
    record.ownerId !== config.ownerId ||
    record.fingerprint !== fingerprint(config) ||
    typeof record.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    Date.parse(record.expiresAt) <= Date.now()
  )
    throw unauthorized();
  return { config, record, table };
}

function protectedHandler(
  handler: (ctx: RouterContext) => Promise<RouterResponse>,
): RouterMiddleware {
  return async (ctx) => {
    try {
      return privateResponse(await handler(ctx));
    } catch (cause) {
      // Never expose or log secret values, tokens or raw dependency errors.
      if (!(cause instanceof AccessFailure) && isDatabaseQuotaError(cause))
        return privateResponse(
          json(
            {
              error: 'Owner access temporarily unavailable',
              code: 'AppDatabaseQuotaExceeded',
            },
            429,
          ),
        );
      const failure = cause instanceof AccessFailure ? cause : unavailable();
      return privateResponse(error(failure.message, failure.status));
    }
  };
}

/** These routes use the application's private owner credential policy, not SDK OAuth. */
export function createOwnerAccessRoutes(deps: Dependencies): RouterRoutes {
  return {
    'POST /api/owner/login': [
      protectedHandler(async (ctx) => {
        const body = object(ctx.body);
        if (
          typeof body.username !== 'string' ||
          body.username.length < 1 ||
          body.username.length > 64 ||
          typeof body.password !== 'string' ||
          body.password.length < 1 ||
          body.password.length > 256 ||
          typeof body.remember !== 'boolean'
        )
          throw new AccessFailure(400, 'Invalid request');
        const config = await readConfig();
        await reserveAttempt(ctx);
        // Derive for all validly shaped attempts, including unknown usernames.
        const actual = await passwordKey(body.password, config.salt);
        const passwordMatches = timingSafeEqual(
          actual,
          Buffer.from(config.passwordHash, 'hex'),
        );
        const usernameMatches = timingSafeEqual(
          Buffer.from(sha256(body.username), 'hex'),
          Buffer.from(sha256(config.username), 'hex'),
        );
        if (!passwordMatches || !usernameMatches) throw unauthorized();
        const session = randomBytes(32).toString('base64url');
        const table = `owner_session:${sha256(session)}`;
        if (await singleton<SessionRecord>(table)) throw unavailable();
        const expiresAt = new Date(
          Date.now() + (body.remember ? 30 * 24 : 12) * 60 * 60 * 1000,
        ).toISOString();
        const record: SessionRecord = {
          version: 1,
          ownerId: config.ownerId,
          fingerprint: fingerprint(config),
          expiresAt,
          revoked: false,
        };
        await save(table, record);
        const persisted = await singleton<SessionRecord>(table);
        if (
          !persisted ||
          persisted.ownerId !== record.ownerId ||
          persisted.fingerprint !== record.fingerprint ||
          persisted.expiresAt !== record.expiresAt ||
          persisted.revoked !== false ||
          persisted.version !== 1
        )
          throw unavailable();
        return json({ user: identity(config), session, expiresAt });
      }),
    ],
    'POST /api/owner/session': [
      protectedHandler(async (ctx) => {
        const { config, record } = await verifiedSession(object(ctx.body));
        return json({ user: identity(config), expiresAt: record.expiresAt });
      }),
    ],
    'POST /api/owner/logout': [
      protectedHandler(async (ctx) => {
        const { record, table } = await verifiedSession(object(ctx.body));
        const { id, ...data } = record;
        await save(table, { ...data, revoked: true }, id);
        const persisted = await singleton<SessionRecord>(table);
        if (!persisted || persisted.revoked !== true) throw unavailable();
        return json({ ok: true });
      }),
    ],
    'POST /api/owner/request': [
      protectedHandler(async (ctx) => {
        const body = object(ctx.body);
        const { config } = await verifiedSession(body);
        if (
          (body.method !== 'GET' && body.method !== 'POST') ||
          typeof body.path !== 'string' ||
          body.path.length > 40000 ||
          !/^\/api\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\?[^#\\\s]*)?$/.test(
            body.path,
          )
        )
          throw new AccessFailure(400, 'Invalid request');
        let serialized: string;
        try {
          serialized = JSON.stringify(body.body ?? null);
        } catch {
          throw new AccessFailure(400, 'Invalid request');
        }
        if (Buffer.byteLength(serialized, 'utf8') > 128 * 1024)
          throw new AccessFailure(400, 'Invalid request');
        // The application dispatch function owns the strict business-route allowlist.
        return deps.dispatch(ctx, identity(config), {
          method: body.method,
          path: body.path,
          body: body.body,
        });
      }),
    ],
  };
}

/** Direct business routes cannot authorize via a caller-supplied owner or OAuth user. */
export const denyDirectOwnerAccess: RouterMiddleware = () =>
  privateResponse(error('Unauthorized', 401));
