import type { jsPDF } from 'jspdf';

type DashboardLike = Record<string, any>;
export type ReportSummary = {
  generatedAt: string;
  headline: string;
  projectCount: number;
  opportunityCount: number;
  highPriorityCount: number;
  callNowCount: number;
  liveFeeds: string;
  failedFeeds: number;
  deferredFeeds: number;
  evidenceProcessed: number;
  completedBackfill: string;
  predictedDemandClusters: number;
  dataWindow: string;
};

export function buildExecutiveReportSummary(
  dashboard: DashboardLike,
): ReportSummary {
  const projects = dashboard.projects || [];
  const events = dashboard.commercial?.events || [];
  const high = projects.filter(
    (project: any) => project.priorityBand === 'HIGH',
  ).length;
  const failed = (dashboard.sources?.states || []).filter(
    (source: any) => source.status === 'FAILED',
  ).length;
  const universe = dashboard.universe || {};
  return {
    generatedAt: new Date().toISOString(),
    headline: `${projects.length} canonical projects, ${events.length} opportunity signals, ${high} high-priority projects in this evidence window`,
    projectCount: projects.length,
    opportunityCount: events.length,
    highPriorityCount: high,
    callNowCount: Number(dashboard.metrics?.callNow || 0),
    liveFeeds: `${dashboard.sources?.active || 0}/${dashboard.sources?.configured || 0}`,
    failedFeeds: failed,
    deferredFeeds: dashboard.sources?.deferred?.length || 0,
    evidenceProcessed: dashboard.backfill?.processed || 0,
    completedBackfill: `${dashboard.backfill?.completedSources || 0}/${dashboard.backfill?.totalSources || 0}`,
    predictedDemandClusters:
      dashboard.commercial?.equipmentClusters?.length || 0,
    dataWindow:
      (universe.archiveRecordsLoaded !== undefined
        ? `${universe.loaded ?? 0} unique evidence records in this evidence window from current and archived sources; ${universe.liveLoaded ?? 0} current rows and ${universe.archiveRecordsLoaded ?? 0} archived rows read.${universe.truncated ? ' Bounded view: additional stored records exist.' : ''}${universe.invalidArchiveRecords || universe.invalidArchivePages ? ' Some archive rows or pages need review and are excluded.' : ''}`
        : `${universe.loaded ?? projects.length} records loaded in this evidence window.${universe.truncated ? ' Additional stored records exist.' : ''}`) +
      ' Project search, rankings, counts and evidence report sections apply only to this window; earlier windows may contain additional records. CRM outcomes retain their account scope; source health and backfill retain system scope. Calibration matches outcomes to projects in this window only.',
  };
}

function section(doc: jsPDF, title: string, subtitle?: string) {
  doc.addPage();
  doc.setFontSize(16);
  doc.text(title, 14, 18);
  if (subtitle) {
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(subtitle, 180), 14, 24);
  }
}

function writePaginatedNotes(
  doc: jsPDF,
  title: string,
  text: string,
  startY: number,
) {
  const margin = 14;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  doc.setFontSize(7.5);
  const lines = doc.splitTextToSize(text, width) as string[];
  const lineHeight = Math.max(
    3.5,
    doc.getLineHeight() / doc.internal.scaleFactor,
  );
  let y = startY;
  const heading = (continued: boolean) => {
    doc.setFontSize(9);
    doc.text(continued ? title + ' (continued)' : title, margin, y);
    y += 6;
    doc.setFontSize(7.5);
  };
  if (y + 6 + lineHeight > bottom) {
    doc.addPage();
    y = 18;
  }
  heading(false);
  for (const line of lines) {
    if (y + lineHeight > bottom) {
      doc.addPage();
      y = 18;
      heading(true);
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
}

function regionalRows(projects: any[]) {
  const regions = new Map<
    string,
    { projects: number; high: number; equipment: Set<string> }
  >();
  for (const project of projects) {
    const region = project.location || 'Location unresolved';
    const row = regions.get(region) || {
      projects: 0,
      high: 0,
      equipment: new Set<string>(),
    };
    row.projects += 1;
    if (project.priorityBand === 'HIGH') row.high += 1;
    for (const item of project.equipmentPrediction?.classes || [])
      row.equipment.add(item);
    regions.set(region, row);
  }
  return [...regions.entries()]
    .map(([region, row]) => [
      region,
      String(row.projects),
      String(row.high),
      [...row.equipment].join(', ') || 'No class inferred',
    ])
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 40);
}

export async function downloadExecutivePdf(
  dashboard: DashboardLike,
  signal?: AbortSignal,
) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  signal?.throwIfAborted();
  const summary = buildExecutiveReportSummary(dashboard);
  const projects = dashboard.projects || [];
  const events = dashboard.commercial?.events || [];
  const contractors = dashboard.commercial?.contractorWorkload || [];
  const clusters = dashboard.commercial?.equipmentClusters || [];
  const fleet = dashboard.commercial?.fleetPositioning || [];
  const calibration = dashboard.commercial?.calibration || {};
  const deferred = dashboard.sources?.deferred || [];
  const sourceStates = dashboard.sources?.states || [];
  const callNow = projects.filter((project: any) => project.callNow === true);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  doc.setFontSize(22);
  doc.text('Hire Intelligence', 14, 20);
  doc.setFontSize(15);
  doc.text('Executive Intelligence Report', 14, 29);
  doc.setFontSize(9);
  doc.text(
    `Generated ${new Date(summary.generatedAt).toLocaleString('en-AU')}`,
    14,
    36,
  );
  doc.text(
    'Evidence-governed equipment-rental opportunity intelligence',
    14,
    42,
  );
  autoTable(doc, {
    startY: 50,
    head: [['Executive metric', 'Current position']],
    body: [
      ['Loaded canonical projects', String(summary.projectCount)],
      ['Opportunity signals', String(summary.opportunityCount)],
      ['High-priority projects', String(summary.highPriorityCount)],
      ['CALL NOW', String(summary.callNowCount)],
      ['Successful / configured feeds', summary.liveFeeds],
      ['Failed current feeds', String(summary.failedFeeds)],
      ['Deferred collectors', String(summary.deferredFeeds)],
      [
        'Historical evidence processed',
        summary.evidenceProcessed.toLocaleString('en-AU'),
      ],
      ['Backfill sources completed', summary.completedBackfill],
      ['PREDICTED demand clusters', String(summary.predictedDemandClusters)],
      ['Data window', summary.dataWindow],
    ],
    styles: { fontSize: 8 },
  });
  const finalY = (doc as any).lastAutoTable?.finalY || 120;
  doc.setFontSize(10);
  doc.text('Decision interpretation', 14, finalY + 9);
  doc.setFontSize(8);
  doc.text(
    doc.splitTextToSize(
      'CALL NOW requires a strong current project signal, evidence-backed delivery contractor, sufficiently fresh evidence and a meaningful predicted equipment class. PREDICTED equipment is an analytical inference and is not a confirmed hire requirement. Users must verify contractor, timing and equipment requirement before outreach or fleet movement.',
      180,
    ),
    14,
    finalY + 15,
  );

  section(
    doc,
    'CALL NOW Queue',
    'Highest-confidence commercially actionable records meeting the evidence gate.',
  );
  autoTable(doc, {
    startY: 30,
    head: [
      [
        'Project',
        'Location',
        'Stage',
        'Priority',
        'Contractor',
        'PREDICTED equipment',
      ],
    ],
    body: callNow
      .slice(0, 30)
      .map((project: any) => [
        project.name,
        project.location,
        project.stageLabel,
        String(project.bdmPriority),
        (project.contractors || []).join(', ') || 'Not evidenced',
        (project.equipmentPrediction?.classes || []).join(', ') ||
          'Not inferred',
      ]),
    styles: { fontSize: 6.8 },
  });

  section(
    doc,
    'Top Ranked Projects',
    'Canonical projects consolidated from evidence in this window only.',
  );
  autoTable(doc, {
    startY: 30,
    head: [
      [
        'Project',
        'Location',
        'Stage',
        'Priority',
        'Signal',
        'PREDICTED equipment',
        'Evidence',
      ],
    ],
    body: projects
      .slice(0, 50)
      .map((project: any) => [
        project.name,
        project.location,
        project.stageLabel,
        String(project.bdmPriority),
        project.signalQualityBand || '-',
        (project.equipmentPrediction?.classes || []).join(', ') ||
          'Not inferred',
        String(project.evidenceCount || 0),
      ]),
    styles: { fontSize: 6.2, cellPadding: 1.4 },
  });

  section(
    doc,
    'Regional Intelligence',
    'Unique project counts in this evidence window by current location label; state-level and approximate map records remain disclosed in the platform.',
  );
  autoTable(doc, {
    startY: 30,
    head: [
      [
        'Region / location',
        'Projects',
        'High priority',
        'PREDICTED equipment classes',
      ],
    ],
    body: regionalRows(projects),
    styles: { fontSize: 6.5 },
  });

  section(doc, 'Current Opportunity Signals');
  autoTable(doc, {
    startY: 25,
    head: [
      [
        'Signal',
        'Project',
        'Location',
        'Confidence',
        'Stage',
        'Recommended action',
      ],
    ],
    body: events
      .slice(0, 60)
      .map((event: any) => [
        event.type,
        event.project,
        event.location,
        `${event.confidence}%`,
        event.stage || '-',
        event.action || event.reason || '-',
      ]),
    styles: { fontSize: 6.2, cellPadding: 1.4 },
  });

  section(
    doc,
    'Delivery Organisations and Workload',
    'Only organisations classified as delivery contractors should appear as contractors; owners/applicants/operators are separated in the platform.',
  );
  autoTable(doc, {
    startY: 30,
    head: [
      [
        'Delivery organisation',
        'Projects',
        'High priority',
        'Avg priority',
        'Locations',
        'PREDICTED equipment',
      ],
    ],
    body: contractors
      .slice(0, 50)
      .map((item: any) => [
        item.contractor,
        String(item.projectCount),
        String(item.highPriorityProjects),
        String(item.averagePriority),
        (item.locations || []).join(', '),
        (item.predictedEquipment || []).join(', ') || 'Not inferred',
      ]),
    styles: { fontSize: 6.2 },
  });

  section(
    doc,
    'PREDICTED Equipment Demand and Fleet Positioning',
    'Heuristic confidence is not a statistically calibrated probability and must not be read as a confirmed requirement.',
  );
  autoTable(doc, {
    startY: 30,
    head: [
      [
        'Location',
        'Equipment class',
        'Projects',
        'Avg priority',
        'Heuristic confidence',
      ],
    ],
    body: clusters
      .slice(0, 50)
      .map((item: any) => [
        item.location,
        item.equipmentClass,
        String(item.projectCount),
        String(item.averagePriority),
        `${item.confidence}%`,
      ]),
    styles: { fontSize: 6.5 },
  });
  const clusterY = (doc as any).lastAutoTable?.finalY || 120;
  writePaginatedNotes(
    doc,
    'Fleet positioning watches',
    fleet
      .slice(0, 15)
      .map(
        (item: any) =>
          `- ${item.equipmentClass} / ${item.location}: ${item.recommendation}`,
      )
      .join('\n') ||
      'No fleet-positioning watches meet the current evidence threshold.',
    clusterY + 9,
  );

  section(doc, 'Source Health and Provenance');
  autoTable(doc, {
    startY: 25,
    head: [['Source', 'Status', 'Fetched', 'Last run', 'Provenance']],
    body: sourceStates
      .slice(0, 80)
      .map((source: any) => [
        source.name || source.sourceKey,
        source.status,
        String(source.recordsFetched || 0),
        source.lastRun || '-',
        source.provenance || '-',
      ]),
    styles: { fontSize: 5.8 },
  });

  section(doc, 'Deferred Sources and Calibration');
  autoTable(doc, {
    startY: 25,
    head: [['Deferred source', 'Reason']],
    body: deferred
      .slice(0, 40)
      .map((item: any) => [
        item.name || item.sourceKey,
        item.reason || 'Deferred pending revalidation',
      ]),
    styles: { fontSize: 6.4 },
  });
  const dataY = (doc as any).lastAutoTable?.finalY || 120;
  writePaginatedNotes(
    doc,
    'Commercial calibration',
    `Reviewed outcomes linked to this evidence window: ${calibration.linkedRealOutcomes || 0}. Reviewed outcomes outside loaded projects: ${calibration.unmatchedRealOutcomes || 0}; these may belong to another window. Calibration matches current-window projects only. Sample sufficient: ${calibration.sufficientSample ? 'yes' : 'no'}. Funnel metrics are unique-project based, not raw event-row counts.`,
    dataY + 9,
  );

  section(doc, 'Governance');
  doc.setFontSize(9);
  doc.text(
    doc.splitTextToSize(
      'Hire Intelligence does not invent personal contacts, confirmed hire requirements, calls, quotes or wins. Public-source provenance remains attached to underlying evidence. Organisation roles should distinguish delivery contractors from owners, proponents, applicants, holders and operators. Equipment outputs are explicitly PREDICTED. Commercial outcomes are human-entered. Source failures remain visible rather than silently counted as active. All commercial decisions require verification.',
      180,
    ),
    14,
    30,
  );

  const filename = `Hire-Intelligence-Executive-Report-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
  return filename;
}
