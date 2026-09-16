import { expect, it } from 'vitest';
import { extractSourceDate, inferOrganisation } from '../../backend/domain-hardening';
it('normalises explicit regulator holder fields without treating them as delivery contractors', () => {
  for (const [source, raw] of [
    ['qld-environmental-authorities', { 'Permit Holder(s)': 'QA Holder' }],
    ['qld-renewed-resource-authorities', { Authorised_Holder: 'QA Holder' }],
    ['qld-granted-resource-authorities', { ClientName: 'QA Holder' }],
    ['wa-mining-tenements', { holder1: 'QA Holder' }],
    ['tas-current-mining-leases', { OWNER: 'QA Holder' }],
  ] as const) expect(inferOrganisation(source, raw)).toEqual({ name: 'QA Holder', role: 'APPLICANT_HOLDER' });
});
it('recognises AEMO project proponents separately from delivery contractors', () => {
  expect(inferOrganisation('aemo-generation-information', { 'Site Owner': 'QA Owner' })).toEqual({ name: 'QA Owner', role: 'OWNER_PROPONENT' });
  expect(inferOrganisation('aemo-key-connection-information', { 'Organisation Name': 'QA Owner' })).toEqual({ name: 'QA Owner', role: 'OWNER_PROPONENT' });
});
it('recognises published source activity dates and leaves extraction timestamps unknown', () => {
  for (const name of ['Effective Date', 'Granted_Date', 'GrantedDate', 'grantdate', 'Award contract date', 'Survey Latest Update Date', 'KCI data – TNSP Validation Date']) {
    expect(extractSourceDate({ [name]: '2020-03-04' }, '2026-09-16')).toBe('2020-03-04T00:00:00.000Z');
  }
  expect(extractSourceDate({ extract_date: '2026-09-16' }, '2026-09-16')).toBe('');
});
it('preserves real pre-2001 millisecond timestamps without accepting spreadsheet serials', () => {
  expect(extractSourceDate({ grantdate: Date.UTC(1998, 0, 2) }, '2026-09-16')).toBe('1998-01-02T00:00:00.000Z');
  expect(extractSourceDate({ issue_date: 45000 }, '2026-09-16')).toBe('');
});