// Browser test transport only. Never included in the production build.
import type { AuthUser } from '@appdeploy/client';
const key = 'hire-test-user';
async function authTransition(operation: 'sign-in' | 'sign-out') {
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
export const auth = {
  async getUser(): Promise<AuthUser | null> {
    if (sessionStorage.getItem('hire-test-auth-error')) throw new Error('QA expired session');
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  },
  async signIn() {
    await authTransition('sign-in');
    const user = { userId: sessionStorage.getItem('hire-test-actor') || 'qa-a', name: 'QA test account', scope: '' };
    sessionStorage.setItem(key, JSON.stringify(user));
    return { user, accessToken: 'test-only', expiresIn: 3600 };
  },
  async signOut() {
    await authTransition('sign-out');
    sessionStorage.removeItem(key);
  },
};
async function request(method: string, path: string, body?: unknown) {
  const user = JSON.parse(sessionStorage.getItem(key) || 'null');
  const response = await fetch('/__qa' + path, { method, headers: { 'content-type': 'application/json', 'x-qa-user': user?.userId || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`QA API returned ${response.status}`);
  return { data: await response.json() };
}
export const api = { get: (path: string) => request('GET', path), post: (path: string, body: unknown) => request('POST', path, body) };
