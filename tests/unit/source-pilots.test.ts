import { describe, expect, it } from 'vitest';
import { normalizeLoganApplications, normalizeQldCoordinatedProjects, fetchSourcePilot } from '../../backend/source-pilots';
import { SOURCE_PILOT_CONTRACTS } from '../../backend/source-contracts';

const context = { retrievedAt: '2026-09-16T00:00:00.000Z', sourceLastModifiedAt: '2026-09-15T04:07:23.399Z' };
const logan = (patch: Record<string, unknown> = {}) => ({
  OBJECTID: 1, Application_System_ID: 3553768, Application_Number: 'MCUC/127/2026',
  Application_Amendment: null, Application_Description: 'Warehouse',
  Application_Status: 'Pending Confirmation Notice', Application_Lodgement_Date: 1789084800000,
  Application_Applicant: 'Example Applicant Pty Ltd', Application_Property_Key: 188852,
  Application_Property_Lot_Plan: 'RP197344/150', Application_Property_Suburb: 'SLACKS CREEK',
  PDonline_Link: 'https://devet.loganhub.com.au/#/applications/MCUC-127-2026',
  fme_rejection_code: null, ...patch,
});
const qld = (patch: Record<string, unknown> = {}) => ({
  objectid: 2, name: 'Airport Link Project', projectstatus: 'Completed EIS project',
  description: 'Road network and tunnel.',
  weblink: '<a href="https://www.coordinatorgeneral.qld.gov.au/projects/find-a-project/completed-projects/airport-link-project">Further information</a>',
  ...patch,
});

describe('Logan pilot evidence', () => {
  it('uses application plus amendment identity across changing object IDs and merges parcels', () => {
    const result = normalizeLoganApplications([logan(), logan({ OBJECTID: 99, Application_Property_Key: 188853, Application_Property_Lot_Plan: 'RP197344/151' }), logan()], context);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].externalId).toBe('logan:3553768:base');
    expect(result.evidence[0].parcelKeys).toEqual(['188852', '188853']);
    expect(result.evidence[0].upstreamObjectIds).toEqual(['1', '99']);
    expect(result.summary.duplicateRows).toBe(2);
    expect(normalizeLoganApplications([logan({ OBJECTID: 200 })], context).evidence[0].externalId).toBe(result.evidence[0].externalId);
    expect(normalizeLoganApplications([logan(), logan({ Application_Amendment: 'A' })], context).evidence).toHaveLength(2);
  });
  it('preserves lodgement separately from retrieval and applicant separately from contractor', () => {
    const row = normalizeLoganApplications([logan()], context).evidence[0];
    expect(row.sourceObservedAt).toBe('2026-09-11T00:00:00.000Z');
    expect(row.eventDateKind).toBe('LODGEMENT');
    expect(row.retrievedAt).toBe(context.retrievedAt);
    expect(row.observedAt).toBe(context.retrievedAt);
    expect(row.sourceLastModifiedAt).toBe(context.sourceLastModifiedAt);
    expect(row.company).toBe('Example Applicant Pty Ltd');
    expect(row.organisationRole).toBe('APPLICANT_HOLDER');
    expect(row.contextOnly).toBe(true);
    expect(row.promotionEligible).toBe(false);
    expect(row.projectUrl).toBe('https://devet.loganhub.com.au/#/applications/MCUC-127-2026');
  });
  it('quarantines an entire application when any parcel carries an upstream rejection flag', () => {
    const result = normalizeLoganApplications([logan(), logan({ OBJECTID: 2, fme_rejection_code: 'INVALID_INPUT' })], context);
    expect(result.evidence).toEqual([]);
    expect(result.quarantine).toHaveLength(1);
    expect(result.quarantine[0].qualityFlags).toContain('UPSTREAM_REJECTION:INVALID_INPUT');
    expect(result.quarantine[0].evidence?.promotionEligible).toBe(false);
    expect(result.summary.quarantined).toBe(1);
  });
  it('excludes domestic and unclassified descriptions from the commercial sample', () => {
    const result = normalizeLoganApplications([
      logan({ Application_Description: 'Dwelling house and domestic shed' }),
      logan({ Application_System_ID: 2, Application_Description: 'Boundary realignment' }),
      logan({ Application_System_ID: 3, Application_Description: 'Warehouse and caretaker dwelling' }),
    ], context);
    expect(result.evidence.map(row => row.externalId)).toEqual(['logan:3:base']);
    expect(result.excluded.map(row => row.reason).sort()).toEqual(['DOMESTIC_DEVELOPMENT', 'NO_COMMERCIAL_SIGNAL']);
  });
  it('preserves null lodgement, rejects malformed or future dates and never uses decision due date', () => {
    const absent = normalizeLoganApplications([logan({ Application_Lodgement_Date: null, Application_Decision_Due_Date: 1789084800000 })], context);
    expect(absent.evidence[0].sourceObservedAt).toBeUndefined();
    expect(absent.evidence[0].qualityFlags).toContain('MISSING_LODGEMENT_DATE');
    for (const date of ['nonsense', '2026-02-30', 45000, '2026-09-17']) {
      const result = normalizeLoganApplications([logan({ Application_Lodgement_Date: date })], context);
      expect(result.evidence).toHaveLength(0);
      expect(result.quarantine[0].qualityFlags).toContain('INVALID_LODGEMENT_DATE');
    }
  });
  it('quarantines missing identity, renamed required fields and conflicting parcel evidence', () => {
    expect(normalizeLoganApplications([logan({ Application_System_ID: null })], context).quarantine[0].qualityFlags).toContain('MISSING_APPLICATION_ID');
    const renamed = logan(); delete renamed.fme_rejection_code;
    expect(normalizeLoganApplications([renamed], context).quarantine[0].qualityFlags).toContain('MISSING_FIELD:fme_rejection_code');
    const conflicts = normalizeLoganApplications([logan(), logan({ Application_Lodgement_Date: 1788998400000 })], context);
    expect(conflicts.evidence).toHaveLength(0);
    expect(conflicts.quarantine[0].qualityFlags).toContain('CONFLICTING_APPLICATION_ROWS');
  });
});

describe('Queensland context evidence', () => {
  it('uses title and authoritative URL across changing OBJECTID and keeps completed assessment undated', () => {
    const result = normalizeQldCoordinatedProjects([qld(), qld({ objectid: 800 })], context);
    expect(result.evidence).toHaveLength(1);
    const row = result.evidence[0];
    expect(row.externalId).toContain('airport%20link%20project');
    expect(row.organisationRole).toBe('UNKNOWN');
    expect(row.company).toBe('');
    expect(row.sourceObservedAt).toBeUndefined();
    expect(row.eventDateKind).toBeUndefined();
    expect(row.sourceStatus).toBe('Completed EIS project');
    expect(row.contextOnly).toBe(true);
    expect(row.promotionEligible).toBe(false);
    expect(row.qualityFlags).toContain('UNDATED_CONTEXT');
  });
  it('decodes HTML entities without rendering markup and keeps distinct names sharing a generic link', () => {
    const html = '<a href="https://www.coordinatorgeneral.qld.gov.au/work-with-us/coordinated-projects?a=1&amp;b=2">More</a>';
    const result = normalizeQldCoordinatedProjects([qld({ name: 'A &amp; B', weblink: html }), qld({ name: 'Another project', weblink: html })], context);
    expect(result.evidence).toHaveLength(2);
    const row = result.evidence.find(item => item.project === 'A & B')!;
    expect(row.projectUrl).toBe('https://www.coordinatorgeneral.qld.gov.au/work-with-us/coordinated-projects?a=1&b=2');
    expect(row.rawLinks).toEqual([html]);
    expect(row.qualityFlags).toContain('GENERIC_PROJECT_LINK');
  });
  it('quarantines malformed, unsafe, missing or non-authoritative project links', () => {
    for (const link of [null, '<a>missing href</a>', '<a href="javascript:alert(1)">click</a>', 'https://coordinatorgeneral.qld.gov.au.evil.example/project', '<a href="https://www.coordinatorgeneral.qld.gov.au/test>bad</a>']) {
      const result = normalizeQldCoordinatedProjects([qld({ weblink: link })], context);
      expect(result.evidence).toEqual([]);
      expect(result.quarantine[0].qualityFlags).toContain('INVALID_PROJECT_LINK');
    }
  });
  it('quarantines missing title and unknown assessment statuses', () => {
    expect(normalizeQldCoordinatedProjects([qld({ name: '' })], context).quarantine[0].qualityFlags).toContain('MISSING_PROJECT_TITLE');
    expect(normalizeQldCoordinatedProjects([qld({ projectstatus: 'Building complete' })], context).quarantine[0].qualityFlags).toContain('UNKNOWN_PROJECT_STATUS');
  });
});

describe('bounded ArcGIS pilot reads', () => {
  const metadata = () => ({
    fields: ['name', 'projectstatus', 'description', 'weblink', 'objectid'].map(name => ({ name })),
    advancedQueryCapabilities: { supportsPagination: true, supportsOrderBy: true },
  });
  it('paginates deterministically and reports truncation without promoting the fetched context', async () => {
    const urls: URL[] = [];
    const request = async (value: string) => {
      const url = new URL(value); urls.push(url);
      if (!url.pathname.endsWith('/query')) return metadata();
      const offset = Number(url.searchParams.get('resultOffset'));
      return { features: [qld({ objectid: offset + 1, name: 'Project ' + offset })].map(attributes => ({ attributes })), exceededTransferLimit: true };
    };
    const result = await fetchSourcePilot('qld-coordinated-projects', { pageSize: 1, maxPages: 2, maxRows: 2, retrievedAt: context.retrievedAt }, request);
    expect(result.summary.inputRows).toBe(2);
    expect(result.fetch.completed).toBe(false);
    expect(result.fetch.truncated).toBe(true);
    expect(result.fetch.pages).toBe(2);
    expect(urls.slice(1).map(url => url.searchParams.get('resultOffset'))).toEqual(['0', '1']);
    expect(urls[1].searchParams.get('orderByFields')).toBe('objectid ASC');
    expect(result.evidence.every(row => row.promotionEligible === false)).toBe(true);
  });
  it('does not mistake a short transfer-limited page for complete coverage', async () => {
    let calls = 0;
    const result = await fetchSourcePilot('qld-coordinated-projects', { pageSize: 2, maxPages: 3, maxRows: 6, retrievedAt: context.retrievedAt }, async url => {
      if (!url.includes('/query?')) return metadata();
      calls++;
      return { features: [{ attributes: qld({ objectid: calls, name: 'Project ' + calls }) }], exceededTransferLimit: calls === 1 };
    });
    expect(result.fetch.pages).toBe(2);
    expect(result.fetch.completed).toBe(true);
  });
  it('fails closed for repeated pages, absent required fields, source errors and out-of-bounds options', async () => {
    const repeating = async (url: string) => url.includes('/query?') ? { features: [{ attributes: qld() }], exceededTransferLimit: true } : metadata();
    await expect(fetchSourcePilot('qld-coordinated-projects', { pageSize: 1, maxPages: 2 }, repeating)).rejects.toThrow('ARCGIS_NON_INCREASING_OBJECT_ID');
    await expect(fetchSourcePilot('qld-coordinated-projects', {}, async () => ({ ...metadata(), fields: [] }))).rejects.toThrow('ARCGIS_REQUIRED_FIELDS_MISSING');
    await expect(fetchSourcePilot('qld-coordinated-projects', {}, async () => ({ error: { code: 400 } }))).rejects.toThrow('ARCGIS_SOURCE_ERROR');
    await expect(fetchSourcePilot('qld-coordinated-projects', { maxRows: 100001 }, repeating)).rejects.toThrow('PILOT_BOUND_INVALID');
  });
});

it('contracts keep activation closed and document attribution, rights, cadence and quality gates', () => {
  expect(Object.keys(SOURCE_PILOT_CONTRACTS)).toHaveLength(2);
  for (const contract of Object.values(SOURCE_PILOT_CONTRACTS)) {
    expect(contract.activationEnabled).toBe(false);
    expect(contract.attribution).toBeTruthy();
    expect(contract.licence.url).toBe('https://creativecommons.org/licenses/by/3.0/au/');
    expect(contract.rightsReview.checkedAt).toBe('2026-09-16');
    expect(contract.qualityGates).toContain('PRODUCTION_RUNTIME_CANARY');
  }
});

it('recognises current-coordinated project detail links observed in the live layer', () => {
  const result = normalizeQldCoordinatedProjects([qld({ weblink: '<a href="https://www.coordinatorgeneral.qld.gov.au/projects/find-a-project/current-coordinated-projects/big-rocks-weir-project">Further information</a>' })], context);
  expect(result.evidence[0].qualityFlags).not.toContain('GENERIC_PROJECT_LINK');
});
it('does not let a clean parcel override a conflicting closed application disposition', () => {
  const result = normalizeLoganApplications([logan({ Application_Decision_Status: 'Undecided' }), logan({ Application_Decision_Status: 'Approved' })], context);
  expect(result.evidence).toHaveLength(0);
  expect(result.quarantine[0].qualityFlags).toContain('CONFLICTING_APPLICATION_ROWS');
});

it('filters a domestic home office while preserving an explicitly industrial project', () => {
  const result = normalizeLoganApplications([
    logan({ Application_Description: 'Dwelling house with home office' }),
    logan({ Application_System_ID: 4, Application_Description: 'Low Impact Industry' }),
  ], context);
  expect(result.excluded.map(row => row.externalId)).toEqual(['logan:3553768:base']);
  expect(result.evidence.map(row => row.externalId)).toEqual(['logan:4:base']);
});
it('does not silently clear an upstream flag or amendment after a type change', () => {
  const flag = normalizeLoganApplications([logan({ fme_rejection_code: { code: 'INVALID_INPUT' } })], context);
  expect(flag.evidence).toHaveLength(0);
  expect(flag.quarantine[0].qualityFlags).toContain('INVALID_QUALITY_FLAG_TYPE');
  const amendment = normalizeLoganApplications([logan({ Application_Amendment: { version: 'A' } })], context);
  expect(amendment.evidence).toHaveLength(0);
  expect(amendment.quarantine[0].qualityFlags).toContain('INVALID_AMENDMENT_TYPE');
});
