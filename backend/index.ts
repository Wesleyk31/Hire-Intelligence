import {
  sourceWfsPage,
  RECOVERED_WFS_LAYERS,
  projectRecordIdentity,
} from './source-helpers';
import { runRefreshSlice } from './refresh-scheduler';
import { fetchSourcePilot } from './source-pilots';
import {
  SOURCE_PILOT_CONTRACTS,
  type SourcePilotKey,
} from './source-contracts';
import { isDatabaseQuotaError } from './archive-storage';
import { getEvidencePage } from './evidence-review';
import { loadEvidenceUniverse } from './evidence-store';
import {
  findField,
  recordIdentity,
  sourceJson,
  sourceText,
  sourceWorkbook,
  projectWorkbookRows,
  ckanResourceRows,
} from './source-helpers';
import { router, json, error, db, requireAuth } from '@appdeploy/sdk';
import { read, utils } from 'xlsx';
import { getBackfillStatus, runBackfillBatch } from './backfill';
import {
  buildCalibrationMetrics,
  buildProjectIntelligence,
} from './intelligence';
import { buildCommercialIntelligence } from './commercial-intelligence';
import {
  aggregateOutcomeFunnel,
  groupCanonicalEvidence,
  extractSourceDate,
  inferOrganisation,
  isCallNowCandidate,
} from './domain-hardening';
import { listBounded } from './data-access';
import {
  listReportHistory,
  saveDemoRequest,
  saveReportHistory,
  validReportHistory,
} from './operations';

export type SourceDef = {
  key: string;
  name: string;
  owner: string;
  territory: string;
  sector: string;
  licence: string;
  method:
    | 'ARCGIS'
    | 'CKAN_DATASTORE'
    | 'CKAN_PACKAGE'
    | 'QLD_TENURE'
    | 'OCDS'
    | 'OPENDATASOFT'
    | 'WFS'
    | 'WFS_MATCH'
    | 'WFS_DIRECT'
    | 'CKAN_KML'
    | 'XLSX_PROJECT'
    | 'GEOJSON';
  endpoint: string;
  provenance: string;
  match?: string;
  enabled?: boolean;
  disableReason?: string;
};
type SourceState = {
  sourceKey: string;
  name: string;
  status: 'SUCCESS' | 'DEGRADED' | 'FAILED';
  recordsFetched: number;
  opportunitiesPromoted: number;
  lastRun: string;
  message: string;
  licence: string;
  provenance: string;
  durationMs?: number;
  duplicateRecords?: number;
  datedRecords?: number;
  undatedRecords?: number;
  persistenceFailures?: number;
  persistenceUncertain?: boolean;
};
type Opportunity = {
  sourceKey: string;
  externalId: string;
  project: string;
  location: string;
  stage: 'WATCH' | 'RISING' | 'PREPARE';
  score: number;
  window: string;
  equipment: string;
  action: string;
  company: string;
  organisationRole?:
    | 'DELIVERY_CONTRACTOR'
    | 'OWNER_PROPONENT'
    | 'APPLICANT_HOLDER'
    | 'SUPPLIER'
    | 'OPERATOR'
    | 'UNKNOWN';
  description: string;
  value: string;
  observedAt: string;
  sourceObservedAt?: string;
  provenance: string;
  evidenceType: 'EXPLICIT';
};
type PilotOutcome = {
  projectId?: string;
  project: string;
  result:
    | 'CONTACTED'
    | 'REQUIREMENT_CONFIRMED'
    | 'QUOTED'
    | 'WON'
    | 'LOST'
    | 'FALSE_POSITIVE';
  advanceDays: number | null;
  quoteValue: number | null;
  wonValue: number | null;
  notes: string;
  recordedAt: string;
  qa: boolean;
  signalQualityBand?: string;
  bdmPriority?: number;
  stageLabel?: string;
  equipmentClasses?: string[];
  sourceKeys?: string[];
};
type OpportunityIndex = { sourceKey: string; ids: Record<string, string> };

export const SOURCES: SourceDef[] = [
  {
    key: 'wa-mining-tenements',
    name: 'WA Mining Tenements (DMIRS-003)',
    owner: 'Government of Western Australia',
    territory: 'WA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/3/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/en/dataset/mining-tenements-dmirs-003',
  },
  {
    key: 'qld-environmental-authorities',
    name: 'Queensland Environmental Authorities',
    owner: 'Queensland Government',
    territory: 'QLD',
    sector: 'Resources',
    licence: 'CC BY 4.0',
    method: 'CKAN_DATASTORE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/datastore_search?resource_id=a9658145-87bd-4258-a689-5aec29d49792&limit=40',
    provenance: 'https://www.data.qld.gov.au/dataset/environmental-authorities',
  },
  {
    key: 'qld-granted-resource-authorities',
    name: 'Queensland Recently Granted Resource Authorities',
    owner: 'Queensland Government',
    territory: 'QLD',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=recently-granted-resource-authorities',
    provenance:
      'https://www.data.qld.gov.au/dataset/recently-granted-resource-authorities',
  },
  {
    key: 'qld-renewed-resource-authorities',
    name: 'Queensland Renewed Resource Authorities',
    owner: 'Queensland Government',
    territory: 'QLD',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=renewed-resource-authority-reports',
    provenance:
      'https://www.data.qld.gov.au/dataset/renewed-resource-authority-reports',
  },
  {
    key: 'qld-transferred-resource-authorities',
    name: 'Queensland Transferred Resource Authorities',
    owner: 'Queensland Government',
    territory: 'QLD',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=transferred-resource-authorities-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/transferred-resource-authorities-report',
  },
  {
    key: 'qld-non-current-resource-authorities',
    name: 'Queensland Non-current Resource Authorities',
    owner: 'Queensland Government',
    territory: 'QLD',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=non-current-resource-authorities',
    provenance:
      'https://www.data.qld.gov.au/dataset/non-current-resource-authorities',
  },
  {
    key: 'austender-contract-notices',
    name: 'AusTender Contract Notices',
    owner: 'Australian Government Department of Finance',
    territory: 'AU',
    sector: 'Procurement',
    licence: 'CC BY 3.0 Australia',
    method: 'OCDS',
    endpoint: 'https://api.tenders.gov.au/ocds/findByDates/contractPublished',
    provenance:
      'https://data.gov.au/data/dataset/historical-australian-government-contract-data',
  },
  {
    key: 'melbourne-building-permits',
    name: 'City of Melbourne Building Permits',
    owner: 'City of Melbourne',
    territory: 'VIC',
    sector: 'Building',
    licence: 'CC BY',
    method: 'OPENDATASOFT',
    endpoint:
      'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/building-permits/records?limit=40&order_by=issue_date%20desc',
    provenance:
      'https://data.melbourne.vic.gov.au/explore/dataset/building-permits/',
  },
  {
    key: 'melbourne-development-activity',
    name: 'City of Melbourne Development Activity Monitor',
    owner: 'City of Melbourne',
    territory: 'VIC',
    sector: 'Development',
    licence: 'CC BY',
    method: 'OPENDATASOFT',
    endpoint:
      'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/development-activity-monitor/records?limit=40',
    provenance:
      'https://data.melbourne.vic.gov.au/explore/dataset/development-activity-monitor/',
  },
  {
    key: 'melbourne-development-footprints',
    name: 'City of Melbourne Development Activity Footprints',
    owner: 'City of Melbourne',
    territory: 'VIC',
    sector: 'Development',
    licence: 'CC BY',
    method: 'OPENDATASOFT',
    endpoint:
      'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/development-activity-model-footprints/records?limit=40',
    provenance:
      'https://data.melbourne.vic.gov.au/explore/dataset/development-activity-model-footprints/',
  },
  {
    key: 'sa-mining-projects',
    name: 'South Australia Major Mineral Mines',
    owner: 'Government of South Australia - Energy & Mining',
    territory: 'SA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://services.sarig.sa.gov.au/vector/south_australia_mining_projects/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=south_australia_mining_projects%3Amajor_mines___minerals&outputFormat=application%2Fjson&sortBy=OBJECTID',
    provenance:
      'https://www.energymining.sa.gov.au/industry/geological-survey/products-and-services/map-viewers-databases-and-services/data-services',
    enabled: false,
    disableReason:
      'Public WFS2 pages verified 2026-09-16; stable domain identity, field semantics, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'sa-mineral-tenements',
    name: 'South Australia Mineral and Opal Exploration Licence Applications',
    owner: 'Government of South Australia - Energy & Mining',
    territory: 'SA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://services.sarig.sa.gov.au/vector/mineral_tenements/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=mineral_tenements%3Amineral_and_or_opal_exploration_licence_applications&outputFormat=application%2Fjson&sortBy=OBJECTID',
    provenance:
      'https://www.energymining.sa.gov.au/industry/geological-survey/products-and-services/map-viewers-databases-and-services/data-services',
    enabled: false,
    disableReason:
      'Public WFS2 pages verified 2026-09-16; stable domain identity, field semantics, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'sa-petroleum-tenements',
    name: 'South Australia Associated Facility and Infrastructure Licence Applications',
    owner: 'Government of South Australia - Energy & Mining',
    territory: 'SA',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://services.sarig.sa.gov.au/vector/petroleum_tenements/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=petroleum_tenements%3Aassociated_facility_and_infrastructure_licence_applications&outputFormat=application%2Fjson&sortBy=OBJECTID',
    provenance:
      'https://www.energymining.sa.gov.au/industry/geological-survey/products-and-services/map-viewers-databases-and-services/data-services',
    enabled: false,
    disableReason:
      'Public WFS2 pages verified 2026-09-16; stable domain identity, field semantics, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'sa-power-generation',
    name: 'South Australia Power Generation Projects',
    owner: 'Government of South Australia - Energy & Mining',
    territory: 'SA',
    sector: 'Energy',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://services.sarig.sa.gov.au/vector/renewable_energy_and_storage/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=renewable_energy_and_storage%3Apower_generation___all&outputFormat=application%2Fjson&sortBy=OBJECTID',
    provenance:
      'https://www.energymining.sa.gov.au/industry/geological-survey/products-and-services/map-viewers-databases-and-services/data-services',
    enabled: false,
    disableReason:
      'Public WFS2 pages verified 2026-09-16; stable domain identity, field semantics, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'nt-mineral-titles',
    name: 'Northern Territory Mineral Titles',
    owner: 'Northern Territory Department of Mining and Energy',
    territory: 'NT',
    sector: 'Mining',
    licence: 'CC BY',
    method: 'CKAN_KML',
    endpoint:
      'https://data.nt.gov.au/api/3/action/package_show?id=strike---northern-territory-mineral-titles',
    provenance:
      'https://data.nt.gov.au/dataset/strike---northern-territory-mineral-titles',
    enabled: false,
    disableReason:
      'NT CKAN endpoint returned HTTP 406 from production runtime; deferred pending access revalidation',
  },
  {
    key: 'nt-petroleum-pipeline-titles',
    name: 'Northern Territory Petroleum and Pipeline Titles',
    owner: 'Northern Territory Department of Mining and Energy',
    territory: 'NT',
    sector: 'Oil & Gas',
    licence: 'CC BY',
    method: 'CKAN_KML',
    endpoint:
      'https://data.nt.gov.au/api/3/action/package_show?id=strike---northern-territory-petroleum-and-pipeline-titles',
    provenance:
      'https://data.nt.gov.au/dataset/strike---northern-territory-petroleum-and-pipeline-titles',
    enabled: false,
    disableReason:
      'NT CKAN endpoint returned HTTP 406 from production runtime; deferred pending access revalidation',
  },
  {
    key: 'nt-geothermal-titles',
    name: 'Northern Territory Geothermal Titles',
    owner: 'Northern Territory Department of Mining and Energy',
    territory: 'NT',
    sector: 'Energy',
    licence: 'CC BY',
    method: 'CKAN_KML',
    endpoint:
      'https://data.nt.gov.au/api/3/action/package_show?id=strike---northern-territory-geothermal-title',
    provenance:
      'https://data.nt.gov.au/dataset/strike---northern-territory-geothermal-title',
    enabled: false,
    disableReason:
      'NT CKAN endpoint returned HTTP 406 from production runtime; deferred pending access revalidation',
  },
  {
    key: 'nt-mines',
    name: 'Northern Territory Mines',
    owner: 'Northern Territory Department of Mining and Energy',
    territory: 'NT',
    sector: 'Mining',
    licence: 'CC BY',
    method: 'CKAN_KML',
    endpoint:
      'https://data.nt.gov.au/api/3/action/package_show?id=strike---northern-territory-mines',
    provenance:
      'https://data.nt.gov.au/dataset/strike---northern-territory-mines',
    enabled: false,
    disableReason:
      'NT CKAN endpoint returned HTTP 406 from production runtime; deferred pending access revalidation',
  },
  {
    key: 'nt-mineral-occurrences',
    name: 'Northern Territory Mineral Occurrences',
    owner: 'Northern Territory Department of Mining and Energy',
    territory: 'NT',
    sector: 'Mining',
    licence: 'CC BY',
    method: 'CKAN_KML',
    endpoint:
      'https://data.nt.gov.au/api/3/action/package_show?id=strike---northern-territory-mineral-occurrences',
    provenance:
      'https://data.nt.gov.au/dataset/strike---northern-territory-mineral-occurrences',
    enabled: false,
    disableReason:
      'NT CKAN endpoint returned HTTP 406 from production runtime; deferred pending access revalidation',
  },
  {
    key: 'aemo-generation-information',
    name: 'AEMO NEM Generation Information - July 2026',
    owner: 'Australian Energy Market Operator',
    territory: 'AU',
    sector: 'Energy',
    licence: 'AEMO public material - use permitted with attribution',
    method: 'XLSX_PROJECT',
    endpoint:
      'https://www.aemo.com.au/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2026/nem-generation-information-july-2026.xlsx?rev=3455851f2bc945b7ab61c5ceed272992&sc_lang=en',
    provenance:
      'https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information',
  },
  {
    key: 'aemo-key-connection-information',
    name: 'AEMO Key Connection Information - July 2026',
    owner: 'Australian Energy Market Operator',
    territory: 'AU',
    sector: 'Energy',
    licence: 'AEMO public material - use permitted with attribution',
    method: 'XLSX_PROJECT',
    endpoint:
      'https://www.aemo.com.au/-/media/files/electricity/nem/planning_and_forecasting/generation_information/2026/kci-datafile-compiled-nem.xlsx?rev=2c020fb4f0d849ae9cfbd76bb0c670e7&sc_lang=en',
    provenance:
      'https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/nem-forecasting-and-planning/forecasting-and-planning-data/generation-information',
  },
  {
    key: 'qld-forward-procurement-pipeline',
    name: 'Queensland Forward Procurement Pipeline',
    owner: 'Queensland Government - Housing and Public Works',
    territory: 'QLD',
    sector: 'Procurement',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=forward-procurement-pipeline',
    provenance:
      'https://www.data.qld.gov.au/dataset/forward-procurement-pipeline',
  },
  {
    key: 'qld-tmr-major-works-tender',
    name: 'Queensland TMR Proposed Major Works to Competitive Tender',
    owner: 'Queensland Government - Transport and Main Roads',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=competitive-works-to-tender-department-of-transport-and-main-roads',
    provenance:
      'https://www.data.qld.gov.au/dataset/competitive-works-to-tender-department-of-transport-and-main-roads',
  },
  {
    key: 'qld-qtrip-2025-2029',
    name: 'Queensland Transport and Roads Investment Program 2025-26 to 2028-29',
    owner: 'Queensland Government - Transport and Main Roads',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=queensland-transport-and-roads-investment-program-qtrip-2025-26-to-2028-29',
    provenance:
      'https://www.data.qld.gov.au/dataset/queensland-transport-and-roads-investment-program-qtrip-2025-26-to-2028-29',
  },
  {
    key: 'qld-state-development-contracts',
    name: 'Queensland State Development Contract Disclosures',
    owner:
      'Queensland Government - State Development, Infrastructure and Planning',
    territory: 'QLD',
    sector: 'Procurement',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=dsdilgp-dsdi-contract-disclosure-reports',
    provenance:
      'https://www.data.qld.gov.au/dataset/dsdilgp-dsdi-contract-disclosure-reports',
  },
  {
    key: 'qld-tmr-contract-disclosures',
    name: 'Queensland TMR Contract Disclosures',
    owner: 'Queensland Government - Transport and Main Roads',
    territory: 'QLD',
    sector: 'Procurement',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=tmr-contract-disclosure',
    provenance: 'https://www.data.qld.gov.au/dataset/tmr-contract-disclosure',
  },
  {
    key: 'qld-rail-contract-disclosures',
    name: 'Queensland Rail Contract Disclosure FY2025-2026',
    owner: 'Queensland Rail',
    territory: 'QLD',
    sector: 'Rail',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=queensland-rail-contract-disclosure-fy2025-2026',
    provenance:
      'https://www.data.qld.gov.au/dataset/queensland-rail-contract-disclosure-fy2025-2026',
  },
  {
    key: 'qld-reconstruction-contracts',
    name: 'Queensland Reconstruction Authority Contract Disclosures 2026-27',
    owner: 'Queensland Reconstruction Authority',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=2026-27-queensland-reconstruction-authority-contract-disclosure-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/2026-27-queensland-reconstruction-authority-contract-disclosure-report',
  },
  {
    key: 'qld-edq-contract-disclosure',
    name: 'Economic Development Queensland Contract Disclosure',
    owner: 'Economic Development Queensland',
    territory: 'QLD',
    sector: 'Development',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=edq-contract-disclosure',
    provenance: 'https://www.data.qld.gov.au/dataset/edq-contract-disclosure',
  },
  {
    key: 'qld-giica-contracts',
    name: 'GIICA Contract Disclosure FY26',
    owner: 'Games Independent Infrastructure and Coordination Authority',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=giica-contracts-disclosure-reports',
    provenance:
      'https://www.data.qld.gov.au/dataset/giica-contracts-disclosure-reports',
  },
  {
    key: 'qld-health-infrastructure-contracts',
    name: 'Health Infrastructure Queensland Contract Disclosure 2025-26',
    owner: 'Queensland Health - Health Infrastructure Queensland',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=2025-26-health-infrastructure-queensland-contract-disclosure-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/2025-26-health-infrastructure-queensland-contract-disclosure-report',
  },
  {
    key: 'qld-housing-public-works-contracts',
    name: 'Queensland Housing and Public Works Contract Disclosure',
    owner: 'Queensland Government - Housing and Public Works',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=contract-disclosure-report-department-of-housing',
    provenance:
      'https://www.data.qld.gov.au/dataset/contract-disclosure-report-department-of-housing',
  },
  {
    key: 'qld-seqwater-contracts',
    name: 'Seqwater Contract Disclosure Report',
    owner: 'Seqwater',
    territory: 'QLD',
    sector: 'Water Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=seqwater-contract-disclosure-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/seqwater-contract-disclosure-report',
  },
  {
    key: 'qld-natural-resources-mines-contracts',
    name: 'Queensland Natural Resources and Mines Contract Disclosure',
    owner:
      'Queensland Government - Natural Resources and Mines, Manufacturing and Regional and Rural Development',
    territory: 'QLD',
    sector: 'Resources',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=contract-disclosure-report-dnrmmrrd',
    provenance:
      'https://www.data.qld.gov.au/dataset/contract-disclosure-report-dnrmmrrd',
  },
  {
    key: 'au-resources-energy-major-projects',
    name: 'Australian Resources and Energy Major Projects 2025',
    owner:
      'Australian Government - Department of Industry, Science and Resources',
    territory: 'AU',
    sector: 'Resources',
    licence: 'CC BY 4.0 International',
    method: 'XLSX_PROJECT',
    endpoint:
      'https://www.industry.gov.au/sites/default/files/2025-12/resources-and-energy-major-projects-2025-data.xlsx',
    provenance:
      'https://data.gov.au/data/dataset/resources-and-energy-major-projects',
    enabled: false,
    disableReason:
      '2025 workbook read verified 2026-09-16; dedicated Consolidated sheet parsing, stable project identity, attribution exceptions and production canary gates remain.',
  },
  {
    key: 'wa-tenements-release-pending',
    name: 'WA Tenements - Release Pending',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/19/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/tenements-release-pending',
  },
  {
    key: 'wa-tenements-amalgamation-pending',
    name: 'WA Tenements - Amalgamation Pending',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/20/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/tenements-amalgamation-pending',
  },
  {
    key: 'wa-tenements-restoration-pending',
    name: 'WA Tenements - Restoration Pending',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/21/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/tenements-restoration-pending',
  },
  {
    key: 'wa-tenements-dead',
    name: 'WA Tenements - Dead',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/15/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/tenements-dead-dmirs-026',
  },
  {
    key: 'wa-mineral-exploration-reports',
    name: 'WA Mineral Exploration Reports (WAMEX)',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Exploration',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/22/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/mineral-exploration-reports-wamex',
  },
  {
    key: 'wa-mineral-exploration-drillholes',
    name: 'WA Mineral Exploration Drillholes (Open File)',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Exploration',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/28/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/mineral-exploration-drillholes-open-file',
  },
  {
    key: 'wa-petroleum-wells',
    name: 'WA Petroleum Wells',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/13/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/wa-onshore-petroleum-wells-dmirs-025',
  },
  {
    key: 'wa-2d-seismic-surveys',
    name: 'WA 2D Seismic Surveys',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/23/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance: 'https://catalogue.data.wa.gov.au/dataset/2d-seismic-surveys',
  },
  {
    key: 'wa-3d-seismic-surveys',
    name: 'WA 3D Seismic Survey Polygons',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/24/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/3d-seismic-survey-polygons',
  },
  {
    key: 'nsw-current-mining-titles',
    name: 'NSW Exploration and Mining Titles',
    owner: 'NSW Department of Primary Industries and Regional Development',
    territory: 'NSW',
    sector: 'Mining',
    licence: 'Creative Commons Attribution',
    method: 'WFS_DIRECT',
    endpoint:
      'https://public-gs.geoscience.nsw.gov.au/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=mining-and-exploration%3Atitles_title_granted&outputFormat=application%2Fjson&sortBy=tas_id',
    provenance: 'https://data.nsw.gov.au/data/en/dataset/nsw-mining-titles',
    enabled: false,
    disableReason:
      'Corrected public WFS2 layer verified 2026-09-16; field semantics, exact attribution/licence, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'nsw-mining-title-applications',
    name: 'NSW Exploration and Mining Title Applications',
    owner: 'NSW Department of Primary Industries and Regional Development',
    territory: 'NSW',
    sector: 'Mining',
    licence: 'Creative Commons Attribution',
    method: 'WFS_DIRECT',
    endpoint:
      'https://public-gs.geoscience.nsw.gov.au/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=mining-and-exploration%3Atitles_title_applications&outputFormat=application%2Fjson&sortBy=tas_id',
    provenance:
      'https://data.nsw.gov.au/data/en/dataset/nsw-exploration-and-mining-titles-applications',
    enabled: false,
    disableReason:
      'Corrected public WFS2 layer verified 2026-09-16; field semantics, exact attribution/licence, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'nsw-major-operating-mines',
    name: 'NSW Major Operating Mines',
    owner: 'NSW Department of Primary Industries and Regional Development',
    territory: 'NSW',
    sector: 'Mining',
    licence: 'Creative Commons Attribution',
    method: 'WFS_DIRECT',
    endpoint:
      'https://public-gs.geoscience.nsw.gov.au/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=mineral-occurrence%3Amineral_occurrence_operating_mines&outputFormat=application%2Fjson&sortBy=occurrence_id',
    match: 'major operating mines',
    provenance:
      'https://www.data.nsw.gov.au/data/dataset/nsw-major-operating-mines',
    enabled: false,
    disableReason:
      'Corrected public WFS2 layer verified 2026-09-16; field semantics, exact attribution/licence, production canary and scheduled ingestion gates remain.',
  },
  {
    key: 'au-epbc-referrals',
    name: 'Australian EPBC Referrals Spatial Database',
    owner: 'Australian Government - DCCEEW',
    territory: 'AU',
    sector: 'Approvals',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://gis.environment.gov.au/gispubmap/rest/services/ogc_services/EPBC_Referrals/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://www.data.gov.au/data/dataset/referrals-spatial-database',
  },
  {
    key: 'wa-main-roads-roadworks',
    name: 'WA Main Roads WebEOC Roadworks',
    owner: 'Main Roads Western Australia',
    territory: 'WA',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://services2.arcgis.com/cHGEnmsJ165IBJRM/arcgis/rest/services/WebEoc_Roadworks/FeatureServer/2/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/en/dataset/mrwa-webeoc-roadworks',
  },
  {
    key: 'nsw-live-traffic-roadworks',
    name: 'NSW Live Traffic Planned Roadworks',
    owner: 'Transport for NSW',
    territory: 'NSW',
    sector: 'Infrastructure',
    licence: 'Creative Commons Attribution',
    method: 'GEOJSON',
    endpoint: 'https://data.livetraffic.com/traffic/hazards/roadwork.json',
    provenance:
      'https://www.data.nsw.gov.au/data/dataset/2-live-traffic-hazards',
  },
  {
    key: 'qld-cross-river-rail-contracts',
    name: 'Cross River Rail Delivery Authority Contract Disclosure',
    owner: 'Cross River Rail Delivery Authority',
    territory: 'QLD',
    sector: 'Rail',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=cross-river-rail-delivery-authority-contract-disclosure-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/cross-river-rail-delivery-authority-contract-disclosure-report',
  },
  {
    key: 'qld-hydro-april-2026-contracts',
    name: 'Queensland Hydro April 2026 Contract Disclosure',
    owner: 'Queensland Hydro',
    territory: 'QLD',
    sector: 'Energy',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=qld-hydro-april-2026-contract-disclosure-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/qld-hydro-april-2026-contract-disclosure-report',
  },
  {
    key: 'qld-stadiums-contracts-jul-dec-2025',
    name: 'Stadiums Queensland Contract Disclosure July to December 2025',
    owner: 'Stadiums Queensland',
    territory: 'QLD',
    sector: 'Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=stadiums-queensland-sq-contract-disclosure-july-to-december-2025',
    provenance:
      'https://www.data.qld.gov.au/dataset/stadiums-queensland-sq-contract-disclosure-july-to-december-2025',
  },
  {
    key: 'vic-current-mining-licences',
    name: 'Victoria Current Mining Licences and Leases',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Amin&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/current-mining-licences-and-leases',
  },
  {
    key: 'vic-current-exploration-licences',
    name: 'Victoria Current Mineral Exploration Licences',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Exploration',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Ael&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/current-mineral-exploration-licences',
  },
  {
    key: 'vic-current-extractive-tenements',
    name: 'Victoria Current Extractive Industry Tenements',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Extractive Industry',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Aewa&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/current-extractive-industry-tenements',
  },
  {
    key: 'vic-petroleum-wells',
    name: 'Victoria Petroleum Wells',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Apet_wells&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/petroleum-wells-from-geological-survey-of-victorias-dbmap-database',
  },
  {
    key: 'vic-current-prospecting-licences',
    name: 'Victoria Current Prospecting Licences',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Exploration',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Apl&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/current-prospecting-licences',
  },
  {
    key: 'vic-current-retention-licences',
    name: 'Victoria Current Retention Licences',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Mining',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Arl&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/current-retention-licences',
  },
  {
    key: 'vic-petroleum-tenements',
    name: 'Victoria Petroleum Tenements',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Apetrol&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/petroleum-tenements-victoria',
  },
  {
    key: 'vic-petroleum-acreage-releases',
    name: 'Victoria Petroleum Acreage Releases',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Oil & Gas',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Apetrolpro&outputFormat=application%2Fjson',
    provenance:
      'https://discover.data.vic.gov.au/dataset/petroleum-acreage-releases',
  },
  {
    key: 'vic-ccs-tenements',
    name: 'Victoria CCS Tenements',
    owner: 'Victorian Government - DEECA',
    territory: 'VIC',
    sector: 'Energy',
    licence: 'CC BY 4.0',
    method: 'WFS_DIRECT',
    endpoint:
      'https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform%3Accsten&outputFormat=application%2Fjson',
    provenance: 'https://discover.data.vic.gov.au/dataset/ccs-tenements',
  },
  {
    key: 'tas-current-exploration-licences',
    name: 'Tasmania Current Exploration Licences',
    owner: 'Mineral Resources Tasmania - Department of State Growth',
    territory: 'TAS',
    sector: 'Exploration',
    licence: 'CC BY 3.0 Australia',
    method: 'ARCGIS',
    endpoint:
      'https://data.stategrowth.tas.gov.au/ags/rest/services/MRT/TenementsWFS/MapServer/36/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://www.mrt.tas.gov.au/products/digital_data/data_downloads/mineral_tenement_data',
  },
  {
    key: 'tas-current-mining-leases',
    name: 'Tasmania Current Mining Leases and Production Licences',
    owner: 'Mineral Resources Tasmania - Department of State Growth',
    territory: 'TAS',
    sector: 'Mining',
    licence: 'CC BY 3.0 Australia',
    method: 'ARCGIS',
    endpoint:
      'https://data.stategrowth.tas.gov.au/ags/rest/services/MRT/TenementsWFS/MapServer/44/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://www.mrt.tas.gov.au/products/digital_data/data_downloads/mineral_tenement_data',
  },
  {
    key: 'qld-gladstone-water-board-contracts',
    name: 'Gladstone Area Water Board Contract Disclosure',
    owner: 'Gladstone Area Water Board',
    territory: 'QLD',
    sector: 'Water Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=gladstone-area-water-board-contract-disclosure-report',
    provenance:
      'https://www.data.qld.gov.au/dataset/gladstone-area-water-board-contract-disclosure-report',
  },
  {
    key: 'qld-mount-isa-water-board-contracts',
    name: 'Mount Isa Water Board Contract Disclosure 2025-2026',
    owner: 'Mount Isa Water Board',
    territory: 'QLD',
    sector: 'Water Infrastructure',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=miwb-contract-disclosure-register-2025-2026-csv',
    provenance:
      'https://www.data.qld.gov.au/dataset/miwb-contract-disclosure-register-2025-2026-csv',
  },
];
const LIVE_SOURCES = SOURCES.filter((source) => source.enabled !== false);
const HISTORICAL_SOURCES: SourceDef[] = [
  {
    key: 'wa-historical-exploration-points',
    name: 'WA Historical Exploration Activity - Points',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Historical Exploration',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/35/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/historical-exploration-activity-points-dmirs-086',
  },
  {
    key: 'wa-historical-exploration-lines',
    name: 'WA Historical Exploration Activity - Lines',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Historical Exploration',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/36/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/historical-exploration-activity-lines-dmirs-087',
  },
  {
    key: 'wa-historical-exploration-polygons',
    name: 'WA Historical Exploration Activity - Polygons',
    owner: 'Government of Western Australia - DEMIRS',
    territory: 'WA',
    sector: 'Historical Exploration',
    licence: 'CC BY 4.0',
    method: 'ARCGIS',
    endpoint:
      'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Industry_and_Mining/MapServer/37/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
    provenance:
      'https://catalogue.data.wa.gov.au/dataset/historical-exploration-activity-polygons-dmirs-088',
  },
  {
    key: 'qld-qbuild-work-register',
    name: 'Queensland QBuild Work Register 2025-26',
    owner: 'Queensland Government - Housing and Public Works',
    territory: 'QLD',
    sector: 'Maintenance',
    licence: 'CC BY 4.0',
    method: 'CKAN_PACKAGE',
    endpoint:
      'https://www.data.qld.gov.au/api/3/action/package_show?id=building-and-asset-services-work-register',
    provenance:
      'https://www.data.qld.gov.au/dataset/building-and-asset-services-work-register',
  },
];
const BACKFILL_SOURCES: SourceDef[] = [...LIVE_SOURCES, ...HISTORICAL_SOURCES];

const text = (v: unknown) =>
  typeof v === 'string'
    ? v.trim()
    : v === null || v === undefined
      ? ''
      : String(v);
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const stripHtml = (v: unknown) =>
  text(v)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const find = findField;

const fetchJson = sourceJson;
const fetchText = sourceText;

async function fetchProjectXlsx(source: SourceDef) {
  return projectWorkbookRows(
    source.key,
    await sourceWorkbook(source.endpoint),
  ).slice(0, 40);
}
const formatValue = (amount: number | null) =>
  amount && amount > 0
    ? 'A$' + Math.round(amount).toLocaleString('en-AU')
    : 'Not stated';

export function rawOpportunity(
  source: SourceDef,
  externalId: string,
  raw: Record<string, unknown>,
  observedAt: string,
): Opportunity {
  const title =
    find(raw, [
      'projectname',
      'sitename',
      'project',
      'projecttitle',
      'tenement',
      'tenure',
      'tno',
      'permitnumber',
      'permitreference',
      'authoritynumber',
      'authorityno',
      'eanumber',
      'contractid',
      'wellname',
      'sitename',
      'title',
      'road',
      'description',
      'name',
    ]) || externalId;
  const organisation = inferOrganisation(source.key, raw);
  const location =
    find(raw, [
      'locality',
      'location',
      'suburb',
      'shire',
      'lga',
      'miningdistrict',
      'region',
      'district',
      'area',
      'state',
    ]) || source.territory;
  const description = find(raw, [
    'worktype',
    'description',
    'descriptio',
    'activity',
    'purpose',
    'commodity',
    'resource',
    'permittype',
    'eventsubtype',
    'eventdueto',
    'type',
    'status',
    'industry',
  ]);
  const amount = num(find(raw, ['contractvalue', 'value', 'amount']));
  const low = (title + ' ' + description).toLowerCase();
  const equipment =
    low.includes('road') || low.includes('earth')
      ? 'PREDICTED · Excavators · graders · rollers'
      : low.includes('mine') || low.includes('mining')
        ? 'PREDICTED · Excavators · loaders · support fleet'
        : 'Equipment demand not yet evidenced';
  const stage: Opportunity['stage'] =
    source.key.includes('granted') || source.key.includes('transferred')
      ? 'PREPARE'
      : source.key.includes('environmental')
        ? 'RISING'
        : 'WATCH';
  const score = stage === 'PREPARE' ? 64 : stage === 'RISING' ? 56 : 44;
  return {
    sourceKey: source.key,
    externalId,
    project: title,
    location,
    stage,
    score,
    window:
      stage === 'PREPARE'
        ? 'Procurement timing requires verification'
        : stage === 'RISING'
          ? 'Early movement detected'
          : 'Early signal only',
    equipment,
    action:
      stage === 'PREPARE'
        ? 'Verify delivery organisation, timing and equipment requirement'
        : stage === 'RISING'
          ? 'Monitor progression and identify the delivery organisation'
          : 'Watch for corroborating evidence',
    company: organisation.name,
    organisationRole: organisation.role,
    description,
    value: formatValue(amount),
    observedAt,
    sourceObservedAt: extractSourceDate(raw, observedAt),
    provenance: source.provenance,
    evidenceType: 'EXPLICIT',
  };
}

async function collectCkanPackage(source: SourceDef) {
  return (await ckanResourceRows(source.endpoint, 40, 0)).rows;
}
async function collectTenure(source: SourceDef) {
  const body = (await fetchJson(source.endpoint)) as any;
  if (body.success !== true || !Array.isArray(body.result?.resources))
    throw new Error('CKAN_SCHEMA_INVALID');
  const rest = (body.result.resources as any[]).find(
    (r) =>
      String(r.format || '').toUpperCase() === 'REST' ||
      String(r.url || '').includes('MapServer'),
  );
  if (!rest?.url) return [];
  const base = String(rest.url).replace(/\/$/, '');
  const service = (await fetchJson(base + '?f=pjson')) as any;
  const layer =
    Array.isArray(service.layers) && service.layers.length
      ? service.layers[0].id
      : 0;
  const q = (await fetchJson(
    base +
      '/' +
      layer +
      '/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=40&f=json',
  )) as any;
  return Array.isArray(q.features)
    ? q.features.map((f: any, i: number) => ({
        externalId: recordIdentity(f.attributes || {}),
        raw: (f.attributes || {}) as Record<string, unknown>,
      }))
    : [];
}
async function collectKmlPackage(source: SourceDef) {
  const body = (await fetchJson(source.endpoint)) as any;
  if (body.success !== true || !Array.isArray(body.result?.resources))
    throw new Error('CKAN_SCHEMA_INVALID');
  const resource = (body.result.resources as any[]).find(
    (r) => String(r.format || '').toUpperCase() === 'KML' && r.url,
  );
  if (!resource?.url) throw new Error('KML_RESOURCE_MISSING');
  const xml = await fetchText(String(resource.url));
  const placemarks = [
    ...xml.matchAll(
      /<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi,
    ),
  ].slice(0, 40);
  return placemarks.map((m, i) => {
    const block = m[1];
    const raw: Record<string, unknown> = {};
    const name = block
      .match(/<(?:\w+:)?name>([\s\S]*?)<\/(?:\w+:)?name>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .trim();
    if (name) raw.name = name;
    for (const x of block.matchAll(
      /<(?:\w+:)?(?:SimpleData|Data)\b[^>]*name=['\"]([^'\"]+)['\"][^>]*>(?:<(?:\w+:)?value>)?([\s\S]*?)(?:<\/(?:\w+:)?value>)?<\/(?:\w+:)?(?:SimpleData|Data)>/gi,
    )) {
      raw[x[1]] = x[2]
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .trim();
    }
    const desc = block.match(
      /<(?:\w+:)?description>([\s\S]*?)<\/(?:\w+:)?description>/i,
    )?.[1];
    if (desc)
      raw.description = desc
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return { externalId: text(raw.id || raw.title || raw.name || i + 1), raw };
  });
}
function geoJsonRaw(feature: any): Record<string, unknown> {
  const props = (feature?.properties || {}) as Record<string, unknown>;
  const roads = Array.isArray((props as any).roads) ? (props as any).roads : [];
  const road = (roads[0] || {}) as Record<string, unknown>;
  const title = [
    text(road.mainStreet) ||
      text((props as any).name) ||
      text((props as any).headline) ||
      text((props as any).displayName),
    text((props as any).subCategoryA),
    text(road.suburb),
  ]
    .filter(Boolean)
    .join(' · ');
  const location = [text(road.suburb), text(road.region)]
    .filter(Boolean)
    .join(', ');
  const description = [
    text((props as any).mainCategory),
    text((props as any).subCategoryA),
    stripHtml((props as any).otherAdvice),
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    ...props,
    title: title || text(feature?.id) || 'Published roadwork',
    road: text(road.mainStreet),
    suburb: text(road.suburb),
    region: text(road.region),
    location,
    description,
  };
}
async function collectGeoJson(source: SourceDef) {
  const body = (await fetchJson(source.endpoint)) as any;
  if (!Array.isArray(body.features)) throw new Error('GEOJSON_SCHEMA_INVALID');
  return body.features.slice(0, 40).map((feature: any, index: number) => ({
    externalId: text(feature.id || feature.properties?.id || index + 1),
    raw: geoJsonRaw(feature),
  }));
}
async function collectWfs(source: SourceDef) {
  if (
    RECOVERED_WFS_LAYERS[source.key] ||
    /[?&]typeNames?=/i.test(source.endpoint)
  )
    return (await sourceWfsPage(source, 0, 40)).rows;
  const cap = await fetchText(
    source.endpoint + '?service=WFS&version=1.1.0&request=GetCapabilities',
  );
  const blocks = [
    ...cap.matchAll(
      /<(?:\w+:)?FeatureType\b[^>]*>([\s\S]*?)<\/(?:\w+:)?FeatureType>/gi,
    ),
  ];
  const names = blocks
    .map((m) => {
      const n = m[1].match(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/i);
      return n?.[1]?.trim() || '';
    })
    .filter(Boolean);
  if (!names.length) throw new Error('WFS_NO_FEATURE_TYPES');
  for (const name of names.slice(0, 4)) {
    const url =
      source.endpoint +
      '?service=WFS&version=1.1.0&request=GetFeature&typeName=' +
      encodeURIComponent(name) +
      '&outputFormat=application%2Fjson&maxFeatures=40';
    try {
      const b = (await fetchJson(url)) as any;
      if (Array.isArray(b.features) && b.features.length)
        return b.features.slice(0, 40).map((f: any, i: number) => ({
          externalId: text(
            f.id || f.properties?.OBJECTID || f.properties?.id || i + 1,
          ),
          raw: (f.properties || {}) as Record<string, unknown>,
        }));
    } catch {
      continue;
    }
  }
  throw new Error('WFS_NO_JSON_FEATURES');
}
async function collectWfsMatch(source: SourceDef) {
  const cap = await fetchText(
    source.endpoint +
      '?service=WFS&acceptversions=2.0.0&request=GetCapabilities',
  );
  const blocks = [
    ...cap.matchAll(
      /<(?:\w+:)?FeatureType\b[^>]*>([\s\S]*?)<\/(?:\w+:)?FeatureType>/gi,
    ),
  ];
  const needle = (source.match || '').trim().toLowerCase();
  if (!needle) throw new Error('WFS_MATCH_REQUIRED');
  const hit = blocks.find((m) =>
    m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .includes(needle),
  );
  const name = hit?.[1]
    .match(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/i)?.[1]
    ?.trim();
  if (!name) throw new Error('WFS_MATCH_NOT_FOUND');
  const url =
    source.endpoint +
    '?service=WFS&version=2.0.0&request=GetFeature&typeNames=' +
    encodeURIComponent(name) +
    '&outputFormat=application%2Fjson&count=40';
  const b = (await fetchJson(url)) as any;
  if (!Array.isArray(b.features)) throw new Error('WFS_MATCH_SCHEMA_INVALID');
  return b.features.slice(0, 40).map((f: any, i: number) => ({
    externalId: text(
      f.id ||
        f.properties?.OBJECTID ||
        f.properties?.id ||
        f.properties?.mine_id ||
        i + 1,
    ),
    raw: (f.properties || {}) as Record<string, unknown>,
  }));
}
async function collectWfsDirect(source: SourceDef) {
  return (await sourceWfsPage(source, 0, 40)).rows;
}
async function collectOcds(source: SourceDef) {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const b = (await fetchJson(
    source.endpoint + '/' + iso(start) + '/' + iso(end),
  )) as any;
  const releases = Array.isArray(b.releases)
    ? b.releases
    : Array.isArray(b.records)
      ? b.records.flatMap((x: any) => x.releases || [])
      : [];
  return releases.slice(0, 40).map((r: any, i: number) => {
    const c = Array.isArray(r.contracts) ? r.contracts[0] : undefined;
    const award = Array.isArray(r.awards) ? r.awards[0] : undefined;
    const amount = num(c?.value?.amount ?? award?.value?.amount);
    return {
      externalId: text(c?.id || r.id || r.ocid || i + 1),
      raw: {
        title: r.tender?.title || c?.id || r.id,
        description: r.tender?.description || award?.description || '',
        supplier: Array.isArray(award?.suppliers)
          ? award.suppliers[0]?.name
          : '',
        location: 'Australia',
        value: amount || '',
        date: r.date || '',
      } as Record<string, unknown>,
    };
  });
}
function odsLiveUrl(source: SourceDef) {
  const url = new URL(source.endpoint);
  if (source.key === 'melbourne-building-permits') {
    const existing = url.searchParams.get('where');
    url.searchParams.set(
      'where',
      existing
        ? '(' + existing + ') AND issue_date <= now()'
        : 'issue_date <= now()',
    );
  }
  return url.toString();
}
export async function collect(source: SourceDef) {
  const observedAt = new Date().toISOString();
  let rows: Array<{
    externalId: string;
    raw: Record<string, unknown>;
    metadataOnly?: boolean;
    qualityFlags?: string[];
  }> = [];
  if (source.method === 'ARCGIS') {
    const b = (await fetchJson(source.endpoint)) as any;
    if (!Array.isArray(b.features)) throw new Error('ARCGIS_SCHEMA_INVALID');
    rows = b.features.slice(0, 40).map((f: any, i: number) => ({
      externalId: recordIdentity(f.attributes || {}),
      raw: (f.attributes || {}) as Record<string, unknown>,
    }));
  }
  if (source.method === 'CKAN_DATASTORE') {
    const b = (await fetchJson(source.endpoint)) as any;
    if (b.success !== true || !Array.isArray(b.result?.records))
      throw new Error('CKAN_SCHEMA_INVALID');
    rows = b.result.records.slice(0, 40).map((r: any, i: number) => ({
      externalId: recordIdentity(r),
      raw: r as Record<string, unknown>,
    }));
  }
  if (source.method === 'CKAN_PACKAGE') rows = await collectCkanPackage(source);
  if (source.method === 'QLD_TENURE') rows = await collectTenure(source);
  if (source.method === 'OCDS') rows = await collectOcds(source);
  if (source.method === 'OPENDATASOFT') {
    const b = (await fetchJson(odsLiveUrl(source))) as any;
    if (!Array.isArray(b.results)) throw new Error('ODS_SCHEMA_INVALID');
    rows = b.results.slice(0, 40).map((r: any, i: number) => ({
      externalId: recordIdentity(r),
      raw: r as Record<string, unknown>,
    }));
  }
  if (source.method === 'WFS') rows = await collectWfs(source);
  if (source.method === 'WFS_MATCH') rows = await collectWfsMatch(source);
  if (source.method === 'WFS_DIRECT') rows = await collectWfsDirect(source);
  if (source.method === 'CKAN_KML') rows = await collectKmlPackage(source);
  if (source.method === 'XLSX_PROJECT') {
    const rs = await fetchProjectXlsx(source);
    rows = rs.map((r, i) => ({
      externalId: projectRecordIdentity(source.key, r),
      raw: r,
    }));
  }
  if (source.method === 'GEOJSON') rows = await collectGeoJson(source);
  const opportunities = rows
    .filter((r) => !r.metadataOnly)
    .map((r) => ({
      ...rawOpportunity(source, r.externalId, r.raw, observedAt),
      qualityFlags: r.qualityFlags,
    }));
  return { observedAt, recordsFetched: opportunities.length, opportunities };
}

async function upsertState(state: SourceState) {
  const page = await db.list<SourceState>('source_states', { limit: 100 });
  const hit = page.items.find((row) => row.sourceKey === state.sourceKey);
  const [saved] = hit
    ? await db.update('source_states', [{ id: hit.id, record: { ...state } }])
    : await db.add('source_states', [{ ...state }]);
  if (!saved) throw new Error('SOURCE_STATE_SAVE_FAILED');
}
const serializedBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');
function writeBatches<T>(items: T[]) {
  const batches: T[][] = [];
  let batch: T[] = [];
  for (const item of items) {
    if (serializedBytes(item) > 224 * 1024)
      throw new Error('OPPORTUNITY_RECORD_TOO_LARGE');
    if (batch.length && serializedBytes([...batch, item]) > 768 * 1024) {
      batches.push(batch);
      batch = [];
    }
    batch.push(item);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
async function persistOpportunities(items: Opportunity[]) {
  if (!items.length) return 0;
  const sourceKey = items[0].sourceKey;
  if (items.some((item) => item.sourceKey !== sourceKey))
    throw new Error('MIXED_SOURCE_BATCH');
  type IndexWithIntent = OpportunityIndex & {
    pendingAddIntent?: { externalIds: string[]; preparedAt: string };
  };
  const unique = [
    ...new Map(items.map((item) => [item.externalId, item])).values(),
  ];
  const indexes = await db.list<IndexWithIntent>('opportunity_indexes', {
    limit: 100,
  });
  const index = indexes.items.find((item) => item.sourceKey === sourceKey);
  if (!index && indexes.nextToken)
    throw new Error('OPPORTUNITY_INDEX_RECONCILIATION_REQUIRED');
  // An uncommitted add may already exist physically. Never infer absence from the old ID map.
  if (index && Object.hasOwn(index, 'pendingAddIntent'))
    throw new Error('OPPORTUNITY_PENDING_ADDS_RECONCILIATION_REQUIRED');
  const ids: Record<string, string> = Object.assign(
    Object.create(null),
    index?.ids || {},
  );
  if (!index) {
    // Bootstrap is safe only when this bounded discovery reaches the end of the legacy collection.
    let token: string | undefined;
    for (let i = 0; i < 2; i++) {
      const page = await db.list<Opportunity>('opportunities', {
        limit: 500,
        nextToken: token,
      });
      for (const row of page.items)
        if (row.sourceKey === sourceKey) ids[row.externalId] = row.id;
      if (page.nextToken && page.nextToken === token)
        throw new Error('OPPORTUNITY_INDEX_RECONCILIATION_REQUIRED');
      token = page.nextToken;
      if (!token) break;
    }
    if (token) throw new Error('OPPORTUNITY_INDEX_RECONCILIATION_REQUIRED');
  }
  const projected: Record<string, string> = Object.assign(
    Object.create(null),
    ids,
  );
  for (const item of unique) projected[item.externalId] ||= 'x'.repeat(64);
  if (serializedBytes({ sourceKey, ids: projected }) > 224 * 1024)
    throw new Error('OPPORTUNITY_INDEX_CAPACITY_REVIEW_REQUIRED');
  const updates = unique
    .filter((item) => ids[item.externalId])
    .map((item) => ({ id: ids[item.externalId], record: { ...item } }));
  const additions = unique.filter((item) => !ids[item.externalId]);
  const updateBatches = writeBatches(updates),
    addBatches = writeBatches(additions);
  let indexId = index?.id;
  async function saveIndex(record: IndexWithIntent) {
    if (serializedBytes(record) > 224 * 1024)
      throw new Error('OPPORTUNITY_INDEX_CAPACITY_REVIEW_REQUIRED');
    if (indexId) {
      const [acknowledged] = await db.update('opportunity_indexes', [
        { id: indexId, record },
      ]);
      if (!acknowledged) throw new Error('OPPORTUNITY_INDEX_SAVE_FAILED');
    } else {
      const [createdId] = await db.add('opportunity_indexes', [record]);
      if (!createdId) throw new Error('OPPORTUNITY_INDEX_SAVE_FAILED');
      indexId = createdId;
    }
  }
  if (additions.length) {
    // Persist intent before the first add. It survives quota errors, partial acknowledgements,
    // and failed final index writes. Clearing it requires a reviewed reconciliation, never a blind retry.
    await saveIndex({
      sourceKey,
      ids,
      pendingAddIntent: {
        externalIds: additions.map((item) => item.externalId),
        preparedAt: new Date().toISOString(),
      },
    });
  }
  let saved = 0;
  try {
    for (const batch of updateBatches)
      saved += (await db.update('opportunities', batch)).filter(Boolean).length;
    for (const batch of addBatches) {
      const results = await db.add(
        'opportunities',
        batch.map((item) => ({ ...item })),
      );
      if (
        results.length !== batch.length ||
        results.some((id) => typeof id !== 'string' || !id)
      ) {
        throw Object.assign(
          new Error('OPPORTUNITY_PENDING_ADDS_RECONCILIATION_REQUIRED'),
          {
            acknowledgedRecords:
              saved +
              results.filter((id) => typeof id === 'string' && id).length,
            persistenceUncertain: true,
          },
        );
      }
      results.forEach((id, i) => {
        ids[batch[i].externalId] = id!;
        saved++;
      });
    }
    // This acknowledgement commits the new IDs and clears the pending intent together.
    try {
      await saveIndex({ sourceKey, ids });
    } catch (cause) {
      if (cause instanceof Error)
        Object.assign(cause, {
          acknowledgedRecords: saved,
          persistenceUncertain: true,
        });
      throw cause;
    }
  } catch (cause) {
    if (cause instanceof Error) {
      const writeFailure = cause as Error & {
        acknowledgedRecords?: number;
        persistenceUncertain?: boolean;
      };
      writeFailure.acknowledgedRecords ??= saved;
      writeFailure.persistenceUncertain = true;
    }
    throw cause;
  }
  return saved;
}
export async function runSource(source: SourceDef): Promise<SourceState> {
  const started = Date.now();
  let collected: Awaited<ReturnType<typeof collect>> | undefined;
  try {
    collected = await collect(source);
    const unique = [
      ...new Map(
        collected.opportunities.map((row) => [row.externalId, row]),
      ).values(),
    ];
    const promoted = await persistOpportunities(unique);
    const datedRecords = unique.filter((row) =>
      Number.isFinite(Date.parse(row.sourceObservedAt || '')),
    ).length;
    const state: SourceState = {
      sourceKey: source.key,
      name: source.name,
      status:
        unique.length > 0 && promoted === unique.length
          ? 'SUCCESS'
          : 'DEGRADED',
      recordsFetched: collected.recordsFetched,
      opportunitiesPromoted: promoted,
      lastRun: collected.observedAt,
      durationMs: Date.now() - started,
      duplicateRecords: collected.opportunities.length - unique.length,
      datedRecords,
      undatedRecords: unique.length - datedRecords,
      persistenceFailures: unique.length - promoted,
      message: !unique.length
        ? 'Source reachable but no usable project records returned'
        : promoted < unique.length
          ? 'Only ' +
            promoted +
            ' of ' +
            unique.length +
            ' project records were saved'
          : 'Live source fetched, normalized and saved',
      licence: source.licence,
      provenance: source.provenance,
    };
    await upsertState(state);
    return state;
  } catch (cause) {
    if (isDatabaseQuotaError(cause)) throw cause;
    const message = cause instanceof Error ? cause.message : 'SOURCE_FAILED';
    if (message === 'SOURCE_STATE_SAVE_FAILED') throw cause;
    console.warn('HIRER_SOURCE_FAILED', source.key, message);
    const failure = cause as {
      acknowledgedRecords?: number;
      persistenceUncertain?: boolean;
    };
    const uncertain =
      failure?.persistenceUncertain === true ||
      message.includes('PENDING_ADDS_RECONCILIATION');
    const state: SourceState = {
      sourceKey: source.key,
      name: source.name,
      status: 'FAILED',
      recordsFetched: collected?.recordsFetched ?? 0,
      opportunitiesPromoted: failure?.acknowledgedRecords ?? 0,
      persistenceUncertain: uncertain,
      lastRun: new Date().toISOString(),
      durationMs: Date.now() - started,
      message:
        message +
        (uncertain
          ? ' · Storage outcome needs reconciliation; acknowledged rows may exist. Review any pending insertion intent before retrying.'
          : ''),
      licence: source.licence,
      provenance: source.provenance,
    };
    await upsertState(state);
    return state;
  }
}

function pilotMetrics(rows: PilotOutcome[]) {
  return aggregateOutcomeFunnel(rows);
}

function currentSourceStates(saved: SourceState[]): SourceState[] {
  const now = Date.now();
  return LIVE_SOURCES.map((source) => {
    const state = saved.find((item) => item.sourceKey === source.key);
    if (!state)
      return {
        sourceKey: source.key,
        name: source.name,
        status: 'DEGRADED',
        recordsFetched: 0,
        opportunitiesPromoted: 0,
        lastRun: '',
        message: 'No ingestion run has been recorded.',
        licence: source.licence,
        provenance: source.provenance,
      };
    const lastRun = Date.parse(state.lastRun);
    if (
      state.status === 'SUCCESS' &&
      (!Number.isFinite(lastRun) ||
        now - lastRun > 2 * 60 * 60 * 1000 ||
        lastRun > now + 5 * 60 * 1000)
    ) {
      return {
        ...state,
        status: 'DEGRADED',
        message:
          'Stored source result is stale; the scheduled refresh cycle is overdue or its timestamp is invalid.',
      };
    }
    return state;
  });
}

async function buildDashboardV2(userId: string, cursor?: string) {
  const backfill = await getBackfillStatus(BACKFILL_SOURCES);
  const s = await listBounded<SourceState>('source_states', {
    pageSize: 100,
    maxItems: 500,
  });
  const o = await loadEvidenceUniverse(cursor);
  const p = await listBounded<PilotOutcome>(`pilot_outcomes:${userId}`, {
    pageSize: 250,
    maxItems: 1000,
  });
  const raw = [...o.items].sort((a, b) =>
    (b.sourceObservedAt || b.observedAt).localeCompare(
      a.sourceObservedAt || a.observedAt,
    ),
  );
  const baseProjects = await buildProjectIntelligence(raw, BACKFILL_SOURCES);
  const projects = baseProjects.map((project) => ({
    ...project,
    callNow: isCallNowCandidate(project),
  }));
  const calibration = buildCalibrationMetrics(projects, p.items);
  const commercial = buildCommercialIntelligence(
    projects,
    p.items,
    BACKFILL_SOURCES,
  );
  const states = currentSourceStates(s.items);
  const success = states.filter((x) => x.status === 'SUCCESS').length;
  const fetched = states.reduce((n, x) => n + x.recordsFetched, 0);
  const metrics = pilotMetrics(p.items);
  const feed = projects
    .slice(0, 6)
    .map((x) => x.name + ' · ' + x.stageLabel + ' · priority ' + x.bdmPriority);
  return {
    metrics: {
      callNow: projects.filter((project) => project.callNow).length,
      active: projects.length,
      genesis: projects.filter((x) => x.stageLabel === 'WATCH').length,
      approvals: projects.filter((x) => x.stageLabel === 'APPROVAL').length,
      tenders: projects.filter(
        (x) => x.stageLabel === 'PROCUREMENT' || x.stageLabel === 'AWARDED',
      ).length,
      stageMoves: projects.filter((x) => x.stageChanged).length,
      highPriority: projects.filter((x) => x.priorityBand === 'HIGH').length,
      pilotQueue: commercial.pilotQueue.length,
      eventSignals: commercial.events.length,
      fleetWatch: commercial.fleetPositioning.length,
      workforce: 0,
    },
    projects,
    opportunities: raw.slice(0, 500),
    feed,
    commercial,
    sources: {
      configured: LIVE_SOURCES.length,
      active: success,
      runtimeFetched: fetched,
      rights: 'Lawful source automation',
      states,
      deferred: SOURCES.filter((x) => x.enabled === false).map((x) => ({
        sourceKey: x.key,
        name: x.name,
        licence: x.licence,
        provenance: x.provenance,
        reason: x.disableReason || 'Deferred pending revalidation',
      })),
    },
    pilot: {
      ...metrics,
      recentOutcomes: [...p.items]
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .slice(0, 25),
      humanEnteredOnly: true,
      calibration,
      wonValueLabel: metrics.wonValue
        ? 'AUD ' + metrics.wonValue.toLocaleString('en-AU')
        : '—',
      quotedValueLabel: metrics.quotedValue
        ? 'AUD ' + metrics.quotedValue.toLocaleString('en-AU')
        : '—',
    },
    backfill,
    coverage:
      success === LIVE_SOURCES.length
        ? LIVE_SOURCES.length +
          '/' +
          LIVE_SOURCES.length +
          ' lawful feeds successful'
        : states.length
          ? 'Latest source cycle ' +
            success +
            '/' +
            LIVE_SOURCES.length +
            ' successful'
          : 'Sources configured · refresh required',
    universe: {
      ...o.coverage,
      nextCursor: o.nextCursor,
      outcomesLoaded: p.items.length,
      outcomesTruncated: p.truncated,
    },
  };
}

export const refreshSourcesHandler = async () => {
  const result = await runRefreshSlice(LIVE_SOURCES, runSource);
  const failed = result.states.filter((state) => state.status !== 'SUCCESS');
  if (failed.length)
    console.warn(
      'LIVE_SOURCE_REFRESH_DEGRADED',
      failed.map((state) => state.sourceKey + ':' + state.message).join('|'),
    );
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: failed.length ? 'DEGRADED' : 'SUCCESS',
      processed: result.states.length,
      nextIndex: result.nextIndex,
      cycleWrapped: result.cycleWrapped,
      failed: failed.map((state) => state.sourceKey),
    }),
  };
};
export const backfillSourcesHandler = async () => {
  const last = await runBackfillBatch(BACKFILL_SOURCES);
  if (last.lastError) console.warn('BACKFILL_DEGRADED', last.lastError);
  return {
    statusCode: 200,
    body: JSON.stringify({
      status: last.lastError ? 'DEGRADED' : 'SUCCESS',
      backfill: last,
    }),
  };
};
async function buildPublicSummary() {
  const s = await listBounded<SourceState>('source_states', {
    pageSize: 100,
    maxItems: 500,
  });
  const o = await listBounded<Opportunity>('opportunities', {
    pageSize: 250,
    maxItems: 750,
  });
  const states = currentSourceStates(s.items);
  const success = states.filter((state) => state.status === 'SUCCESS').length;
  const groups = groupCanonicalEvidence(o.items);
  const counts: Record<string, number> = {
    WA: 0,
    QLD: 0,
    NSW: 0,
    VIC: 0,
    SA: 0,
    NT: 0,
    TAS: 0,
    ACT: 0,
  };
  const stateNames: Record<string, string> = {
    'WESTERN AUSTRALIA': 'WA',
    QUEENSLAND: 'QLD',
    'NEW SOUTH WALES': 'NSW',
    VICTORIA: 'VIC',
    'SOUTH AUSTRALIA': 'SA',
    'NORTHERN TERRITORY': 'NT',
    TASMANIA: 'TAS',
    'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
  };
  for (const rows of groups.values()) {
    let location = rows[0].location.toUpperCase();
    for (const [name, code] of Object.entries(stateNames))
      location = location.replace(name, code);
    const code = location.split(/[^A-Z]+/).find((token) => token in counts);
    if (code) counts[code] += 1;
  }
  return {
    metrics: {
      active: groups.size,
      eventSignals: o.items.length,
      highPriority: o.items.filter((item) => item.stage === 'PREPARE').length,
      callNow: 0,
    },
    sources: { active: success, configured: LIVE_SOURCES.length },
    coverage:
      success +
      '/' +
      LIVE_SOURCES.length +
      ' sources with recent successful ingestion',
    regionalCounts: counts,
    universe: {
      loaded: o.items.length,
      truncated: o.truncated,
      pagesRead: o.pagesRead,
    },
  };
}

export const handler = router({
  'GET /api/_healthcheck': [
    async () =>
      json({
        message: 'Success',
        engine: 'scope-2000-production',
        sources: LIVE_SOURCES.length,
        deferred: SOURCES.length - LIVE_SOURCES.length,
      }),
  ],
  'GET /api/public/summary': [async () => json(await buildPublicSummary())],
  'GET /api/dashboard': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(
          await buildDashboardV2(ctx.user!.userId, ctx.query?.cursor),
        );
      } catch (cause) {
        if (
          cause instanceof Error &&
          /^(INVALID_EVIDENCE_WINDOW_CURSOR|EVIDENCE_WINDOW_CHANGED_RESTART|EVIDENCE_WINDOW_PAGINATION_STALLED|EVIDENCE_WINDOW_CURSOR_TOO_LARGE)/.test(
            cause.message,
          )
        )
          return error(cause.message, 400);
        throw cause;
      }
    },
  ],
  'GET /api/sources/:key/diagnostic': [
    requireAuth(),
    async (ctx) => {
      const source = SOURCES.find((item) => item.key === ctx.params.key);
      if (!source) return error('Unknown source', 404);
      const started = Date.now();
      try {
        const result = await collect(source);
        return json({
          source: {
            key: source.key,
            name: source.name,
            enabled: source.enabled !== false,
            licence: source.licence,
            provenance: source.provenance,
          },
          durationMs: Date.now() - started,
          recordsFetched: result.recordsFetched,
          observedAt: result.observedAt,
          sample: result.opportunities.slice(0, 5),
          persisted: false,
          disclosure:
            'Read-only bounded collector check. No records were saved and this does not establish scheduled ingestion reliability.',
        });
      } catch (cause) {
        console.warn(
          'SOURCE_DIAGNOSTIC_UNAVAILABLE',
          source.key,
          cause instanceof Error ? cause.message : 'FAILED',
        );
        return error(
          'Collector check failed; the provider may be unavailable or its schema may have changed.',
          503,
        );
      }
    },
  ],

  'GET /api/sources/pilots/:key': [
    requireAuth(),
    async (ctx) => {
      const key = ctx.params.key;
      if (!Object.hasOwn(SOURCE_PILOT_CONTRACTS, key))
        return error('Unknown source pilot', 404);
      try {
        return json({
          ...(await fetchSourcePilot(key as SourcePilotKey, {
            pageSize: 10,
            maxPages: 1,
            maxRows: 10,
          })),
          contract: SOURCE_PILOT_CONTRACTS[key as SourcePilotKey],
        });
      } catch (cause) {
        console.warn(
          'SOURCE_PILOT_UNAVAILABLE',
          key,
          cause instanceof Error ? cause.message : 'FAILED',
        );
        return error('Source pilot unavailable; retry later', 503);
      }
    },
  ],

  'GET /api/evidence/review': [
    requireAuth(),
    async (ctx) => {
      try {
        return json(
          await getEvidencePage({
            origin: (ctx.query.origin || 'ARCHIVE') as 'LIVE' | 'ARCHIVE',
            cursor: ctx.query.cursor,
            limit: ctx.query.limit ? Number(ctx.query.limit) : 100,
          }),
        );
      } catch (cause) {
        if (
          cause instanceof Error &&
          /^(INVALID_EVIDENCE_|EVIDENCE_PAGE_CHANGED|EVIDENCE_PAGINATION_STALLED)/.test(
            cause.message,
          )
        )
          return error(cause.message, 400);
        throw cause;
      }
    },
  ],
  'GET /api/pilot/outcomes': [
    requireAuth(),
    async (ctx) =>
      json(
        (
          await listBounded<PilotOutcome>(
            `pilot_outcomes:${ctx.user!.userId}`,
            { pageSize: 250, maxItems: 1000 },
          )
        ).items,
      ),
  ],
  'GET /api/reports/history': [
    requireAuth(),
    async (ctx) => json(await listReportHistory(ctx.user!)),
  ],
  'POST /api/reports/history': [
    requireAuth(),
    async (ctx) => {
      if (!validReportHistory(ctx.body))
        return error(
          'Valid report metadata and non-negative integer counts are required',
          400,
        );
      const saved = await saveReportHistory(ctx.user!, ctx.body);
      return saved
        ? json(saved, 201)
        : error('Report history save failed', 500);
    },
  ],
  'POST /api/demo-request': [
    async ({ body }) => {
      const saved = await saveDemoRequest(body);
      return saved.ok ? json(saved, 201) : error(saved.error, 400);
    },
  ],
  'POST /api/pilot/outcomes': [
    requireAuth(),
    async (ctx) => {
      const body = ctx.body;
      const b = (body || {}) as Record<string, unknown>;
      const projectId = text(b.projectId);
      const result = text(b.result) as PilotOutcome['result'];
      const valid = [
        'CONTACTED',
        'REQUIREMENT_CONFIRMED',
        'QUOTED',
        'WON',
        'LOST',
        'FALSE_POSITIVE',
      ];
      if (!projectId || !valid.includes(result))
        return error('Canonical project and valid result are required', 400);
      if (
        b.evidenceCursor !== undefined &&
        typeof b.evidenceCursor !== 'string'
      )
        return error('Invalid evidence cursor', 400);
      let opportunityPage;
      try {
        opportunityPage = await loadEvidenceUniverse(
          b.evidenceCursor as string | undefined,
        );
      } catch (cause) {
        if (
          cause instanceof Error &&
          /^(INVALID_EVIDENCE_WINDOW_CURSOR|EVIDENCE_WINDOW_CHANGED_RESTART|EVIDENCE_WINDOW_PAGINATION_STALLED|EVIDENCE_WINDOW_CURSOR_TOO_LARGE)/.test(
            cause.message,
          )
        )
          return error(cause.message, 400);
        throw cause;
      }
      const currentProjects = await buildProjectIntelligence(
        opportunityPage.items,
        BACKFILL_SOURCES,
      );
      const linked = currentProjects.find(
        (project) => project.id === projectId,
      );
      if (!linked)
        return error(
          'Canonical project ID was not found in this evidence window; refresh the window and retry',
          400,
        );
      const quoteValue = num(b.quoteValue);
      const wonValue = num(b.wonValue);
      if (result === 'QUOTED' && (!quoteValue || quoteValue <= 0))
        return error('Quoted outcome requires quote value', 400);
      if (result === 'WON' && (!wonValue || wonValue <= 0))
        return error('Won outcome requires won hire value', 400);
      const qa = text(b.qa).toLowerCase() === 'true';
      const row: PilotOutcome = {
        projectId: linked.id,
        project: linked.name,
        result,
        advanceDays: num(b.advanceDays),
        quoteValue,
        wonValue,
        notes: text(b.notes),
        recordedAt: new Date().toISOString(),
        qa,
        signalQualityBand: linked.signalQualityBand,
        bdmPriority: linked.bdmPriority,
        stageLabel: linked.stageLabel,
        equipmentClasses: linked.equipmentPrediction.classes,
        sourceKeys: linked.sources,
      };
      const [id] = await db.add(`pilot_outcomes:${ctx.user!.userId}`, [
        { ...row },
      ]);
      if (!id) return error('Outcome save failed', 500);
      return json(
        {
          id,
          projectId: row.projectId,
          qa: row.qa,
          metrics: pilotMetrics(
            (
              await listBounded<PilotOutcome>(
                `pilot_outcomes:${ctx.user!.userId}`,
                { pageSize: 250, maxItems: 1000 },
              )
            ).items,
          ),
        },
        201,
      );
    },
  ],
});
