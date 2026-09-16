/** Public read-only pilots. Registry activation requires a separate acceptance decision. */
export type SourcePilotKey =
  'logan-development-applications' | 'qld-coordinated-projects';
export type SourcePilotContract = {
  key: SourcePilotKey;
  name: string;
  owningAgency: string;
  endpoint: string;
  metadataUrl: string;
  resourceVersion: string;
  licence: { name: string; version: string; url: string; termsUrl: string };
  attribution: string;
  changeNotice: string;
  rightsReview: {
    checkedAt: string;
    status: 'METADATA_VERIFIED_ACTIVATION_REVIEW_PENDING';
    evidenceUrls: readonly string[];
    limitations: string;
  };
  expectedCadence: 'NIGHTLY' | 'UNVERIFIED';
  proposedPollHours: number;
  pagination: { orderBy: string; objectIdField: string; strategy: string };
  requiredFields: readonly string[];
  fields: readonly string[];
  qualityGates: readonly string[];
  activationEnabled: false;
  contextOnly: true;
};

const licenceUrl = 'https://creativecommons.org/licenses/by/3.0/au/';
const loganEndpoint =
  'https://services5.arcgis.com/ZUCWDRj8F77Xo351/ArcGIS/rest/services/Logan_City_Undecided_Development_Applications/FeatureServer/0';
const qldEndpoint =
  'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/StatePlanning/MapServer/25';
const loganItem =
  'https://www.arcgis.com/sharing/rest/content/items/50489a44f46b45b5857bcc7f9aa95f20?f=json';
const qldCatalogue =
  'https://www.data.qld.gov.au/dataset/coordinated-projects-the-coordinator-general';
const commonGates = [
  'RIGHTS_AND_ATTRIBUTION_REVIEW',
  'PRODUCTION_RUNTIME_CANARY',
  'OBSERVED_SCHEDULED_INGESTION',
  'SCHEMA_AND_STABLE_ID_CHECK',
  'FIXED_COMMERCIAL_RELEVANCE_REVIEW',
];
const loganRequired = [
  'Application_System_ID',
  'Application_Amendment',
  'Application_Number',
  'Application_Description',
  'Application_Status',
  'Application_Lodgement_Date',
  'fme_rejection_code',
];
const qldFields = [
  'name',
  'projectstatus',
  'description',
  'weblink',
  'objectid',
];

export const SOURCE_PILOT_CONTRACTS: Readonly<
  Record<SourcePilotKey, SourcePilotContract>
> = {
  'logan-development-applications': {
    key: 'logan-development-applications',
    name: 'Logan undecided development applications',
    owningAgency: 'Logan City Council',
    endpoint: loganEndpoint,
    metadataUrl: loganEndpoint + '?f=json',
    resourceVersion:
      'ArcGIS item 50489a44f46b45b5857bcc7f9aa95f20, FeatureServer layer 0; schema checked 2026-09-16',
    licence: {
      name: 'Creative Commons Attribution 3.0 Australia',
      version: '3.0 AU',
      url: licenceUrl,
      termsUrl: loganItem,
    },
    attribution:
      'Source: Logan City Council. Licensed under Creative Commons Attribution 3.0 Australia.',
    changeNotice:
      'Filtered commercial descriptions, normalised dates and text, grouped applications and amendments across parcels, retained source quality flags.',
    rightsReview: {
      checkedAt: '2026-09-16',
      status: 'METADATA_VERIFIED_ACTIVATION_REVIEW_PENDING',
      evidenceUrls: [loganItem, loganEndpoint + '?f=json'],
      limitations:
        'Licence metadata checked; no legal certification. Verify product attribution and privacy treatment before activation. Applicant names are not delivery contractors; no personal contact enrichment.',
    },
    expectedCadence: 'NIGHTLY',
    proposedPollHours: 24,
    pagination: {
      orderBy: 'OBJECTID ASC',
      objectIdField: 'OBJECTID',
      strategy:
        'Bounded ordered offsets within one read; OBJECTID is a page cursor only, never project identity. Nightly replacement is not a snapshot guarantee.',
    },
    requiredFields: loganRequired,
    fields: [
      'OBJECTID',
      ...loganRequired,
      'Application_Applicant',
      'Application_Decision_Status',
      'Application_Development_Type_De',
      'Application_Property_Key',
      'Application_Property_Lot_Plan',
      'Application_Property_Suburb',
      'PDonline_Link',
    ],
    qualityGates: [
      ...commonGates,
      'RESOLVE_UPSTREAM_INVALID_INPUT',
      'PARCEL_AND_AMENDMENT_DEDUP',
      'LODGEMENT_IS_NOT_COMMENCEMENT',
    ],
    activationEnabled: false,
    contextOnly: true,
  },
  'qld-coordinated-projects': {
    key: 'qld-coordinated-projects',
    name: 'Queensland coordinated projects',
    owningAgency:
      'State of Queensland (State Development, Infrastructure and Planning)',
    endpoint: qldEndpoint,
    metadataUrl: qldEndpoint + '?f=json',
    resourceVersion:
      'StatePlanning MapServer layer 25; schema checked 2026-09-16',
    licence: {
      name: 'Creative Commons Attribution 3.0 Australia',
      version: '3.0 AU',
      url: licenceUrl,
      termsUrl: qldCatalogue,
    },
    attribution:
      'Source: State of Queensland (State Development, Infrastructure and Planning). Licensed under Creative Commons Attribution 3.0 Australia.',
    changeNotice:
      'Decoded HTML links and text, grouped title plus authoritative URL, retained assessment status and undated context.',
    rightsReview: {
      checkedAt: '2026-09-16',
      status: 'METADATA_VERIFIED_ACTIVATION_REVIEW_PENDING',
      evidenceUrls: [
        qldCatalogue,
        'https://www.data.qld.gov.au/api/3/action/package_show?id=coordinated-projects-the-coordinator-general',
        qldEndpoint + '?f=json',
      ],
      limitations:
        'Catalogue licence and layer attribution checked; verify product attribution before activation. No verified row activity date or contractor; status freshness requires project-page corroboration.',
    },
    expectedCadence: 'UNVERIFIED',
    proposedPollHours: 168,
    pagination: {
      orderBy: 'objectid ASC',
      objectIdField: 'objectid',
      strategy:
        'Bounded ordered offsets; title plus authoritative URL identifies projects. No transactional snapshot or publisher cadence verified.',
    },
    requiredFields: qldFields,
    fields: qldFields,
    qualityGates: [
      ...commonGates,
      'VERIFY_PROJECT_PAGE_STATUS',
      'UNDATED_CONTEXT_ONLY',
      'GENERIC_LINK_REVIEW',
    ],
    activationEnabled: false,
    contextOnly: true,
  },
};
