// Browser test transport only. Never included in the production build.
import type { AuthUser } from '@appdeploy/client';
const key = 'hire-test-user';
export const auth = {
  async getUser(): Promise<AuthUser | null> {
    if (sessionStorage.getItem('hire-test-auth-error')) throw new Error('QA expired session');
    return JSON.parse(sessionStorage.getItem(key) || 'null');
  },
  async signIn() {
    const user = { userId: sessionStorage.getItem('hire-test-actor') || 'qa-a', name: 'QA test account', scope: '' };
    sessionStorage.setItem(key, JSON.stringify(user));
    return { user, accessToken: 'test-only', expiresIn: 3600 };
  },
  async signOut() { sessionStorage.removeItem(key); },
};
async function request(method: string, path: string, body?: unknown) {
  const user = JSON.parse(sessionStorage.getItem(key) || 'null');
  const response = await fetch('/__qa' + path, { method, headers: { 'content-type': 'application/json', 'x-qa-user': user?.userId || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`QA API returned ${response.status}`);
  return { data: await response.json() };
}
export const api = { get: (path: string) => request('GET', path), post: (path: string, body: unknown) => request('POST', path, body) };
