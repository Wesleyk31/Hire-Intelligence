import { api } from '@appdeploy/client';

export type OwnerUser = { userId: string; name: string };
type Session = { session: string; expiresAt: string };
export const ownerSessionKey = 'hire-owner-session';
export const ownerSessionChanged = 'hire-owner-session-changed';

export function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  return value.response?.status ?? value.status ?? value.statusCode;
}

export function clearOwnerSession(expected?: string) {
  if (expected && readSession()?.session !== expected) return;
  localStorage.removeItem(ownerSessionKey);
  sessionStorage.removeItem(ownerSessionKey);
  window.dispatchEvent(new Event(ownerSessionChanged));
}

function readSession(): Session | null {
  try {
    const raw =
      sessionStorage.getItem(ownerSessionKey) ||
      localStorage.getItem(ownerSessionKey);
    const saved = raw ? JSON.parse(raw) : null;
    return saved &&
      typeof saved.session === 'string' &&
      typeof saved.expiresAt === 'string'
      ? saved
      : null;
  } catch {
    return null;
  }
}

export function ownerSession(): Session | null {
  const saved = readSession();
  if (saved && Date.parse(saved.expiresAt) > Date.now()) return saved;
  if (
    saved ||
    localStorage.getItem(ownerSessionKey) ||
    sessionStorage.getItem(ownerSessionKey)
  )
    clearOwnerSession();
  return null;
}

function validatedUser(data: {
  user?: OwnerUser;
  expiresAt?: string;
}): OwnerUser {
  if (
    !data.user?.userId ||
    !data.user.name ||
    !(Date.parse(data.expiresAt || '') > Date.now())
  ) {
    throw new Error('Invalid owner session response');
  }
  return data.user;
}

export const ownerAuth = {
  async getUser(): Promise<OwnerUser | null> {
    const saved = ownerSession();
    if (!saved) return null;
    try {
      const { data } = await api.post('/api/owner/session', {
        session: saved.session,
      });
      const user = validatedUser(data);
      if (ownerSession()?.session !== saved.session) return null;
      return user;
    } catch (error) {
      clearOwnerSession(saved.session);
      throw error;
    }
  },
  async signIn(
    username: string,
    password: string,
    remember: boolean,
  ): Promise<OwnerUser> {
    const { data } = await api.post('/api/owner/login', {
      username: username.trim(),
      password,
      remember,
    });
    validatedUser(data);
    if (typeof data.session !== 'string' || !data.session)
      throw new Error('Missing owner session');
    clearOwnerSession();
    (remember ? localStorage : sessionStorage).setItem(
      ownerSessionKey,
      JSON.stringify({ session: data.session, expiresAt: data.expiresAt }),
    );
    const user = await ownerAuth.getUser();
    if (!user) throw new Error('Owner session was not verified');
    return user;
  },
  async signOut() {
    const saved = ownerSession();
    if (saved) {
      try {
        await api.post('/api/owner/logout', { session: saved.session });
      } catch (error) {
        if (statusOf(error) !== 401) throw error;
      }
    }
    clearOwnerSession(saved?.session);
  },
};
