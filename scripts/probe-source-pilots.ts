/**
 * Public, bounded, read-only pilot probe. No SDK, writes, activation or contact enrichment.
 * Run: node --experimental-strip-types scripts/probe-source-pilots.ts
 * Vite loads TypeScript using the same module resolver as the application.
 */
import { createServer } from 'vite';
import type { fetchSourcePilot as FetchSourcePilot } from '../backend/source-pilots';
import type { SourcePilotKey } from '../backend/source-contracts';

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const module = await server.ssrLoadModule('/backend/source-pilots.ts') as { fetchSourcePilot: typeof FetchSourcePilot };
  const probes: { key: SourcePilotKey; where: string }[] = [
    { key: 'logan-development-applications', where: "Application_Description like '%Warehouse%'" },
    { key: 'qld-coordinated-projects', where: "projectstatus like 'Current%'" },
  ];
  const outputs: unknown[] = [];
  let failed = false;
  for (const probe of probes) {
    const startedAt = new Date().toISOString();
    try {
      // Two pages of three rows prove a page transition while keeping output bounded.
      const result = await module.fetchSourcePilot(probe.key, { pageSize: 3, maxPages: 2, maxRows: 6, where: probe.where, retrievedAt: startedAt });
      const sample = [...result.evidence, ...result.quarantine.flatMap(row => row.evidence ? [row.evidence] : [])].slice(0, 6);
      outputs.push({
        source: probe.key, startedAt, where: probe.where, summary: result.summary, fetch: result.fetch,
        contextSample: sample.map(row => ({
          externalId: row.externalId, applicationNumber: row.applicationNumber, project: row.project,
          sourceStatus: row.sourceStatus, sourceObservedAt: row.sourceObservedAt ?? null, eventDateKind: row.eventDateKind ?? null,
          organisationRole: row.organisationRole, projectUrl: row.projectUrl, parcelCount: row.parcelKeys.length,
          qualityFlags: row.qualityFlags, contextOnly: row.contextOnly, promotionEligible: row.promotionEligible,
        })),
        // Do not output raw records or applicant identities.
        quarantineReasons: result.quarantine.map(row => ({ externalId: row.externalId, rowCount: row.rowCount, qualityFlags: row.qualityFlags })),
        limitations: 'Single-environment sample only. No scheduled-ingestion, full-coverage or production-reliability claim; no live data written.',
      });
    } catch (error) {
      failed = true;
      outputs.push({ source: probe.key, startedAt, error: error instanceof Error ? error.message : 'UNKNOWN_ERROR', rowsUsable: false });
    }
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), pilots: outputs }, null, 2));
  if (failed) process.exitCode = 1;
} finally {
  await server.close();
}
