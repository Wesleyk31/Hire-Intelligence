// Browser test transport only. Never included in the production build.
// Synthetic credentials and session authority stand in for the server boundary.
const sessionsKey = 'hire-test-owner-sessions';
const fixturePassword = 'fixture-password-only';
async function authTransition(operation: 'sign-in' | 'sign-out' | 'session') {
  const countKey = `hire-test-${operation}-count`;
  sessionStorage.setItem(
    countKey,
    String(Number(sessionStorage.getItem(countKey) || '0') + 1),
  );
  const gateKey = `hire-test-${operation}-gate`;
  if (sessionStorage.getItem(gateKey)) {
    sessionStorage.removeItem(gateKey);
    const waitingKey = `hire-test-${operation}-waiting`;
    await new Promise<void>((resolve) => {
      window.addEventListener(
        `hire-test-release-${operation}`,
        () => resolve(),
        { once: true },
      );
      sessionStorage.setItem(waitingKey, '1');
    });
    sessionStorage.removeItem(waitingKey);
  }
  const failuresKey = `hire-test-${operation}-failures`;
  const failures = Number(sessionStorage.getItem(failuresKey) || '0');
  if (failures > 0) {
    sessionStorage.setItem(failuresKey, String(failures - 1));
    throw new Error(`QA ${operation} failure`);
  }
}
function failure(status: number) {
  return Object.assign(new Error(`QA API returned ${status}`), {
    response: { status },
  });
}
function sessions(): Record<
  string,
  { user: { userId: string; name: string }; expiresAt: string }
> {
  return JSON.parse(localStorage.getItem(sessionsKey) || '{}');
}
function verified(token: string) {
  const found = sessions()[token];
  if (
    !found ||
    Date.parse(found.expiresAt) <= Date.now() ||
    sessionStorage.getItem('hire-test-auth-error')
  )
    throw failure(401);
  return found;
}
async function request(
  method: string,
  path: string,
  body?: unknown,
  userId = '',
) {
  const response = await fetch('/__qa' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-qa-user': userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw failure(response.status);
  return { data: await response.json() };
}
async function post(path: string, body: any) {
  if (path === '/api/owner/login') {
    await authTransition('sign-in');
    if (body.username !== 'hireowner' || body.password !== fixturePassword)
      throw failure(401);
    const session = crypto.randomUUID();
    const result = {
      user: { userId: 'qa-a', name: 'QA test account' },
      expiresAt: new Date(
        Date.now() + (body.remember ? 30 * 24 : 12) * 3600000,
      ).toISOString(),
    };
    localStorage.setItem(
      sessionsKey,
      JSON.stringify({ ...sessions(), [session]: result }),
    );
    return { data: { ...result, session } };
  }
  if (path === '/api/owner/session') {
    await authTransition('session');
    return { data: verified(body.session) };
  }
  if (path === '/api/owner/logout') {
    await authTransition('sign-out');
    verified(body.session);
    const all = sessions();
    delete all[body.session];
    localStorage.setItem(sessionsKey, JSON.stringify(all));
    return { data: { ok: true } };
  }
  if (path === '/api/owner/request') {
    const owner = verified(body.session);
    return request(body.method, body.path, body.body, owner.user.userId);
  }
  return request('POST', path, body);
}
export const api = { get: (path: string) => request('GET', path), post };
