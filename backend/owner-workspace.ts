import {
  error,
  type RouterContext,
  type RouterResponse,
  type RouterRoutes,
} from '@appdeploy/sdk';

// Only these existing business operations can be called by a validated owner session.
const operations = [
  ['GET', '/api/dashboard', ['cursor']],
  ['GET', '/api/sources/contracts', []],
  ['GET', '/api/sources/:key/health', ['cursor']],
  ['GET', '/api/sources/:key/diagnostic', []],
  ['GET', '/api/sources/pilots/:key', []],
  ['GET', '/api/evidence/review', ['origin', 'cursor', 'limit']],
  ['GET', '/api/pilot/outcomes', []],
  ['GET', '/api/reports/history', []],
  ['POST', '/api/reports/history', []],
  ['POST', '/api/pilot/outcomes', []],
] as const;

export function createOwnerWorkspaceDispatch(routes: RouterRoutes) {
  return async (
    ctx: RouterContext,
    owner: { userId: string; name: string },
    request: { method: 'GET' | 'POST'; path: string; body?: unknown },
  ): Promise<RouterResponse> => {
    if (
      !request.path.startsWith('/api/') ||
      /[#\\\s]/.test(request.path) ||
      request.path.length > 40000
    )
      return error('Invalid workspace request', 400);
    const [pathname, rawQuery = '', extra] = request.path.split('?');
    if (extra !== undefined) return error('Invalid workspace request', 400);
    for (const [method, path, allowedQuery] of operations) {
      if (request.method !== method) continue;
      const match = new RegExp(
        '^' + path.replace(':key', '([a-zA-Z0-9_-]+)') + '$',
      ).exec(pathname);
      if (!match) continue;
      const query: Record<string, string> = Object.create(null);
      for (const [key, value] of new URLSearchParams(rawQuery)) {
        if (
          !(allowedQuery as readonly string[]).includes(key) ||
          Object.hasOwn(query, key)
        )
          return error('Invalid workspace query', 400);
        query[key] = value;
      }
      const chain = routes[method + ' ' + path];
      if (!chain || chain.length !== 2)
        return error('Workspace unavailable', 503);
      // Identity comes exclusively from the server-validated session. Never copy a caller's user field.
      return (
        (await chain[1]({
          event: ctx.event,
          user: { userId: owner.userId, name: owner.name, scope: '' },
          query,
          params: match[1] ? { key: match[1] } : {},
          body: method === 'POST' ? request.body : undefined,
        })) || error('Workspace unavailable', 503)
      );
    }
    return error('Unknown workspace operation', 404);
  };
}
