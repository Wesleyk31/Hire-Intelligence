import { beforeEach, expect, it, vi } from 'vitest';
import { createHash, scryptSync } from 'node:crypto';
import type { RouterContext, RouterResponse } from '@appdeploy/sdk';

// The platform database and secret store are external. Keep persistence semantics,
// generated IDs, replacement updates and acknowledgement failures in this fake.
const fixture = vi.hoisted(() => ({
  tables: new Map<string, Array<Record<string, any>>>(),
  secret: undefined as string | undefined,
  failure: '' as string,
  reads: [] as Array<{ table: string; limit: number }>,
  writes: 0,
}));
vi.mock('@appdeploy/sdk', () => ({
  secrets: {
    readSecret: async (name: string) => {
      if (name !== 'HIRER_OWNER_ACCESS') throw new Error('Unknown secret');
      return fixture.secret;
    },
  },
  json: (data: unknown, statusCode = 200) => ({
    statusCode,
    headers: {},
    body: JSON.stringify(data),
  }),
  error: (message: string, statusCode = 500) => ({
    statusCode,
    headers: {},
    body: JSON.stringify({ error: message }),
  }),
  db: {
    list: async (table: string, options: { limit: number }) => {
      fixture.reads.push({ table, limit: options.limit });
      if (fixture.failure === 'quota')
        throw Object.assign(new Error('AppDatabaseQuotaExceeded'), {
          statusCode: 429,
        });
      const rows = fixture.tables.get(table) ?? [];
      return {
        items: structuredClone(rows.slice(0, options.limit)),
        nextToken: rows.length > options.limit ? 'next' : undefined,
      };
    },
    add: async (table: string, records: Array<Record<string, any>>) => {
      fixture.writes++;
      if (
        fixture.failure === 'add' ||
        (fixture.failure === 'session' && table.startsWith('owner_session:'))
      )
        return [null];
      const rows = fixture.tables.get(table) ?? [];
      const ids = records.map((record, i) => {
        const id = `id-${rows.length + i}`;
        rows.push({ ...structuredClone(record), id });
        return id;
      });
      fixture.tables.set(table, rows);
      return ids;
    },
    update: async (
      table: string,
      items: Array<{ id: string; record: Record<string, any> }>,
    ) => {
      fixture.writes++;
      if (fixture.failure === 'update') return [false];
      const rows = fixture.tables.get(table) ?? [];
      return items.map((item) => {
        const idx = rows.findIndex((r) => r.id === item.id);
        if (idx < 0) return false;
        rows[idx] = { ...structuredClone(item.record), id: item.id };
        return true;
      });
    },
  },
}));
import {
  createOwnerAccessRoutes,
  denyDirectOwnerAccess,
} from '../../backend/owner-access';

// Synthetic credentials used solely by this regression suite.
const password = 'synthetic-owner-password';
const salt = '12'.repeat(16);
const config = {
  version: 1,
  username: 'hireowner',
  ownerId: '045a3b87-d632-4b47-aeb8-e53714fc3c6c',
  salt,
  passwordHash: scryptSync(password, Buffer.from(salt, 'hex'), 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex'),
};
const dispatch = vi.fn(
  async (
    _ctx: RouterContext,
    owner: { userId: string; name: string },
    request: unknown,
  ) => ({
    statusCode: 200,
    headers: {},
    body: JSON.stringify({ owner, request }),
  }),
);
const routes = createOwnerAccessRoutes({ dispatch });
async function call(path: string, body: unknown, sourceIp = '203.0.113.2') {
  const ctx = {
    body,
    query: {},
    params: {},
    event: { requestContext: { http: { sourceIp } } },
  } as RouterContext;
  const response = (await routes[`POST /api/owner/${path}`][0](
    ctx,
  )) as RouterResponse;
  return { ...response, data: JSON.parse(response.body) };
}
const login = (remember = false) =>
  call('login', { username: 'hireowner', password, remember });
beforeEach(() => {
  fixture.tables.clear();
  fixture.secret = JSON.stringify(config);
  fixture.failure = '';
  fixture.reads = [];
  fixture.writes = 0;
  dispatch.mockClear();
  vi.restoreAllMocks();
});

it('authenticates the configured owner and only stores a hash of an opaque session', async () => {
  const response = await login();
  expect(response.statusCode).toBe(200);
  expect(response.data.user).toEqual({
    userId: config.ownerId,
    name: 'hireowner',
  });
  expect(response.data.session).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const table = `owner_session:${createHash('sha256').update(response.data.session).digest('hex')}`;
  expect(fixture.tables.get(table)).toHaveLength(1);
  expect(JSON.stringify([...fixture.tables])).not.toContain(
    response.data.session,
  );
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(response.body).not.toContain(config.passwordHash);
  expect(response.body).not.toContain(config.salt);
  expect(fixture.reads.every((read) => read.limit === 2)).toBe(true);
});

it('rejects wrong passwords and wrong usernames identically', async () => {
  const wrongPassword = await call('login', {
    username: 'hireowner',
    password: 'wrong',
    remember: false,
  });
  const wrongUsername = await call('login', {
    username: 'another',
    password,
    remember: false,
  });
  expect(wrongPassword.statusCode).toBe(401);
  expect(wrongUsername.data).toEqual(wrongPassword.data);
  expect(
    [...fixture.tables.keys()].some((key) => key.startsWith('owner_session:')),
  ).toBe(false);
});

it.each([
  undefined,
  '{broken',
  JSON.stringify({ ...config, version: 2 }),
  JSON.stringify({ ...config, passwordHash: '00' }),
  JSON.stringify({ ...config, ownerId: 'caller' }),
])('fails closed on missing or malformed secret %s', async (secret) => {
  fixture.secret = secret;
  const response = await login();
  expect(response.statusCode).toBe(503);
  expect(response.data).toEqual({ error: 'Owner access unavailable' });
  expect(response.headers['Cache-Control']).toBe('no-store');
  expect(fixture.writes).toBe(0);
});

it('restores a session using server-owned identity and rejects a forged token', async () => {
  const created = await login();
  expect(
    (
      await call('session', {
        session: created.data.session,
        userId: 'attacker',
      })
    ).data.user,
  ).toEqual({ userId: config.ownerId, name: 'hireowner' });
  expect((await call('session', { session: 'A'.repeat(43) })).statusCode).toBe(
    401,
  );
});

it.each([false, true])(
  'expires a remember=%s session at its exact boundary',
  async (remember) => {
    const now = Date.parse('2026-09-21T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const created = await login(remember);
    const expiry = now + (remember ? 30 * 24 : 12) * 60 * 60 * 1000;
    expect(Date.parse(created.data.expiresAt)).toBe(expiry);
    vi.spyOn(Date, 'now').mockReturnValue(expiry);
    expect(
      (await call('session', { session: created.data.session })).statusCode,
    ).toBe(401);
  },
);

it('revokes previous sessions when the credential configuration rotates', async () => {
  const created = await login();
  fixture.secret = JSON.stringify({ ...config, passwordHash: '34'.repeat(64) });
  expect(
    (await call('session', { session: created.data.session })).statusCode,
  ).toBe(401);
});

it('persists logout revocation and refuses a revoked session', async () => {
  const created = await login();
  expect(
    (await call('logout', { session: created.data.session })).data,
  ).toEqual({ ok: true });
  expect(
    (await call('session', { session: created.data.session })).statusCode,
  ).toBe(401);
});

it.each(['add', 'session'])(
  'does not grant a session on %s persistence failure',
  async (failure) => {
    fixture.failure = failure;
    expect((await login()).statusCode).toBe(503);
  },
);

it('preserves quota status without exposing dependency details or retrying', async () => {
  fixture.failure = 'quota';
  const response = await login();
  expect(response.statusCode).toBe(429);
  expect(response.data).toEqual({
    error: 'Owner access temporarily unavailable',
    code: 'AppDatabaseQuotaExceeded',
  });
  expect(fixture.reads).toHaveLength(1);
});

it('forwards bounded local query strings to the strict business-route dispatcher', async () => {
  const created = await login();
  const path = '/api/dashboard?cursor=' + '%2B'.repeat(12000);
  const response = await call('request', {
    session: created.data.session,
    method: 'GET',
    path,
  });
  expect(response.statusCode).toBe(200);
  expect(response.data.request.path).toBe(path);
});

it('does not claim logout succeeded when the revocation write fails', async () => {
  const created = await login();
  fixture.failure = 'update';
  expect(
    (await call('logout', { session: created.data.session })).statusCode,
  ).toBe(503);
});

it('reserves the durable attempt budget before checking credentials and rejects the eleventh attempt', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-21T00:00:00.000Z'));
  for (let i = 0; i < 10; i++)
    expect(
      (
        await call('login', {
          username: 'wrong',
          password: 'wrong',
          remember: false,
        })
      ).statusCode,
    ).toBe(401);
  expect((await login()).statusCode).toBe(429);
  expect(
    (
      await call(
        'login',
        { username: 'hireowner', password, remember: false },
        '203.0.113.3',
      )
    ).statusCode,
  ).toBe(200);
});

it('does not bypass the attempt budget if its update cannot be acknowledged', async () => {
  await call('login', {
    username: 'wrong',
    password: 'wrong',
    remember: false,
  });
  fixture.failure = 'update';
  expect((await login()).statusCode).toBe(503);
});

it('fails closed on duplicate session or attempt records', async () => {
  const created = await login();
  for (const [table, rows] of fixture.tables)
    if (table.startsWith('owner_session:'))
      rows.push({ ...rows[0], id: 'duplicate' });
  expect(
    (await call('session', { session: created.data.session })).statusCode,
  ).toBe(503);
  for (const [table, rows] of fixture.tables)
    if (table.startsWith('owner_attempt:'))
      rows.push({ ...rows[0], id: 'duplicate' });
  expect((await login()).statusCode).toBe(503);
});

it('does not dispatch private business requests without a valid session', async () => {
  expect(
    (
      await call('request', {
        session: 'A'.repeat(43),
        method: 'GET',
        path: '/api/me',
      })
    ).statusCode,
  ).toBe(401);
  expect(dispatch).not.toHaveBeenCalled();
});

it('dispatches verified owner identity and returns the protected handler response without caching', async () => {
  const created = await login();
  const response = await call('request', {
    session: created.data.session,
    method: 'POST',
    path: '/api/feedback',
    body: { message: 'hello' },
    userId: 'attacker',
  });
  expect(response.data).toEqual({
    owner: { userId: config.ownerId, name: 'hireowner' },
    request: {
      method: 'POST',
      path: '/api/feedback',
      body: { message: 'hello' },
    },
  });
  expect(response.headers['Cache-Control']).toBe('no-store');
});

it.each([
  { method: 'DELETE', path: '/api/me' },
  { method: 'GET', path: 'https://evil.test/api/me' },
  { method: 'GET', path: '/api/../me' },
  { method: 'GET', path: '/api/me#fragment' },
  { method: 'GET', path: '/api/me?cursor=' + 'a'.repeat(40000) },
  { method: 'POST', path: '/api/me', body: 'x'.repeat(131073) },
])('rejects unsafe dispatch envelope %s', async (request) => {
  const created = await login();
  expect(
    (await call('request', { session: created.data.session, ...request }))
      .statusCode,
  ).toBe(400);
  expect(dispatch).not.toHaveBeenCalled();
});

it.each([
  {},
  { username: 'x'.repeat(65), password, remember: false },
  { username: 'hireowner', password: 'x'.repeat(257), remember: false },
  { username: 'hireowner', password, remember: 'yes' },
])('rejects malformed or oversized credential input', async (body) => {
  expect((await call('login', body)).statusCode).toBe(400);
  expect(fixture.writes).toBe(0);
});

it('rejects direct private-route access even with a platform-authenticated user', async () => {
  const response = (await denyDirectOwnerAccess({
    user: { userId: config.ownerId, scope: 'openid' },
  } as RouterContext)) as RouterResponse;
  expect(response.statusCode).toBe(401);
  expect(response.headers['Cache-Control']).toBe('no-store');
});
