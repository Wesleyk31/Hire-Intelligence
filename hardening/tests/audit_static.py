from pathlib import Path
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
checks = []

def content(path):
    p = root / path
    return p.read_text() if p.exists() else ''

idx = content('backend/index.ts')
intel = content('backend/intelligence.ts')
fa = content('src/FunctionalApp.tsx')
lp = content('src/LandingPage.tsx')
gm = content('src/GeoMap.tsx')
report = content('src/reporting.ts')
app = content('src/App.tsx')

checks += [
    ('dashboard is protected', "'GET /api/dashboard':[requireAuth()" in idx),
    ('public summary exists', '/api/public/summary' in idx and '/api/public/summary' in lp),
    ('CRM writes are protected', "'POST /api/pilot/outcomes':[requireAuth()" in idx),
    ('CRM is user scoped', 'pilot_outcomes:${ctx.user!.userId}' in idx or 'pilot_outcomes:${userId}' in idx),
    ('no public manual source refresh route', "'POST /api/sources/refresh'" not in idx),
    ('CALL NOW is computed', 'isCallNowCandidate' in idx and 'callNow:projects.filter' in idx),
    ('no 50-project ceiling', '.slice(0, 50);' not in intel),
    ('canonical grouping helper used', 'groupCanonicalEvidence(records)' in intel),
    ('recency-aware stage helper used', 'chooseCurrentStage(stageSignals' in intel),
    ('delivery contractor role filter used', "organisationRole === 'DELIVERY_CONTRACTOR'" in intel),
    ('Organisations view renamed', 'Companies & Contacts' not in fa),
    ('scope programme jargon removed from heading', 'Scope 2150 Programme' not in fa),
    ('GREEN/AMBER customer jargon removed', 'GREEN / Runtime Sources' not in fa and 'AMBER · NOT RUNNING' not in fa),
    ('report preview exists', 'Current Report Preview' in fa),
    ('report history API used', '/api/reports/history' in fa),
    ('public/private overclaim removed', 'public and private sources' not in lp),
    ('real-time overclaim removed', 'real-time data' not in lp.lower() and 'real-time signals' not in lp.lower()),
    ('fake preview counts removed', '>142<' not in lp and '>311<' not in lp and '>198<' not in lp),
    ('demo form integrated', 'DemoRequestForm' in lp),
    ('dead LinkedIn mark removed', '<span>in</span>' not in lp),
    ('Australia-centre unresolved fallback removed', "Australia - location unresolved" not in gm),
    ('unique project map count used', 'visibleProjectIds.size' in gm),
    ('comprehensive report contains provenance', 'Source Health and Provenance' in report),
    ('auth gate wraps platform', '<AuthGate' in app),
]

failed = [name for name, ok in checks if not ok]
for name, ok in checks:
    print(('PASS' if ok else 'FAIL') + ' - ' + name)
if failed:
    raise SystemExit(f'{len(failed)} static hardening checks failed')
print(f'All {len(checks)} static hardening checks passed')
