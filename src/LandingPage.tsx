import { useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import DemoRequestForm from './DemoRequestForm';
import { useDialogFocus } from './useDialogFocus';
import { PRIVACY_SECTIONS, TERMS_SECTIONS } from './legal-content';
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Building2,
  HardHat,
  LineChart,
  Radar,
  ShieldCheck,
  Target,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import './landing.css';

type LandingDashboard = {
  metrics?: Record<string, number>;
  regionalCounts?: Record<string, number>;
  universe?: { loaded?: number; truncated?: boolean };
  commercial?: { events?: Array<unknown> };
  sources?: { active?: number; configured?: number };
  coverage?: string;
};

type LandingPageProps = { onExplore: () => void };
type PublicPage =
  | 'home'
  | 'products'
  | 'solutions'
  | 'industries'
  | 'insights'
  | 'about'
  | 'privacy'
  | 'terms'
  | 'contact';

type Feature = {
  key: string;
  eyebrow: string;
  title: string;
  copy: string;
  icon: 'signal' | 'shutdown' | 'contractor' | 'fleet' | 'market';
};

const FEATURES: Feature[] = [
  {
    key: 'early',
    eyebrow: 'EARLY PROJECT SIGNALS',
    title: 'Be first to see what’s coming.',
    copy: 'Get ahead with early-stage project intelligence, from lawful public sources and user-entered commercial outcomes, before demand hits.',
    icon: 'signal',
  },
  {
    key: 'shutdown',
    eyebrow: 'SHUTDOWN INTELLIGENCE',
    title: 'Turn maintenance into opportunity.',
    copy: 'Surface published shutdown, outage and maintenance signals across mining, energy and industrial evidence sources.',
    icon: 'shutdown',
  },
  {
    key: 'contractor',
    eyebrow: 'CONTRACTOR ACTIVITY',
    title: 'Follow the work, follow the demand.',
    copy: 'See evidence-backed delivery organisations, where work is appearing and what equipment classes may be relevant.',
    icon: 'contractor',
  },
  {
    key: 'fleet',
    eyebrow: 'PREDICTED FLEET DEMAND',
    title: 'Plan your fleet with confidence.',
    copy: 'Evidence-driven demand forecasts help you optimise fleet mix, utilisation and investment.',
    icon: 'fleet',
  },
  {
    key: 'market',
    eyebrow: 'MARKET INTELLIGENCE',
    title: 'A clearer view of what’s next.',
    copy: 'Combine project, contractor and market intelligence for a complete picture of demand.',
    icon: 'market',
  },
];

const MAINLAND_PATH =
  'M130.5,212.6 L120.5,217.4 L112.3,219.6 L110.5,224.5 L107.1,228.4 L99.1,228.6 L93.2,229.4 L84.9,227.7 L78.1,228.7 L71.6,229.2 L66.0,234.2 L63.3,233.8 L58.6,236.4 L54.1,239.4 L47.2,239.0 L40.9,239.0 L30.9,233.0 L25.9,231.2 L26.1,225.9 L30.7,224.6 L32.3,222.4 L32.0,219.1 L33.2,212.5 L32.1,206.9 L27.1,197.4 L25.6,192.1 L26.0,186.7 L22.3,180.6 L22.0,177.8 L17.8,174.1 L16.7,166.7 L11.3,159.3 L10.0,155.3 L14.1,159.3 L11.0,150.6 L15.6,153.3 L18.4,157.0 L18.2,152.2 L13.6,144.8 L12.7,141.8 L10.5,139.0 L11.5,133.5 L13.5,131.2 L14.7,126.5 L13.7,121.0 L17.6,114.3 L18.3,121.4 L22.3,115.0 L29.9,111.8 L34.5,107.8 L41.7,104.4 L46.0,103.6 L48.6,104.8 L56.0,101.3 L61.7,100.2 L63.1,98.2 L65.6,97.3 L70.8,97.5 L80.7,94.8 L85.8,90.6 L88.2,85.6 L93.7,80.8 L94.1,77.1 L94.4,71.9 L101.0,63.9 L104.9,72.1 L108.9,70.2 L105.6,65.7 L108.5,61.2 L112.7,63.2 L113.8,56.1 L119.0,51.4 L121.2,47.7 L126.0,46.1 L126.1,43.5 L130.2,44.6 L130.4,42.2 L134.5,40.9 L139.1,39.6 L146.0,43.9 L151.2,49.5 L157.1,49.6 L163.1,50.5 L161.1,45.3 L165.6,37.7 L169.9,35.3 L168.4,32.9 L172.5,27.6 L178.2,24.3 L183.0,25.4 L190.9,23.6 L190.7,18.8 L183.8,15.7 L188.8,14.3 L195.1,16.7 L200.1,20.5 L208.0,22.9 L210.7,22.0 L216.5,24.9 L222.0,22.2 L225.5,23.0 L227.7,21.2 L232.0,25.8 L229.5,30.9 L226.0,34.7 L222.7,35.0 L223.8,38.7 L221.1,43.4 L217.7,48.1 L218.4,50.7 L225.9,55.9 L233.1,58.9 L238.0,62.2 L244.8,67.7 L247.4,67.7 L252.3,70.1 L253.8,73.0 L262.7,76.2 L268.9,73.0 L270.8,68.0 L272.7,63.8 L273.9,58.6 L276.7,51.2 L275.4,46.6 L276.1,43.9 L275.0,38.5 L276.2,31.4 L278.0,29.5 L276.6,26.4 L278.8,21.4 L280.6,16.2 L280.9,13.5 L284.4,10.0 L287.0,14.6 L287.7,20.5 L290.0,21.6 L290.4,25.6 L293.8,30.4 L294.5,35.7 L294.2,39.1 L297.6,46.5 L303.6,42.9 L306.7,46.9 L311.2,50.6 L310.3,54.8 L312.3,62.8 L313.7,67.5 L316.1,68.7 L318.6,76.7 L317.7,81.6 L320.8,88.0 L331.0,92.9 L337.6,97.3 L343.9,101.4 L342.7,103.7 L348.1,109.6 L351.7,119.8 L355.5,117.7 L359.3,121.8 L361.6,120.3 L363.2,130.3 L369.9,136.1 L374.2,139.7 L381.6,147.3 L384.2,154.8 L384.5,160.2 L383.8,166.0 L388.3,174.0 L387.8,182.3 L386.1,186.7 L383.6,195.1 L383.8,200.5 L381.9,207.2 L377.8,215.8 L370.8,220.4 L367.4,227.7 L364.2,232.3 L361.5,240.4 L357.8,245.1 L355.4,252.2 L354.2,258.6 L354.7,261.6 L349.3,264.9 L338.8,265.2 L330.1,269.1 L325.8,272.7 L320.1,276.8 L312.3,272.6 L306.6,270.9 L308.0,266.0 L302.9,267.8 L294.7,274.6 L286.5,272.1 L281.2,270.6 L275.8,269.9 L266.7,267.2 L260.6,261.4 L258.9,254.3 L256.7,249.5 L252.1,245.7 L243.0,244.6 L246.1,240.0 L243.9,233.0 L239.3,239.5 L230.9,241.3 L235.8,236.1 L237.2,230.6 L240.9,226.0 L240.1,219.1 L232.5,227.1 L226.6,230.3 L223.0,237.8 L215.6,233.9 L215.9,228.9 L210.1,222.1 L205.1,218.6 L206.9,216.4 L194.8,210.7 L188.2,210.4 L179.1,205.9 L162.3,206.7 L150.1,210.1 L139.4,213.2 L130.5,212.6 Z';
const TASMANIA_PATH =
  'M333.0,293.4 L338.7,294.1 L339.3,305.2 L336.1,308.5 L335.1,316.0 L331.8,313.4 L325.3,320.0 L323.4,319.5 L317.6,319.2 L311.8,311.2 L310.5,304.9 L305.1,296.8 L305.3,292.4 L311.5,293.3 L320.6,296.5 L325.7,295.2 L333.0,293.4 Z';

function FeatureIcon({ type }: { type: Feature['icon'] }) {
  if (type === 'shutdown') return <Wrench size={16} />;
  if (type === 'contractor') return <Users size={16} />;
  if (type === 'fleet') return <HardHat size={16} />;
  if (type === 'market') return <LineChart size={16} />;
  return <Radar size={16} />;
}

function AustraliaGraphic({ compact = false }: { compact?: boolean }) {
  const points = [
    [70, 156],
    [107, 111],
    [147, 211],
    [188, 75],
    [232, 91],
    [281, 105],
    [337, 153],
    [352, 181],
    [327, 224],
    [295, 252],
    [258, 205],
    [216, 164],
    [173, 166],
    [103, 194],
  ];
  return (
    <svg
      className={compact ? 'hi2-australia-svg compact' : 'hi2-australia-svg'}
      viewBox="0 0 420 330"
      role="img"
      aria-label="Accurate outline map of Australia"
    >
      <path d={MAINLAND_PATH} fill="#eef0f2" stroke="#a9b0b8" strokeWidth="2" />
      <path d={TASMANIA_PATH} fill="#eef0f2" stroke="#a9b0b8" strokeWidth="2" />
      {!compact && (
        <>
          {points.map(([cx, cy], index) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={index % 4 === 0 ? 6 : 4}
              fill="#ef2029"
              opacity={index % 4 === 0 ? 1 : 0.8}
            />
          ))}
          <text x="88" y="176">
            WA
          </text>
          <text x="210" y="99">
            NT
          </text>
          <text x="207" y="211">
            SA
          </text>
          <text x="318" y="130">
            QLD
          </text>
          <text x="326" y="206">
            NSW
          </text>
          <text x="309" y="245">
            VIC
          </text>
          <text x="320" y="314">
            TAS
          </text>
        </>
      )}
    </svg>
  );
}

type PublicStats = {
  projects: number;
  events: number;
  feeds: number;
  configured: number;
  high: number;
};

const PUBLIC_DETAILS: Record<
  Exclude<PublicPage, 'home'>,
  {
    eyebrow: string;
    title: string;
    copy: string;
    cards: Array<{ title: string; copy: string }>;
  }
> = {
  products: {
    eyebrow: 'THE PLATFORM',
    title: 'One operating system for rental intelligence.',
    copy: 'Move from early project signal to evidence, contractor context, predicted equipment demand and BDM action without losing provenance.',
    cards: [
      {
        title: 'Decision Desk',
        copy: 'Prioritised projects, live feed health and the evidence that deserves attention today.',
      },
      {
        title: 'Commercial Intelligence',
        copy: 'Pilot queue, event intelligence, contractor workload, predicted demand clusters and fleet-positioning watch.',
      },
      {
        title: 'Opportunities',
        copy: 'Evidence-derived commercial events such as approvals, procurement, awards, mobilisation, shutdowns and maintenance.',
      },
      {
        title: 'Projects',
        copy: 'Canonical project records consolidating stage, priority, value, contractors and source evidence.',
      },
      {
        title: 'Interactive Map',
        copy: 'Geographic project and opportunity intelligence with regional filters and precision disclosure.',
      },
      {
        title: 'Organisations & Delivery Teams',
        copy: 'Evidence-backed organisations linked to projects; personal contacts are not invented.',
      },
      {
        title: 'Equipment Demand',
        copy: 'Explicitly PREDICTED equipment classes and confidence derived from observed work evidence.',
      },
      {
        title: 'CRM',
        copy: 'Human-entered BDM outcomes linked back to canonical projects for measured commercial calibration.',
      },
      {
        title: 'Reports',
        copy: 'Executive intelligence previews and downloadable PDF reporting from the current evidence set.',
      },
      {
        title: 'Alerts',
        copy: 'High-priority projects, stage movements, tender/procurement activity and contractor-linked signals.',
      },
      {
        title: 'Resources',
        copy: 'Resource-sector project intelligence spanning mining, petroleum, exploration and authority evidence.',
      },
      {
        title: 'Source Admin',
        copy: 'Live source health, deferred collectors, provenance, rights and historical backfill status.',
      },
    ],
  },
  solutions: {
    eyebrow: 'SOLUTIONS',
    title: 'Built around the decisions rental teams actually make.',
    copy: 'Hire Intelligence connects early signals to practical sales, fleet and operating workflows.',
    cards: [
      {
        title: 'BDM prospecting',
        copy: 'Rank opportunities so sales teams spend time where project evidence is strongest.',
      },
      {
        title: 'Fleet planning',
        copy: 'Review PREDICTED regional equipment demand before committing fleet or capital.',
      },
      {
        title: 'Shutdown planning',
        copy: 'Surface shutdown, outage and maintenance signals early enough to prepare commercially.',
      },
      {
        title: 'Contractor tracking',
        copy: 'Follow evidence-backed contractor activity across active projects and regions.',
      },
      {
        title: 'Market coverage',
        copy: 'Bring mining, civil, energy, development and procurement signals into one governed view.',
      },
      {
        title: 'Commercial measurement',
        copy: 'Record real BDM outcomes and use them to calibrate priorities without synthetic performance history.',
      },
    ],
  },
  industries: {
    eyebrow: 'INDUSTRIES',
    title: 'Australian project intelligence across hire-intensive sectors.',
    copy: 'The platform is structured around work that can generate equipment demand, not one narrow project category.',
    cards: [
      {
        title: 'Mining & resources',
        copy: 'Tenements, exploration, approvals, mine activity, shutdowns and resource-project evidence.',
      },
      {
        title: 'Civil & infrastructure',
        copy: 'Roads, major works, public procurement, reconstruction and transport programmes.',
      },
      {
        title: 'Energy & power',
        copy: 'Generation, connection, renewable, petroleum and energy-project signals.',
      },
      {
        title: 'Rail',
        copy: 'Rail programme, procurement and contract-disclosure intelligence.',
      },
      {
        title: 'Water infrastructure',
        copy: 'Water-board, utility and infrastructure procurement signals.',
      },
      {
        title: 'Construction & development',
        copy: 'Building permits, development activity and major project evidence.',
      },
    ],
  },
  insights: {
    eyebrow: 'LIVE INSIGHTS',
    title: 'A current view of the opportunity universe.',
    copy: 'These figures are drawn from the same dashboard data used by the internal platform.',
    cards: [
      {
        title: 'Evidence first',
        copy: 'Project stages and priorities are derived from retained public-source evidence.',
      },
      {
        title: 'Predictions stay predictions',
        copy: 'Equipment demand is labelled PREDICTED and is not presented as an observed hire requirement.',
      },
      {
        title: 'Commercial outcomes are real',
        copy: 'Only human-entered BDM outcomes are used for measured commercial calibration.',
      },
      {
        title: 'Source health is explicit',
        copy: 'Failed or deferred collectors remain visible instead of being silently treated as live.',
      },
    ],
  },
  about: {
    eyebrow: 'ABOUT HIRE INTELLIGENCE',
    title: 'Earlier visibility, governed evidence, better rental decisions.',
    copy: 'Hire Intelligence is designed as a decision operating system for equipment-rental teams working across Australian projects and resources.',
    cards: [
      {
        title: 'Evidence governed',
        copy: 'Every project traces back to retained source evidence and provenance.',
      },
      {
        title: 'No fabricated demand',
        copy: 'Predicted equipment demand remains clearly labelled until a real requirement is confirmed.',
      },
      {
        title: 'National ambition',
        copy: 'Coverage is expanded only where lawful, machine-readable sources can be validated.',
      },
      {
        title: 'Commercial feedback loop',
        copy: 'Real BDM outcomes can be linked to the signals that generated the opportunity.',
      },
      {
        title: 'Built for rental teams',
        copy: 'The product is organised around calls, fleet, contractors, projects and timing.',
      },
      {
        title: 'Continuous improvement',
        copy: 'Source quality, project resolution and commercial calibration improve as evidence accumulates.',
      },
    ],
  },
  privacy: {
    eyebrow: 'PRIVACY',
    title: 'Privacy and data handling.',
    copy: 'Hire Intelligence is designed around public-source project intelligence and governed commercial inputs.',
    cards: [
      {
        title: 'Public-source intelligence',
        copy: 'Project and source intelligence is built from lawful public information and retained provenance.',
      },
      {
        title: 'Commercial inputs',
        copy: 'BDM outcomes entered into the platform are treated as operational business records.',
      },
      {
        title: 'No invented people',
        copy: 'The platform does not manufacture personal contacts where evidence is unavailable.',
      },
      {
        title: 'Purpose limitation',
        copy: 'Information is presented for legitimate rental-market intelligence, planning and business-development workflows.',
      },
    ],
  },
  terms: {
    eyebrow: 'TERMS',
    title: 'Platform use and intelligence limitations.',
    copy: 'Hire Intelligence is a decision-support platform. Users remain responsible for commercial verification before acting.',
    cards: [
      {
        title: 'Verify before outreach',
        copy: 'Contractor, timing and actual equipment requirements should be confirmed before commercial action.',
      },
      {
        title: 'Predicted demand',
        copy: 'PREDICTED equipment output is an analytical inference, not a confirmed hire order.',
      },
      {
        title: 'Source availability',
        copy: 'Public-source access can change and collectors may be deferred when reliability or rights are unclear.',
      },
      {
        title: 'No guaranteed outcome',
        copy: 'Priority scores and signals support decisions; they do not guarantee project awards, hires or revenue.',
      },
    ],
  },
  contact: {
    eyebrow: 'CONTACT',
    title: 'See Hire Intelligence in action.',
    copy: 'Use the live platform to inspect the current intelligence workspace or request a demo from this page.',
    cards: [
      {
        title: 'Platform walkthrough',
        copy: 'Open the live workspace and review current projects, opportunities, map intelligence and reports.',
      },
      {
        title: 'Rental-team use cases',
        copy: 'Review BDM prioritisation, contractor activity and predicted fleet demand.',
      },
      {
        title: 'Data coverage',
        copy: 'Inspect live source health, deferred collectors and historical backfill from Source Admin.',
      },
      {
        title: 'Commercial pilot',
        copy: 'Record genuine BDM outcomes to begin measuring signal quality against real results.',
      },
    ],
  },
};

function PublicPageView({
  page,
  stats,
  onExplore,
  onDemo,
}: {
  page: Exclude<PublicPage, 'home'>;
  stats: PublicStats;
  onExplore: () => void;
  onDemo: () => void;
}) {
  const detail = PUBLIC_DETAILS[page];
  const cards =
    page === 'privacy'
      ? PRIVACY_SECTIONS.map(([title, copy]) => ({ title, copy }))
      : page === 'terms'
        ? TERMS_SECTIONS.map(([title, copy]) => ({ title, copy }))
        : detail.cards;
  return (
    <main className="hi2-public-page" data-public-page={page}>
      <section className="hi2-public-hero">
        <div>
          <div className="hi2-eyebrow">{detail.eyebrow}</div>
          <h1>{detail.title}</h1>
          <p>{detail.copy}</p>
          <div className="hi2-hero-actions">
            <button className="hi2-red-button hi2-large" onClick={onExplore}>
              Explore the platform <ArrowRight size={16} />
            </button>
            <button className="hi2-outline-button hi2-large" onClick={onDemo}>
              Get a demo
            </button>
          </div>
        </div>
        <div className="hi2-public-map">
          <AustraliaGraphic compact />
          <b>Australian rental intelligence</b>
          <span>
            Evidence governed · project linked · commercially actionable
          </span>
        </div>
      </section>

      {page === 'insights' && (
        <section className="hi2-public-stats">
          <div>
            <strong>{stats.projects || '—'}</strong>
            <span>Project signals</span>
          </div>
          <div>
            <strong>{stats.events || '—'}</strong>
            <span>Opportunity signals</span>
          </div>
          <div>
            <strong>{stats.high || '—'}</strong>
            <span>Priority-stage signals</span>
          </div>
          <div>
            <strong>
              {stats.feeds || '—'}/{stats.configured || '—'}
            </strong>
            <span>Successful / configured feeds</span>
          </div>
        </section>
      )}

      <section className="hi2-public-grid">
        {cards.map((card) => (
          <article key={card.title}>
            <div className="hi2-public-card-mark" />
            <h2>{card.title}</h2>
            <p>{card.copy}</p>
          </article>
        ))}
      </section>
      {page === 'insights' && (
        <section className="hi2-public-projects">
          <div className="hi2-public-section-head">
            <div className="hi2-eyebrow">SECURE DETAIL</div>
            <h2>Project-level intelligence is available after sign-in.</h2>
            <p>
              Public pages show aggregate coverage only. Canonical projects,
              organisations, map drill-downs, CRM and evidence provenance are
              protected inside the operational workspace.
            </p>
          </div>
        </section>
      )}

      {page === 'contact' && (
        <section className="hi2-public-contact-actions">
          <DemoRequestForm />
          <button className="hi2-outline-button hi2-large" onClick={onExplore}>
            Open secure workspace
          </button>
        </section>
      )}
    </main>
  );
}

export default function LandingPage({ onExplore }: LandingPageProps) {
  const publicPageFromHash = (): PublicPage => {
    const raw = window.location.hash.replace(/^#/, '');
    const pages: PublicPage[] = [
      'products',
      'solutions',
      'industries',
      'insights',
      'about',
      'privacy',
      'terms',
      'contact',
    ];
    return pages.includes(raw as PublicPage) ? (raw as PublicPage) : 'home';
  };
  const [dashboard, setDashboard] = useState<LandingDashboard | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const demoRef = useDialogFocus(demoOpen, () => setDemoOpen(false));
  const [publicPage, setPublicPage] = useState<PublicPage>(() =>
    publicPageFromHash(),
  );

  useEffect(() => {
    let active = true;
    api
      .get('/api/public/summary')
      .then((response) => {
        if (active) setDashboard(response.data as LandingDashboard);
      })
      .catch(() => {
        if (active) setDashboard(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncPage = () => setPublicPage(publicPageFromHash());
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [publicPage]);

  const stats = useMemo(
    () => ({
      projects: dashboard?.metrics?.active || 0,
      events:
        dashboard?.metrics?.eventSignals ||
        dashboard?.commercial?.events?.length ||
        0,
      feeds: dashboard?.sources?.active || 0,
      configured: dashboard?.sources?.configured || 0,
      high: dashboard?.metrics?.highPriority || 0,
    }),
    [dashboard],
  );

  const regionCount = (code: string) => dashboard?.regionalCounts?.[code] || 0;
  const openPublicPage = (next: PublicPage) => {
    setPublicPage(next);
    if (next === 'home') {
      history.pushState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      const nextHash = `#${next}`;
      if (window.location.hash !== nextHash) window.location.hash = nextHash;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="hi2-page">
      <header className="hi2-header">
        <button
          className="hi2-logo"
          onClick={() => openPublicPage('home')}
          aria-label="Hire Intelligence home"
        >
          <span className="hi2-slash" />
          <strong>Hire Intelligence</strong>
        </button>
        <nav className="hi2-nav" aria-label="Primary navigation">
          <a
            className={publicPage === 'products' ? 'active' : ''}
            href="#products"
          >
            Products
          </a>
          <a
            className={publicPage === 'solutions' ? 'active' : ''}
            href="#solutions"
          >
            Solutions
          </a>
          <a
            className={publicPage === 'industries' ? 'active' : ''}
            href="#industries"
          >
            Industries
          </a>
          <a
            className={publicPage === 'insights' ? 'active' : ''}
            href="#insights"
          >
            Insights
          </a>
          <a className={publicPage === 'about' ? 'active' : ''} href="#about">
            About
          </a>
        </nav>
        <div className="hi2-header-actions">
          <button className="hi2-login" onClick={onExplore}>
            Log in
          </button>
          <button className="hi2-red-button" onClick={() => setDemoOpen(true)}>
            Get a demo <ArrowRight size={15} />
          </button>
        </div>
      </header>

      {publicPage === 'home' ? (
        <main>
          <section className="hi2-hero" id="home-products">
            <div className="hi2-hero-copy">
              <div className="hi2-eyebrow">REAL SIGNALS. REAL OPPORTUNITY.</div>
              <h1>
                See what’s
                <br />
                next in <span>construction.</span>
              </h1>
              <p>
                Hire Intelligence turns complex project, contractor, shutdown
                and market data into clear, early signals — so you can plan,
                position and grow.
              </p>
              <div className="hi2-hero-actions">
                <button
                  className="hi2-red-button hi2-large"
                  onClick={() => setDemoOpen(true)}
                >
                  Get a demo <ArrowRight size={16} />
                </button>
                <button
                  className="hi2-outline-button hi2-large"
                  onClick={onExplore}
                >
                  Explore the platform
                </button>
              </div>
              <div className="hi2-benefits">
                <div>
                  <span>
                    <BarChart3 size={17} />
                  </span>
                  <b>Earlier opportunities</b>
                  <small>Spot projects before they hit the market.</small>
                </div>
                <div>
                  <span>
                    <Target size={17} />
                  </span>
                  <b>Smarter decisions</b>
                  <small>Backed by current scheduled source data.</small>
                </div>
                <div>
                  <span>
                    <ShieldCheck size={17} />
                  </span>
                  <b>A stronger, more resilient business</b>
                  <small>From pipeline to plant.</small>
                </div>
              </div>
            </div>

            <div
              className="hi2-hero-art"
              aria-label="Hire Intelligence platform preview"
            >
              <div className="hi2-red-wedge" />
              <div className="hi2-landscape-edge" />
              <div className="hi2-dashboard-frame">
                <div className="hi2-dashboard-top">
                  <div className="hi2-dashboard-brand">
                    <span className="hi2-mini-slash" />
                    Hire Intelligence
                  </div>
                  <div className="hi2-dashboard-search">
                    Search projects, companies, people…
                  </div>
                  <div className="hi2-dashboard-avatar">HI</div>
                </div>
                <div className="hi2-dashboard-body">
                  <div className="hi2-dashboard-nav">
                    {[
                      'Decision Desk',
                      'Commercial Intelligence',
                      'Opportunities',
                      'Projects',
                      'Map',
                      'Organisations & Delivery Teams',
                      'Equipment Demand',
                      'Resources',
                      'CRM',
                      'Reports',
                      'Alerts',
                      'Source Admin',
                    ].map((item, index) => (
                      <span key={item} className={index === 0 ? 'active' : ''}>
                        {item}
                      </span>
                    ))}
                  </div>
                  <div className="hi2-dashboard-main">
                    <div className="hi2-dashboard-heading">
                      <div>
                        <b>Project Activity</b>
                        <small>Current signals across Australia</small>
                      </div>
                      <span>Map</span>
                    </div>
                    <div className="hi2-map-stage">
                      <AustraliaGraphic />
                      <div className="hi2-map-pill wa">
                        WA
                        <br />
                        <b>{regionCount('WA') || '—'}</b>
                      </div>
                      <div className="hi2-map-pill qld">
                        QLD
                        <br />
                        <b>{regionCount('QLD') || '—'}</b>
                      </div>
                      <div className="hi2-map-pill nsw">
                        NSW
                        <br />
                        <b>{regionCount('NSW') || '—'}</b>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="hi2-floating-card card-live">
                <BellRing size={17} />
                <div>
                  <small>Current Feeds</small>
                  <b>
                    {stats.feeds || '—'}/{stats.configured || '—'}
                  </b>
                  <span>production feeds</span>
                </div>
              </div>
              <div className="hi2-floating-card card-high">
                <Building2 size={17} />
                <div>
                  <small>Priority-Stage Signals</small>
                  <b>{stats.high || '—'}</b>
                  <span>evidence-ranked</span>
                </div>
              </div>
              <div className="hi2-floating-card card-signal">
                <Radar size={17} />
                <div>
                  <small>Signal Events</small>
                  <b>{stats.events || '—'}</b>
                  <span>current intelligence</span>
                </div>
              </div>
              <div className="hi2-project-card">
                <span>CURRENT INTELLIGENCE</span>
                <b>{stats.high || '—'} priority-stage signals</b>
                <small>
                  {stats.events || '—'} current evidence-derived signals · sign
                  in for project detail
                </small>
              </div>
              <div className="hi2-hand-note">
                Turn signals
                <br />
                into opportunity.
              </div>
            </div>
          </section>

          <section className="hi2-features" id="home-solutions">
            {FEATURES.map((feature) => (
              <article className="hi2-feature" key={feature.key}>
                <div
                  className={`hi2-sprite-photo hi2-photo-${feature.key}`}
                  aria-hidden="true"
                />
                <div className="hi2-feature-label">
                  <FeatureIcon type={feature.icon} />
                  <span>{feature.eyebrow}</span>
                </div>
                <h2>{feature.title}</h2>
                <p>{feature.copy}</p>
                <button onClick={onExplore}>
                  Learn more <ArrowRight size={14} />
                </button>
              </article>
            ))}
          </section>

          <section className="hi2-proof" id="home-industries">
            <div className="hi2-positioning">
              <span>“</span>
              <p>
                Hire Intelligence gives rental teams a genuine head start:
                earlier visibility, clearer fleet planning and stronger focus on
                the opportunities that matter.
              </p>
              <small>Product positioning — evidence governed</small>
            </div>
            <div className="hi2-stat">
              <strong>{stats.projects || '—'}</strong>
              <span>
                Project signals
                <br />
                in current public window
              </span>
            </div>
            <div className="hi2-stat">
              <strong>{stats.events || '—'}</strong>
              <span>
                Current opportunity
                <br />
                event signals
              </span>
            </div>
            <div className="hi2-stat">
              <strong>
                {stats.feeds || '—'}/{stats.configured || '—'}
              </strong>
              <span>
                Successful / configured
                <br />
                live feeds
              </span>
            </div>
            <div className="hi2-australia-card">
              <AustraliaGraphic compact />
              <div>
                <b>BUILT FOR AUSTRALIA</b>
                <span>Backed by local data, for a stronger hire industry.</span>
              </div>
            </div>
          </section>

          <section className="hi2-cta" id="home-insights">
            <div>
              <h2>
                See further. <span>Hire smarter.</span>
              </h2>
              <p>Turn market signals into real business advantage.</p>
            </div>
            <button
              className="hi2-red-button hi2-large"
              onClick={() => setDemoOpen(true)}
            >
              Get a demo <ArrowRight size={16} />
            </button>
          </section>
        </main>
      ) : (
        <PublicPageView
          page={publicPage}
          stats={stats}
          onExplore={onExplore}
          onDemo={() => setDemoOpen(true)}
        />
      )}

      <footer className="hi2-footer" id="home-about">
        <div className="hi2-footer-brand">
          <span className="hi2-slash" />
          <strong>Hire Intelligence</strong>
          <small>A clearer tomorrow for the hire industry.</small>
        </div>
        <div className="hi2-footer-links">
          <button onClick={() => openPublicPage('privacy')}>Privacy</button>
          <button onClick={() => openPublicPage('terms')}>Terms</button>
          <button onClick={() => openPublicPage('contact')}>Contact</button>
        </div>
      </footer>

      {demoOpen && (
        <div className="hi2-modal-backdrop" onClick={() => setDemoOpen(false)}>
          <section
            ref={demoRef}
            tabIndex={-1}
            className="hi2-modal"
            onClick={(event) => event.stopPropagation()}
            aria-modal="true"
            role="dialog"
            aria-label="Request a Hire Intelligence demo"
          >
            <button
              className="hi2-modal-close"
              onClick={() => setDemoOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <div className="hi2-eyebrow">REQUEST A DEMO</div>
            <h2>See Hire Intelligence in action.</h2>
            <p>
              Tell us who you are and what you want to evaluate. The request is
              recorded for follow-up; the operational workspace remains sign-in
              protected.
            </p>
            <DemoRequestForm compact />
          </section>
        </div>
      )}
    </div>
  );
}
