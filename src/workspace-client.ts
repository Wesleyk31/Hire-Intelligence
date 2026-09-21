import { api as transport } from '@appdeploy/client';
import { clearOwnerSession, ownerSession, statusOf } from './owner-auth';

async function request(method: 'GET' | 'POST', path: string, body?: unknown) {
  const saved = ownerSession();
  if (!saved) {
    clearOwnerSession();
    throw new Error('Owner sign-in required');
  }
  try {
    return await transport.post('/api/owner/request', {
      session: saved.session,
      method,
      path,
      ...(body === undefined ? {} : { body }),
    });
  } catch (error) {
    if (statusOf(error) === 401) clearOwnerSession(saved.session);
    throw error;
  }
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: unknown) => request('POST', path, body),
};
