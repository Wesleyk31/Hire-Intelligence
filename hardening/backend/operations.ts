import { db, type AuthUser } from '@appdeploy/sdk';
import { validateDemoRequest } from './domain-hardening';

export type DemoRequest = {
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
  createdAt: string;
  status: 'NEW';
};

export type ReportHistoryRecord = {
  ownerUserId: string;
  generatedAt: string;
  headline: string;
  filename?: string;
  projectCount: number;
  opportunityCount: number;
};

export async function saveDemoRequest(body: unknown) {
  const validation = validateDemoRequest((body || {}) as Record<string, unknown>);
  if (!validation.ok) return { ok: false as const, error: validation.error };
  const record: DemoRequest = { ...validation.value, createdAt: new Date().toISOString(), status: 'NEW' };
  const [id] = await db.add('demo_requests', [{ ...record }]);
  return id ? { ok: true as const, id } : { ok: false as const, error: 'Request save failed.' };
}

export async function saveReportHistory(user: AuthUser, body: unknown) {
  const input = (body || {}) as Record<string, unknown>;
  const record: ReportHistoryRecord = {
    ownerUserId: user.userId,
    generatedAt: String(input.generatedAt || new Date().toISOString()),
    headline: String(input.headline || '').slice(0, 500),
    filename: String(input.filename || '').slice(0, 300) || undefined,
    projectCount: Number(input.projectCount || 0),
    opportunityCount: Number(input.opportunityCount || 0),
  };
  const [id] = await db.add(`report_history:${user.userId}`, [{ ...record }]);
  return id ? { id, ...record } : null;
}

export async function listReportHistory(user: AuthUser) {
  const page = await db.list<ReportHistoryRecord>(`report_history:${user.userId}`, { limit: 100 });
  return page.items
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, 50);
}
