import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Database,
  Download,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Map as MapIcon,
  MapPin,
  Search,
  Settings,
  Target,
  Truck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import GeoMap from './GeoMap';
import { useDialogFocus } from './useDialogFocus';
import { buildExecutiveReportSummary, downloadExecutivePdf } from './reporting';
import './internal-functional.css';

type Evidence = {
  id?: string;
  externalId: string;
  project: string;
  location: string;
  company: string;
  sourceKey: string;
  provenance: string;
  description: string;
  observedAt: string;
  sourceObservedAt?: string;
  value: string;
};

type Project = {
  id: string;
  name: string;
  location: string;
  company: string;
  contractors: string[];
  sources: string[];
  records: Evidence[];
  evidenceCount: number;
  value: string;
  stageLabel: string;
  stageConfidence: number;
  stageReason: string;
  stageChanged: boolean;
  previousStage: string;
  equipmentPrediction: {
    label: 'PREDICTED';
    classes: string[];
    confidence: number;
    confidenceBand: string;
    reason: string;
  };
  signalQualityScore: number;
  signalQualityBand: string;
  bdmPriority: number;
  priorityBand: 'HIGH' | 'MEDIUM' | 'WATCH';
  latitude?: number;
  longitude?: number;
  locationPrecision?: 'EXACT' | 'APPROXIMATE' | 'STATE_LEVEL';
};

type OpportunityEvent = {
  projectId: string;
  project: string;
  location: string;
  type: string;
  confidence: number;
  reason: string;
  provenance?: string[];
  detectedAt?: string;
  stage?: string;
  bdmPriority?: number;
  priorityBand?: string;
  action?: string;
};

type SourceState = {
  sourceKey: string;
  name: string;
  status: string;
  recordsFetched: number;
  opportunitiesPromoted?: number;
  lastRun?: string;
  message?: string;
  licence?: string;
  provenance?: string;
};

type Dashboard = {
  metrics: Record<string, number>;
  projects: Project[];
  commercial: Record<string, any> & {
    events: OpportunityEvent[];
    pilotQueue?: Array<Record<string, any>>;
    contractorWorkload?: Array<Record<string, any>>;
    equipmentClusters?: Array<Record<string, any>>;
    fleetPositioning?: Array<Record<string, any>>;
    sourceCoverage?: Array<Record<string, any>>;
    scopeProgram?: Array<Record<string, any>>;
    calibration?: Record<string, any>;
  };
  sources: {
    configured: number;
    active: number;
    runtimeFetched: number;
    states: SourceState[];
    deferred: Array<Record<string, any>>;
  };
  pilot: Record<string, any> & {
    recentOutcomes?: Array<Record<string, any>>;
  };
  backfill: {
    processed: number;
    completedSources: number;
    totalSources: number;
    nextSource: string;
    lastSource: string;
    lastRun: string;
    lastError: string;
  };
  coverage: string;
  universe?: { loaded?: number; truncated?: boolean; pagesRead?: number; outcomesLoaded?: number; outcomesTruncated?: boolean };
};

type SavedReport = {
  id: string;
  at: string;
  summary: string;
  filename?: string;
};

type ViewName =
  | 'Decision Desk'
  | 'Commercial Intelligence'
  | 'Opportunities'
  | 'Projects'
  | 'Map'
  | 'Organisations & Delivery Teams'
  | 'Equipment Demand'
  | 'Resources'
  | 'CRM'
  | 'Reports'
  | 'Alerts'
  | 'Source Admin';

type ViewDefinition = {
  name: ViewName;
  description: string;
  icon: LucideIcon;
};

const VIEWS: ViewDefinition[] = [
  { name: 'Decision Desk', description: 'Daily ranked rental intelligence and source health.', icon: LayoutDashboard },
  { name: 'Commercial Intelligence', description: 'Commercial signals, contractor workload and fleet positioning.', icon: BarChart3 },
  { name: 'Opportunities', description: 'Evidence-derived events that may create future hire demand.', icon: Target },
  { name: 'Projects', description: 'Canonical project records consolidating evidence, stage and priority.', icon: FolderKanban },
  { name: 'Map', description: 'Geographic project and opportunity intelligence.', icon: MapIcon },
  { name: 'Organisations & Delivery Teams', description: 'Evidence-backed organisations linked to active projects.', icon: Building2 },
  { name: 'Equipment Demand', description: 'Explicitly PREDICTED equipment classes and regional clusters.', icon: Truck },
  { name: 'Resources', description: 'Resource-sector projects and source coverage.', icon: FileText },
  { name: 'CRM', description: 'Human-entered BDM outcomes and calibration.', icon: Users },
  { name: 'Reports', description: 'Current-state executive intelligence reporting.', icon: Download },
  { name: 'Alerts', description: 'High-priority, stage-change and tender-related evidence signals.', icon: Bell },
  { name: 'Source Admin', description: 'Live feed health, deferred sources and historical backfill.', icon: Settings },
];

const CANDIDATES = [
  'NSW DA',
  'NSW CDC',
  'NSW PCC',
  'NSW Mine Approvals',
  'Vic Industrial Land',
  'Melbourne Water',
  'QLD Priority Development',
  'WA Environment',
  'SA Major Development',
  'NT Development Applications',
  'Tas Planning',
  'ACT Development Applications',
];

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}


function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'HI';
}

function dateLabel(value?: string) {
  if (!value) return 'Current';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-AU');
}

function EmptyState({ children }: { children: string }) {
  return <div className='hi-empty'>{children}</div>;
}

const VIEW_SLUGS: Record<ViewName, string> = {
  'Decision Desk': 'decision-desk',
  'Commercial Intelligence': 'commercial-intelligence',
  'Opportunities': 'opportunities',
  'Projects': 'projects',
  'Map': 'map',
  'Organisations & Delivery Teams': 'organisations-delivery-teams',
  'Equipment Demand': 'equipment-demand',
  'Resources': 'resources',
  'CRM': 'crm',
  'Reports': 'reports',
  'Alerts': 'alerts',
  'Source Admin': 'source-admin',
};

function viewFromHash(): ViewName {
  const slug = window.location.hash.replace(/^#platform\/?/, '');
  const hit = VIEWS.find(item => VIEW_SLUGS[item.name] === slug);
  return hit?.name || 'Decision Desk';
}

export default function FunctionalApp() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<ViewName>(() => viewFromHash());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Project | null>(null);
  const [message, setMessage] = useState('');
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [reportWindow, setReportWindow] = useState({ loaded: 0, truncated: false });

  const load = async () => {
    try {
      const response = await api.get('/api/dashboard');
      setDashboard(response.data as Dashboard);
      setLoadError('');
    } catch {
      setLoadError('The intelligence dashboard could not be loaded.');
    }
  };

  useEffect(() => {
    void load();
    api.get('/api/reports/history').then(response => {
      const data = response.data;
      const rows = Array.isArray(data) ? data : safeArray(data?.reports);
      setReportWindow({ loaded: Number(data?.loaded) || rows.length, truncated: data?.truncated === true });
      setReports(rows.map((row: any) => ({ id: row.id, at: row.generatedAt, summary: row.headline, filename: row.filename })));
    }).catch(() => { setReports([]); setMessage('Report history could not be loaded. Please retry by reloading the page.'); });
  }, []);

  useEffect(() => {
    const syncView = () => { setSelected(null); setMessage(''); setView(viewFromHash()); };
    window.addEventListener('hashchange', syncView);
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [view]);

  const navigateView = (next: ViewName) => {
    setSelected(null);
    setMessage('');
    setView(next);
    const nextHash = `#platform/${VIEW_SLUGS[next]}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const projects = useMemo(() => safeArray(dashboard?.projects), [dashboard]);
  const events = useMemo(() => safeArray(dashboard?.commercial?.events), [dashboard]);

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(project => [
      project.name,
      project.location,
      project.company,
      project.stageLabel,
      project.contractors.join(' '),
      project.sources.join(' '),
      project.equipmentPrediction.classes.join(' '),
    ].join(' ').toLowerCase().includes(needle));
  }, [projects, query]);

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return events;
    return events.filter(event => [
      event.project,
      event.location,
      event.type,
      event.reason,
      event.action || '',
      event.stage || '',
    ].join(' ').toLowerCase().includes(needle));
  }, [events, query]);

  const mapProjects = useMemo(() => {
    const matchingIds = new Set([...visibleProjects.map(project => project.id), ...filteredEvents.map(event => event.projectId)]);
    return projects.filter(project => matchingIds.has(project.id));
  }, [projects, visibleProjects, filteredEvents]);

  const openProjectById = (projectId: string) => {
    const project = projects.find(item => item.id === projectId);
    if (project) setSelected(project);
  };



  const submitOutcome = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api.post('/api/pilot/outcomes', Object.fromEntries(new FormData(form).entries()));
      setMessage('Measured human-entered BDM outcome recorded.');
      form.reset();
      await load();
    } catch {
      setMessage('Outcome rejected - check canonical project and required positive quote/win values.');
    }
  };

  const saveReportSnapshot = async (filename?: string) => {
    if (!dashboard) return false;
    const summary = buildExecutiveReportSummary(dashboard);
    try {
      const { data } = await api.post('/api/reports/history', {
        generatedAt: summary.generatedAt, headline: summary.headline, filename,
        projectCount: summary.projectCount, opportunityCount: summary.opportunityCount,
      });
      setReports(current => [{ id: data.id, at: data.generatedAt, summary: data.headline, filename: data.filename }, ...current].slice(0, 50));
      return true;
    } catch {
      setMessage('Report snapshot could not be saved. Please try again.');
      return false;
    }
  };

  const generateReport = async () => {
    if (await saveReportSnapshot()) setMessage('Current report snapshot saved from the visible evidence set.');
  };

  const downloadReport = async () => {
    if (!dashboard) return;
    try {
      const filename = downloadExecutivePdf(dashboard);
      if (await saveReportSnapshot(filename)) setMessage(`PDF report generated: ${filename}`);
      else setMessage('PDF downloaded, but its report history could not be saved. Please try saving a report snapshot again.');
    } catch {
      setMessage('PDF report could not be generated. Please try again.');
    }
  };

  if (loadError && !dashboard) {
    return <div className='hi-load-state'>
      <strong>Hire Intelligence could not load.</strong>
      <span>{loadError}</span>
      <button onClick={() => void load()}>Retry dashboard</button>
    </div>;
  }

  if (!dashboard) {
    return <div className='hi-load-state'>Loading Hire Intelligence…</div>;
  }

  const meta = VIEWS.find(item => item.name === view) || VIEWS[0];

  return <div className='hi-shell'>
    <aside className='hi-sidebar'>
      <div className='hi-brand'>
        <span>HI</span>
        <div><b>HIRE</b><strong>INTELLIGENCE</strong></div>
      </div>
      <nav className='hi-nav' aria-label='Hire Intelligence modules'>
        {VIEWS.map(item => {
          const Icon = item.icon;
          return <a
            key={item.name}
            className={view === item.name ? 'active' : ''}
            href={`#platform/${VIEW_SLUGS[item.name]}`}
          >
            <Icon size={15}/>
            <span>{item.name}</span>
          </a>;
        })}
      </nav>
    </aside>

    <main className='hi-main'>
      <div className='hi-mobile-nav-wrap'>
        <select
          className='hi-mobile-nav'
          value={view}
          onChange={event => navigateView(event.target.value as ViewName)}
        >
          {VIEWS.map(item => <option key={item.name}>{item.name}</option>)}
        </select>
      </div>

      <header className='hi-topbar'>
        <div className='hi-search'>
          <Search size={16}/>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='Search projects, locations, contractors, equipment…'
          />
        </div>
      </header>

      <section className='hi-page-head'>
        <div>
          <h1>{meta.name}</h1>
          <p>{meta.description}</p>
        </div>
        <span>{dashboard.coverage}</span>
      </section>

      {message && <div className='hi-message'>{message}</div>}
      {dashboard.universe?.truncated && <div className='hi-message'>Data window disclosure: {dashboard.universe.loaded || 0} current records are loaded in this bounded view and additional stored records exist. Rankings and counts on this screen apply to the loaded window.</div>}

      <section className='hi-page-content' data-module={view}>
        {view === 'Decision Desk' && <DecisionDesk dashboard={dashboard} projects={visibleProjects} events={filteredEvents} open={setSelected} openProject={openProjectById}/>}
        {view === 'Commercial Intelligence' && <CommercialIntelligence dashboard={dashboard} openProject={openProjectById}/>}
        {view === 'Opportunities' && <OpportunitiesPage events={filteredEvents} projects={projects} open={openProjectById}/>}
        {view === 'Projects' && <ProjectsPage projects={visibleProjects} open={setSelected}/>}
        {view === 'Map' && <GeoMap projects={mapProjects} events={filteredEvents} openProject={openProjectById}/>}
        {view === 'Organisations & Delivery Teams' && <CompaniesPage dashboard={dashboard} projects={visibleProjects} open={setSelected}/>}
        {view === 'Equipment Demand' && <EquipmentPage dashboard={dashboard} projects={visibleProjects} open={setSelected}/>}
        {view === 'Resources' && <ResourcesPage dashboard={dashboard} projects={visibleProjects} open={setSelected}/>}
        {view === 'CRM' && <CRMPage dashboard={dashboard} projects={projects} submitOutcome={submitOutcome}/>}
        {view === 'Reports' && <ReportsPage dashboard={dashboard} reports={reports} reportWindow={reportWindow} generateReport={generateReport} downloadReport={downloadReport}/>}
        {view === 'Alerts' && <AlertsPage projects={visibleProjects} events={filteredEvents} open={setSelected} openProject={openProjectById}/>}
        {view === 'Source Admin' && <SourceAdminPage dashboard={dashboard}/>}
      </section>

      {selected && <ProjectDrawer project={selected} close={() => setSelected(null)}/>}
    </main>
  </div>;
}

function DecisionDesk({ dashboard, projects, events, open, openProject }: { dashboard: Dashboard; projects: Project[]; events: OpportunityEvent[]; open: (project: Project) => void; openProject: (projectId: string) => void }) {
  const priority = [...projects].sort((a, b) => b.bdmPriority - a.bdmPriority).slice(0, 12);
  const kpis = [
    ['CALL NOW', dashboard.metrics.callNow || 0, 'Evidence-gated'],
    ['PILOT QUEUE', dashboard.metrics.pilotQueue || 0, 'Commercial review'],
    ['EVENT SIGNALS', dashboard.metrics.eventSignals || events.length, 'Evidence derived'],
    ['FLEET WATCH', dashboard.metrics.fleetWatch || 0, 'PREDICTED'],
    ['HIGH PRIORITY', dashboard.metrics.highPriority || 0, 'Ranked projects'],
    ['LIVE FEEDS', `${dashboard.sources.active}/${dashboard.sources.configured}`, `${dashboard.sources.runtimeFetched} fetched`],
  ];
  return <>
    <div className='hi-kpi-grid'>
      {kpis.map(([label, value, note]) => <article key={String(label)}><small>{label}</small><strong>{value}</strong><span>{note}</span></article>)}
    </div>
    <div className='hi-two-column'>
      <section className='hi-card'>
        <CardHeader title='Priority Projects' subtitle='Highest BDM-priority canonical projects in the current evidence set.'/>
        <ProjectTable projects={priority} open={open}/>
      </section>
      <section className='hi-card'>
        <CardHeader title='Recent Opportunity Signals' subtitle='Current evidence-derived commercial events.'/>
        <div className='hi-activity-list'>
          {events.slice(0, 10).map((event, index) => <button type='button' key={`${event.projectId}-${event.type}-${index}`} onClick={() => openProject(event.projectId)}>
            <Activity size={15}/>
            <span><b>{event.type}</b><small>{event.project} · {event.location}</small></span>
            <em>{event.confidence}%</em>
          </button>)}
          {!events.length && <EmptyState>No opportunity events are currently available.</EmptyState>}
        </div>
      </section>
    </div>
  </>;
}

function CommercialIntelligence({ dashboard, openProject }: { dashboard: Dashboard; openProject: (projectId: string) => void }) {
  const commercial = dashboard.commercial || {};
  const scopeProgram = safeArray<Record<string, any>>(commercial.scopeProgram);
  const pilotQueue = safeArray<Record<string, any>>(commercial.pilotQueue);
  const events = safeArray<OpportunityEvent>(commercial.events);
  const contractorWorkload = safeArray<Record<string, any>>(commercial.contractorWorkload);
  const equipmentClusters = safeArray<Record<string, any>>(commercial.equipmentClusters);
  const fleetPositioning = safeArray<Record<string, any>>(commercial.fleetPositioning);
  const calibration = commercial.calibration || {};

  return <div className='hi-stack'>
    <section className='hi-card'>
      <CardHeader title='Engine Capability Status' subtitle='Operational, data-limited and source-limited capabilities are shown explicitly.'/>
      <div className='hi-grid-cards'>
        {scopeProgram.map(block => <article key={`${block.from}-${block.to}`}>
          <small>{block.status}</small>
          <b>{block.name}</b>
          <span className={`hi-badge ${String(block.status).toLowerCase()}`}>{block.status}</span>
          <p>{block.note}</p>
        </article>)}
        {!scopeProgram.length && <EmptyState>No scope-program data is currently available.</EmptyState>}
      </div>
    </section>

    <section className='hi-card'>
      <CardHeader title='Top BDM Pilot Queue' subtitle={`${pilotQueue.length} canonical projects ranked for commercial review.`}/>
      <div className='hi-table hi-pilot-table'>
        <div className='hi-table-row hi-table-head'><span>PROJECT</span><span>LOCATION</span><span>STAGE</span><span>PRIORITY</span><span>ACTION</span></div>
        {pilotQueue.slice(0, 30).map(item => <button type='button' className='hi-table-row' key={item.projectId} onClick={() => openProject(String(item.projectId))}>
          <span><b>#{item.rank} · {item.project}</b><small>Signal {item.signalBand || '—'}</small></span>
          <span>{item.location}</span><span>{item.stage}</span><span><i>{item.bdmPriority}</i></span><span>{item.action}</span>
        </button>)}
        {!pilotQueue.length && <EmptyState>No pilot-queue projects are currently available.</EmptyState>}
      </div>
    </section>

    <div className='hi-two-column'>
      <section className='hi-card'>
        <CardHeader title='Event Intelligence' subtitle='Evidence-derived project events.'/>
        <div className='hi-activity-list'>
          {events.slice(0, 20).map((event, index) => <button type='button' key={`${event.projectId}-${index}`} onClick={() => openProject(event.projectId)}>
            <Activity size={15}/><span><b>{event.type} · {event.project}</b><small>{event.location} · {event.reason}</small></span><em>{event.confidence}%</em>
          </button>)}
          {!events.length && <EmptyState>No event intelligence is currently available.</EmptyState>}
        </div>
      </section>
      <section className='hi-card'>
        <CardHeader title='Delivery Organisation Workload' subtitle='Evidence-backed delivery organisations only; owners and applicants are not treated as contractors.'/>
        <div className='hi-organisation-list'>
          {contractorWorkload.slice(0, 20).map(item => <div key={item.contractor}>
            <span className='hi-avatar'>{initials(String(item.contractor))}</span>
            <span><b>{item.contractor}</b><small>{item.projectCount} projects · {item.highPriorityProjects} high priority · avg {item.averagePriority}</small></span>
            <em>{safeArray<string>(item.stages).slice(0, 2).join(' · ')}</em>
          </div>)}
          {!contractorWorkload.length && <EmptyState>No evidence-backed contractor workload is currently available.</EmptyState>}
        </div>
      </section>
    </div>

    <div className='hi-two-column'>
      <section className='hi-card'>
        <CardHeader title='PREDICTED Equipment-Demand Clusters' subtitle='Inference from observed work evidence; not observed hire requirements.'/>
        <div className='hi-grid-cards'>
          {equipmentClusters.slice(0, 20).map(item => <article key={`${item.location}-${item.equipmentClass}`}>
            <small>PREDICTED · {item.confidence}% heuristic confidence</small><b>{item.equipmentClass}</b><p>{item.location} · {item.projectCount} projects · avg priority {item.averagePriority}</p>
          </article>)}
          {!equipmentClusters.length && <EmptyState>No predicted equipment clusters are currently available.</EmptyState>}
        </div>
      </section>
      <section className='hi-card'>
        <CardHeader title='PREDICTED Fleet Positioning' subtitle='Fleet watch only; actual hire requirements must be verified.'/>
        <div className='hi-grid-cards'>
          {fleetPositioning.slice(0, 15).map(item => <article key={`${item.location}-${item.equipmentClass}-fleet`}>
            <small>HEURISTIC DEMAND INDEX {item.demandIndex}</small><b>{item.equipmentClass} · {item.location}</b><p>{item.recommendation}</p>
          </article>)}
          {!fleetPositioning.length && <EmptyState>No fleet-positioning watch is currently triggered.</EmptyState>}
        </div>
      </section>
    </div>

    <section className='hi-card'>
      <CardHeader title='Outcome Calibration' subtitle='Genuine human-entered outcomes only.'/>
      <div className='hi-kpi-grid hi-kpi-grid-4'>
        <article><small>LINKED REAL OUTCOMES</small><strong>{calibration.linkedRealOutcomes || 0}</strong><span>Project linked</span></article>
        <article><small>UNMATCHED</small><strong>{calibration.unmatchedRealOutcomes || 0}</strong><span>Legacy / unresolved</span></article>
        <article><small>SAMPLE STATUS</small><strong>{calibration.sufficientSample ? 'SUFFICIENT' : 'LIMITED'}</strong><span>No synthetic history</span></article>
        <article><small>PRIORITY BANDS</small><strong>{safeArray(calibration.priorityDeciles).length}</strong><span>Calibration buckets</span></article>
      </div>
    </section>
  </div>;
}

function OpportunitiesPage({ events, projects, open }: { events: OpportunityEvent[]; projects: Project[]; open: (projectId: string) => void }) {
  const [priority, setPriority] = useState('ALL');
  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects]);
  const rows = events.filter(event => priority === 'ALL' || String(event.priorityBand || projectById.get(event.projectId)?.priorityBand || '') === priority);
  return <section className='hi-card'>
    <div className='hi-card-toolbar'>
      <CardHeader title='Opportunity Signals' subtitle={`${rows.length} evidence-derived events in this view.`}/>
      <select value={priority} onChange={event => setPriority(event.target.value)}>
        <option value='ALL'>All priorities</option><option value='HIGH'>High</option><option value='MEDIUM'>Medium</option><option value='WATCH'>Watch</option>
      </select>
    </div>
    <div className='hi-table hi-opportunity-table'>
      <div className='hi-table-row hi-table-head'><span>SIGNAL / PROJECT</span><span>LOCATION</span><span>DETECTED</span><span>STAGE</span><span>CONF.</span><span>ACTION</span></div>
      {rows.map((event, index) => {
        const project = projectById.get(event.projectId);
        return <button type='button' className='hi-table-row' key={`${event.projectId}-${event.type}-${index}`} onClick={() => open(event.projectId)}>
          <span><b>{event.type}</b><small>{event.project} · Priority {event.bdmPriority ?? project?.bdmPriority ?? '—'}</small></span>
          <span>{event.location}</span><span>{dateLabel(event.detectedAt)}</span><span>{event.stage || project?.stageLabel || '—'}</span><span><i>{event.confidence}%</i></span><span>{event.action || event.reason}</span>
        </button>;
      })}
      {!rows.length && <EmptyState>No opportunities match the current search/filter.</EmptyState>}
    </div>
  </section>;
}

function ProjectsPage({ projects, open }: { projects: Project[]; open: (project: Project) => void }) {
  const [stage, setStage] = useState('ALL');
  const stages = useMemo(() => ['ALL', ...new Set(projects.map(project => project.stageLabel))], [projects]);
  const rows = stage === 'ALL' ? projects : projects.filter(project => project.stageLabel === stage);
  return <section className='hi-card'>
    <div className='hi-card-toolbar'>
      <CardHeader title='Canonical Projects' subtitle={`${rows.length} project records consolidate current evidence.`}/>
      <select value={stage} onChange={event => setStage(event.target.value)}>{stages.map(item => <option key={item}>{item}</option>)}</select>
    </div>
    <ProjectTable projects={rows} open={open}/>
  </section>;
}

function CompaniesPage({ dashboard, projects, open }: { dashboard: Dashboard; projects: Project[]; open: (project: Project) => void }) {
  const workload = safeArray<Record<string, any>>(dashboard.commercial.contractorWorkload);
  const names = useMemo(() => {
    const values = new Set<string>();
    for (const project of projects) {
      project.contractors.forEach(value => value && values.add(value));
      if (project.company) values.add(project.company);
      project.records.forEach(record => record.company && values.add(record.company));
    }
    return [...values];
  }, [projects]);

  const rows = names.map(name => {
    const linked = projects.filter(project => project.contractors.includes(name) || project.company === name || project.records.some(record => record.company === name));
    const top = [...linked].sort((a, b) => b.bdmPriority - a.bdmPriority)[0];
    const work = workload.find(item => String(item.contractor).toLowerCase() === name.toLowerCase());
    return { name, linked, top, work };
  }).sort((a, b) => b.linked.length - a.linked.length);

  return <section className='hi-card'>
    <CardHeader title='Evidence-Backed Organisations' subtitle='Company names come from public project evidence. Personal contacts are not invented.'/>
    <div className='hi-organisation-list'>
      {rows.map(row => <div key={row.name}>
        <span className='hi-avatar'>{initials(row.name)}</span>
        <span><b>{row.name}</b><small>{row.linked.length} linked projects · {row.work?.highPriorityProjects || 0} high priority</small></span>
        <em>{row.top?.location || 'Location not evidenced'}</em>
        <button type='button' disabled={!row.top} onClick={() => row.top && open(row.top)}>Open project</button>
      </div>)}
      {!rows.length && <EmptyState>No evidence-backed organisations are currently available.</EmptyState>}
    </div>
    <div className='hi-governance-note'><Users size={15}/><span><b>Contacts governance:</b> no personal name, email or phone is displayed unless separately verified from public evidence.</span></div>
  </section>;
}

function EquipmentPage({ dashboard, projects, open }: { dashboard: Dashboard; projects: Project[]; open: (project: Project) => void }) {
  const clusters = safeArray<Record<string, any>>(dashboard.commercial.equipmentClusters);
  const fleet = safeArray<Record<string, any>>(dashboard.commercial.fleetPositioning);
  return <div className='hi-stack'>
    <div className='hi-two-column'>
      <section className='hi-card'>
        <CardHeader title='PREDICTED Equipment Clusters' subtitle='Aggregated from observed work evidence.'/>
        <div className='hi-grid-cards'>
          {clusters.slice(0, 24).map(item => <article key={`${item.location}-${item.equipmentClass}`}><small>{item.confidence}% heuristic confidence</small><b>{item.equipmentClass}</b><p>{item.location} · {item.projectCount} projects · avg priority {item.averagePriority}</p></article>)}
          {!clusters.length && <EmptyState>No equipment clusters have been inferred yet.</EmptyState>}
        </div>
      </section>
      <section className='hi-card'>
        <CardHeader title='Fleet Watch' subtitle='PREDICTED positioning recommendations only.'/>
        <div className='hi-grid-cards'>
          {fleet.map(item => <article key={`${item.location}-${item.equipmentClass}-watch`}><small>HEURISTIC INDEX {item.demandIndex}</small><b>{item.equipmentClass} · {item.location}</b><p>{item.recommendation}</p></article>)}
          {!fleet.length && <EmptyState>No fleet-positioning recommendation is currently triggered.</EmptyState>}
        </div>
      </section>
    </div>
    <section className='hi-card'>
      <CardHeader title='Projects Driving PREDICTED Demand' subtitle='Open a project to inspect the evidence behind its equipment prediction.'/>
      <div className='hi-equipment-projects'>
        {projects.map(project => <button type='button' key={project.id} onClick={() => open(project)}>
          <span><b>{project.name}</b><small>{project.location} · {project.stageLabel}</small></span>
          <span><strong>PREDICTED</strong>{project.equipmentPrediction.classes.join(' · ') || 'No class inferred'}</span>
          <em>{project.equipmentPrediction.confidence}%</em>
        </button>)}
        {!projects.length && <EmptyState>No projects match the current search.</EmptyState>}
      </div>
    </section>
  </div>;
}

function ResourcesPage({ dashboard, projects, open }: { dashboard: Dashboard; projects: Project[]; open: (project: Project) => void }) {
  const sourceCoverage = safeArray<Record<string, any>>(dashboard.commercial.sourceCoverage);
  const resourceProjects = projects.filter(project => project.sources.some(source => /mining|resource|petroleum|exploration|tenement|authority/i.test(source)) || project.records.some(record => /mining|resource|petroleum|exploration/i.test(record.description || '')));
  return <div className='hi-stack'>
    <section className='hi-card'>
      <CardHeader title='National Source Coverage' subtitle='Territories and sectors represented by admitted lawful feeds.'/>
      <div className='hi-grid-cards'>
        {sourceCoverage.map(item => <article key={item.territory}><small>{item.territory}</small><b>{item.feedCount} admitted feeds</b><p>{safeArray<string>(item.sectors).join(' · ')}</p></article>)}
        {!sourceCoverage.length && <EmptyState>No source-coverage summary is currently available.</EmptyState>}
      </div>
    </section>
    <section className='hi-card'>
      <CardHeader title='Resource-Sector Projects' subtitle={`${resourceProjects.length} canonical projects linked to mining/resources evidence.`}/>
      <ProjectTable projects={resourceProjects} open={open}/>
    </section>
  </div>;
}

function CRMPage({ dashboard, projects, submitOutcome }: { dashboard: Dashboard; projects: Project[]; submitOutcome: (event: FormEvent<HTMLFormElement>) => void }) {
  const recent = safeArray<Record<string, any>>(dashboard.pilot.recentOutcomes);
  return <div className='hi-stack'>
    <div className='hi-kpi-grid hi-kpi-grid-6'>
      <article><small>REVIEWED</small><strong>{dashboard.pilot.reviewed ?? 0}</strong><span>Real outcomes</span></article>
      <article><small>PRECISION</small><strong>{dashboard.pilot.precision ?? '—'}</strong><span>Measured</span></article>
      <article><small>ADVANCE DAYS</small><strong>{dashboard.pilot.advanceDays ?? '—'}</strong><span>Average</span></article>
      <article><small>QUOTE CONV.</small><strong>{dashboard.pilot.quoteConversion ?? '—'}</strong><span>Contacted → quote</span></article>
      <article><small>LEAD → HIRE</small><strong>{dashboard.pilot.leadToHire ?? '—'}</strong><span>Measured</span></article>
      <article><small>WON VALUE</small><strong>{dashboard.pilot.wonValueLabel ?? '—'}</strong><span>Human entered</span></article>
    </div>
    <section className='hi-card'>
      <CardHeader title='Record BDM Outcome' subtitle='Human-entered outcomes only. QUOTED and WON require positive commercial values.'/>
      <form className='hi-crm-form' onSubmit={submitOutcome}>
        <label>Canonical project<select name='projectId' required defaultValue=''><option value=''>Select project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name} · {project.location}</option>)}</select></label>
        <label>Result<select name='result' defaultValue='CONTACTED'><option>CONTACTED</option><option>REQUIREMENT_CONFIRMED</option><option>QUOTED</option><option>WON</option><option>LOST</option><option>FALSE_POSITIVE</option></select></label>
        <label>QA<select name='qa' defaultValue='false'><option value='false'>Real measurement</option><option value='true'>QA excluded</option></select></label>
        <label>Advance days<input name='advanceDays' inputMode='numeric'/></label>
        <label>Quote value AUD<input name='quoteValue' inputMode='decimal'/></label>
        <label>Won value AUD<input name='wonValue' inputMode='decimal'/></label>
        <label className='wide'>Notes<input name='notes'/></label>
        <button type='submit'>Record outcome</button>
      </form>
    </section>
    <section className='hi-card'>
      <CardHeader title='Recent Measured Entries' subtitle='QA-excluded records remain explicit.'/>
      <div className='hi-activity-list'>
        {recent.map((outcome, index) => <div key={`${outcome.project}-${outcome.recordedAt}-${index}`}><Activity size={15}/><span><b>{outcome.project}</b><small>{outcome.result}{outcome.qa ? ' · QA EXCLUDED' : ''}</small></span><em>{dateLabel(outcome.recordedAt)}</em></div>)}
        {!recent.length && <EmptyState>No BDM outcomes have been entered yet.</EmptyState>}
      </div>
    </section>
  </div>;
}

function ReportsPage({ dashboard, reports, reportWindow, generateReport, downloadReport }: { dashboard: Dashboard; reports: SavedReport[]; reportWindow: { loaded: number; truncated: boolean }; generateReport: () => void; downloadReport: () => void }) {
  const summary = buildExecutiveReportSummary(dashboard);
  return <div className='hi-stack'>
    <section className='hi-card hi-report-hero'>
      <div><small>EXECUTIVE REPORTING</small><h2>Hire Intelligence Executive Report</h2><p>Current canonical projects, opportunity signals, contractor workload, PREDICTED demand, source health, backfill and calibration.</p></div>
      <div><button type='button' onClick={generateReport}><FileText size={15}/>Save report snapshot</button><button type='button' className='primary' onClick={downloadReport}><Download size={15}/>Download PDF</button></div>
    </section>
    <section className='hi-card hi-report-preview'><CardHeader title='Current Report Preview' subtitle={summary.headline}/><div className='hi-governance-note'><FileText size={15}/><span><b>Decision view:</b> {summary.highPriorityCount} high-priority projects · {dashboard.metrics?.callNow || 0} CALL NOW · source health {summary.liveFeeds} · {dashboard.universe?.truncated ? 'bounded data window disclosed' : 'current bounded window complete'}.</span></div></section>
    <div className='hi-kpi-grid hi-kpi-grid-6'>
      <article><small>PROJECTS</small><strong>{summary.projectCount}</strong><span>Canonical</span></article>
      <article><small>OPPORTUNITIES</small><strong>{summary.opportunityCount}</strong><span>Current</span></article>
      <article><small>HIGH PRIORITY</small><strong>{summary.highPriorityCount}</strong><span>Ranked</span></article>
      <article><small>LIVE FEEDS</small><strong>{summary.liveFeeds}</strong><span>Source health</span></article>
      <article><small>EVIDENCE</small><strong>{summary.evidenceProcessed.toLocaleString()}</strong><span>Processed</span></article>
      <article><small>BACKFILL</small><strong>{summary.completedBackfill}</strong><span>Coverage</span></article>
    </div>
    <section className='hi-card'>
      <CardHeader title='Generated Report History' subtitle='Saved report history for your signed-in account.'/>
      {reportWindow.truncated && <div className='hi-governance-note'>Report history is limited to the newest snapshots within {reportWindow.loaded} stored records. Additional stored records exist outside this loaded window.</div>}
      <div className='hi-activity-list'>
        {reports.map(report => <div key={report.id}><FileText size={15}/><span><b>Executive Intelligence Report</b><small>{report.summary}</small></span><em>{new Date(report.at).toLocaleString('en-AU')}{report.filename ? ` · ${report.filename}` : ''}</em></div>)}
        {!reports.length && <EmptyState>No report snapshots generated yet.</EmptyState>}
      </div>
    </section>
  </div>;
}

function AlertsPage({ projects, events, open, openProject }: { projects: Project[]; events: OpportunityEvent[]; open: (project: Project) => void; openProject: (projectId: string) => void }) {
  const projectAlerts = projects.filter(project => project.priorityBand === 'HIGH' || project.stageChanged);
  const tenderEvents = events.filter(event => /TENDER|PROCUREMENT|AWARD|MOBILISATION|SHUTDOWN/i.test(event.type));
  return <div className='hi-stack'>
    <section className='hi-card'>
      <CardHeader title='Project Action Alerts' subtitle='High-priority projects and evidence-qualified stage movement.'/>
      <div className='hi-alert-list'>
        {projectAlerts.map(project => <button type='button' key={project.id} onClick={() => open(project)}><Bell size={15}/><span><b>{project.stageChanged ? 'Stage movement' : 'High-priority project'}</b><small>{project.name} · {project.location} · Priority {project.bdmPriority}</small></span><em>{project.stageLabel}</em></button>)}
        {!projectAlerts.length && <EmptyState>No current project alerts match the view.</EmptyState>}
      </div>
    </section>
    <section className='hi-card'>
      <CardHeader title='Commercial Event Alerts' subtitle='Tender, procurement, award, mobilisation and shutdown evidence.'/>
      <div className='hi-alert-list'>
        {tenderEvents.map((event, index) => <button type='button' key={`${event.projectId}-${event.type}-${index}`} onClick={() => openProject(event.projectId)}><Target size={15}/><span><b>{event.type}</b><small>{event.project} · {event.location}</small></span><em>{event.confidence}%</em></button>)}
        {!tenderEvents.length && <EmptyState>No matching commercial event alerts are currently available.</EmptyState>}
      </div>
    </section>
  </div>;
}

function SourceAdminPage({ dashboard }: { dashboard: Dashboard }) {
  return <div className='hi-stack'>
    <div className='hi-kpi-grid hi-kpi-grid-4'>
      <article><small>CONFIGURED</small><strong>{dashboard.sources.configured}</strong><span>Runnable sources</span></article>
      <article><small>SUCCESSFUL</small><strong>{dashboard.sources.active}</strong><span>Latest status</span></article>
      <article><small>DEFERRED</small><strong>{dashboard.sources.deferred.length}</strong><span>Not running</span></article>
      <article><small>BACKFILL</small><strong>{dashboard.backfill.completedSources}/{dashboard.backfill.totalSources}</strong><span>{dashboard.backfill.processed.toLocaleString()} records</span></article>
    </div>
    <section className='hi-card'>
      <div className='hi-card-toolbar'>
        <CardHeader title='Current Source Health' subtitle='Current live source health and normalized record counts.'/>
      </div>
      <div className='hi-source-list'>
        {dashboard.sources.states.map(source => <div key={source.sourceKey}><Database size={15}/><span><b>{source.name}</b><small>{source.recordsFetched} fetched · {source.opportunitiesPromoted || 0} normalized · {source.message || 'provenance retained'}</small></span><em className={`hi-badge ${source.status.toLowerCase()}`}>{source.status}</em></div>)}
        {!dashboard.sources.states.length && <EmptyState>No runtime source states are currently available.</EmptyState>}
      </div>
    </section>
    <section className='hi-card'>
      <CardHeader title='Deferred Collectors' subtitle='Official sources held out of production until technical/access conditions are revalidated.'/>
      <div className='hi-grid-cards'>
        {dashboard.sources.deferred.map(source => <article key={source.sourceKey}><small>DEFERRED</small><b>{source.name}</b><p>{source.reason}</p><span>{source.licence} · provenance retained</span></article>)}
        {!dashboard.sources.deferred.length && <EmptyState>No collectors are currently deferred.</EmptyState>}
      </div>
    </section>
    <section className='hi-card'>
      <CardHeader title='Coverage Candidates' subtitle='Not running until rights, access and technical review are complete.'/>
      <div className='hi-grid-cards'>{CANDIDATES.map(candidate => <article key={candidate}><small>CANDIDATE · NOT RUNNING</small><b>{candidate}</b><p>Rights, access and technical review required before production admission.</p></article>)}</div>
    </section>
  </div>;
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className='hi-card-header'><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function ProjectTable({ projects, open }: { projects: Project[]; open: (project: Project) => void }) {
  return <div className='hi-table hi-project-table'>
    <div className='hi-table-row hi-table-head'><span>PROJECT</span><span>LOCATION</span><span>STAGE</span><span>PRIORITY</span><span>VALUE</span><span>EVIDENCE</span></div>
    {projects.map(project => <button type='button' className='hi-table-row' key={project.id} onClick={() => open(project)}>
      <span><b>{project.name}</b><small>{project.contractors[0] || project.sources[0] || 'Source evidence'}</small></span>
      <span>{project.location}</span><span><em>{project.stageLabel}</em></span><span><i>{project.bdmPriority}</i><small>{project.priorityBand}</small></span><span>{project.value}</span><span>{project.evidenceCount}</span>
    </button>)}
    {!projects.length && <EmptyState>No projects match the current view.</EmptyState>}
  </div>;
}

function ProjectDrawer({ project, close }: { project: Project; close: () => void }) {
  const drawerRef = useDialogFocus(true, close);
  return <div className='hi-overlay' onClick={close}>
    <section ref={drawerRef} tabIndex={-1} role='dialog' aria-modal='true' aria-label='Project intelligence' className='hi-drawer' onClick={event => event.stopPropagation()}>
      <button type='button' className='hi-drawer-close' onClick={close} aria-label='Close project intelligence'><X size={18}/></button>
      <small className='hi-drawer-kicker'>CANONICAL PROJECT INTELLIGENCE</small>
      <h2>{project.name}</h2>
      <p className='hi-location'><MapPin size={14}/>{project.location}</p>
      <div className='hi-drawer-kpis'>
        <span><small>BDM PRIORITY</small><b>{project.bdmPriority}/100</b></span>
        <span><small>SIGNAL QUALITY</small><b>{project.signalQualityScore}/100</b></span>
        <span><small>EVIDENCE</small><b>{project.evidenceCount}</b></span>
      </div>
      <h3>Stage</h3><p>{project.stageLabel} · {project.stageConfidence}% confidence</p><p>{project.stageReason}</p>
      <h3>Companies / contractors</h3><p>{project.contractors.length ? project.contractors.join(' · ') : project.company || 'Contractor not evidenced'}</p>
      <h3>Equipment demand</h3><p><b>PREDICTED:</b> {project.equipmentPrediction.classes.join(' · ') || 'No equipment class inferred'}</p><p>{project.equipmentPrediction.confidenceBand} heuristic confidence · {project.equipmentPrediction.confidence}% · {project.equipmentPrediction.reason}</p><small>Not an observed hire requirement.</small>
      <h3>Evidence & provenance</h3>
      <div className='hi-evidence-list'>
        {project.records.map((record, index) => <article key={`${record.sourceKey}-${record.externalId}-${index}`}><b>{record.sourceKey}</b><p>{record.description || record.project}</p><small>{dateLabel(record.observedAt)} · {record.provenance}</small></article>)}
        {!project.records.length && <EmptyState>No evidence records are attached to this canonical project.</EmptyState>}
      </div>
    </section>
  </div>;
}
