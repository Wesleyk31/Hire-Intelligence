import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
type Pilot = {
  contract: {
    name: string;
    attribution: string;
    licence: { name: string; url: string };
  };
  evidence: Array<{
    externalId: string;
    project: string;
    location: string;
    sourceObservedAt?: string;
  }>;
  quarantine: Array<{
    externalId?: string;
    rowCount: number;
    qualityFlags: string[];
  }>;
  fetch: { rowsFetched: number; truncated: boolean; durationMs: number };
};
export default function SourcePilotPanel() {
  const [result, setResult] = useState<Pilot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function preview(key: string) {
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.get('/api/sources/pilots/' + key);
      if (request === sequence.current) setResult(data as Pilot);
    } catch {
      if (request === sequence.current)
        setError(
          'The source sample could not be loaded. The provider may be unavailable; try again later.',
        );
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <section className="hi-card hi-review-panel" aria-label="Source pilots">
      <h2>Source pilots</h2>
      <p>
        Read-only source samples · not scheduled. These records provide project
        context and are not promoted to demand alerts.
      </p>
      <div className="hi-review-controls">
        <button
          disabled={busy}
          onClick={() => void preview('logan-development-applications')}
        >
          Preview Logan sample
        </button>
        <button
          disabled={busy}
          onClick={() => void preview('qld-coordinated-projects')}
        >
          Preview Queensland projects
        </button>
      </div>
      {busy && (
        <p role="status">
          Checking source schema and loading a bounded sample…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <h3>{result.contract.name}</h3>
          <p>
            {result.fetch.rowsFetched} source rows checked ·{' '}
            {result.evidence.length} context records ·{' '}
            {result.quarantine.reduce((sum, item) => sum + item.rowCount, 0)}{' '}
            quarantined rows · {result.fetch.durationMs} ms.
          </p>
          {result.fetch.truncated && (
            <p>This sample is limited; additional source records exist.</p>
          )}
          <p>
            {result.contract.attribution}{' '}
            <a
              href={result.contract.licence.url}
              target="_blank"
              rel="noreferrer"
            >
              {result.contract.licence.name}
            </a>
          </p>
          {result.evidence.map((row) => (
            <p key={row.externalId}>
              <b>{row.project}</b> · {row.location} · source activity{' '}
              {row.sourceObservedAt || 'unknown'}
            </p>
          ))}
          {result.quarantine.map((row, index) => (
            <p key={index}>
              Held for review: {row.externalId || 'unidentified record'} ·{' '}
              {row.qualityFlags.join(', ')}
            </p>
          ))}
          <p>
            Successful sample access does not establish scheduled ingestion or
            production reliability.
          </p>
        </div>
      )}
    </section>
  );
}
