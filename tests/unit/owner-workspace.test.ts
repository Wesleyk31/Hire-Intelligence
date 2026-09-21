import { expect, it, vi } from 'vitest';
import type { RouterContext, RouterRoutes } from '@appdeploy/sdk';
import { createOwnerWorkspaceDispatch } from '../../backend/owner-workspace';

const context = {
  body: {},
  query: {},
  params: {},
  event: {},
  user: { userId: 'unrelated', scope: '' },
} as RouterContext;
const owner = { userId: 'configured-owner', name: 'hireowner' };
const response = { statusCode: 200, headers: {}, body: '{}' };

it('dispatches only the business handler using verified owner identity and parsed inputs', async () => {
  const handler = vi.fn(async () => response);
  const denied = vi.fn();
  const dispatch = createOwnerWorkspaceDispatch({
    'GET /api/sources/:key/health': [denied, handler],
  });
  expect(
    await dispatch(context, owner, {
      method: 'GET',
      path: '/api/sources/nsw-planning/health?cursor=next%2Bpage',
    }),
  ).toEqual(response);
  expect(denied).not.toHaveBeenCalled();
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { ...owner, scope: '' },
      params: { key: 'nsw-planning' },
      query: { cursor: 'next+page' },
      body: undefined,
    }),
  );
});

it('does not expose automation, public writes, external URLs or ambiguous routes through the gateway', async () => {
  const handler = vi.fn(async () => response);
  const routes: RouterRoutes = Object.fromEntries(
    [
      'POST /api/automation/refresh',
      'POST /api/demo-request',
      'POST /api/owner/login',
      'GET /api/dashboard',
    ].map((path) => [path, [handler, handler]]),
  );
  const dispatch = createOwnerWorkspaceDispatch(routes);
  for (const path of [
    '/api/automation/refresh',
    '/api/demo-request',
    '/api/owner/login',
    'https://example.test/api/dashboard',
    '//example.test/api/dashboard',
    '/api/dashboard#x',
    '/api/../api/dashboard',
    '/api/%64ashboard',
    '/api/dashboard?userId=other',
    '/api/dashboard?cursor=a&cursor=b',
    '/api/sources/a%2Fb/health',
  ]) {
    expect(
      (await dispatch(context, owner, { method: 'POST', path })).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await dispatch(context, owner, { method: 'GET', path })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  }
  expect(handler).not.toHaveBeenCalled();
});

it('preserves the full encoded cursor accepted by existing pagination handlers', async () => {
  const handler = vi.fn(async () => response);
  const dispatch = createOwnerWorkspaceDispatch({ 'GET /api/dashboard': [vi.fn(), handler] });
  expect((await dispatch(context, owner, { method: 'GET', path: '/api/dashboard?cursor=' + '%2B'.repeat(12000) })).statusCode).toBe(200);
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ query: { cursor: '+'.repeat(12000) } }));
});

it('keeps write body separate from the authenticated identity and fails closed if registration changes', async () => {
  const handler = vi.fn(async () => response);
  const dispatch = createOwnerWorkspaceDispatch({
    'POST /api/reports/history': [vi.fn(), handler],
  });
  await dispatch(context, owner, {
    method: 'POST',
    path: '/api/reports/history',
    body: { ownerUserId: 'attacker', headline: 'Report' },
  });
  expect(handler).toHaveBeenCalledWith(
    expect.objectContaining({
      user: { ...owner, scope: '' },
      body: { ownerUserId: 'attacker', headline: 'Report' },
    }),
  );
  expect(
    (
      await createOwnerWorkspaceDispatch({})(context, owner, {
        method: 'GET',
        path: '/api/dashboard',
      })
    ).statusCode,
  ).toBe(503);
});
