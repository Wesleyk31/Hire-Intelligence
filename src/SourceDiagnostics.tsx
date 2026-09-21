import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './workspace-client';

type Source = { sourceKey: string; name: string };
type Diagnostic = {
  source: {
    key: string;
    name: string;
    enabled: boolean;
    licence: string;
    provenance: string;
  };
  durationMs: number;
  recordsFetched: number;
  observedAt: string;
  sample: Array<Record<string, unknown>>;
  persisted: false;
  disclosure: string;
};
const display = (value: unknown, fallback = 'Unknown') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export default function SourceDiagnostics({ sources }: { sources: Source[] }) {
  const available = useMemo(
    () => [
      ...new Map(
        sources
          .filter(
            (source) =>
              typeof source.sourceKey === 'string' && source.sourceKey.trim(),
          )
          .map((source) => [source.sourceKey, source]),
      ).values(),
    ],
    [sources],
  );
  const [sourceKey, setSourceKey] = useState(available[0]?.sourceKey || '');
  const [result, setResult] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (!available.some((source) => source.sourceKey === sourceKey)) {
      sequence.current++;
      setSourceKey(available[0]?.sourceKey || '');
      setResult(null);
      setError('');
      setBusy(false);
    }
  }, [available, sourceKey]);

  function chooseSource(key: string) {
    sequence.current++;
    setSourceKey(key);
    setResult(null);
    setError('');
    setBusy(false);
  }

  async function run() {
    if (busy || !available.some((source) => source.sourceKey === sourceKey))
      return;
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const { data } = await api.get(
        '/api/sources/' + encodeURIComponent(sourceKey) + '/diagnostic',
      );
      const diagnostic = data as Diagnostic;
      if (
        !diagnostic ||
        diagnostic.source?.key !== sourceKey ||
        typeof diagnostic.source.enabled !== 'boolean' ||
        diagnostic.persisted !== false ||
        !Number.isSafeInteger(diagnostic.recordsFetched) ||
        diagnostic.recordsFetched < 0 ||
        !Number.isFinite(diagnostic.durationMs) ||
        diagnostic.durationMs < 0 ||
        !Array.isArray(diagnostic.sample) ||
        diagnostic.sample.length > 5 ||
        diagnostic.sample.length > diagnostic.recordsFetched ||
        diagnostic.sample.some(
          (row) => !row || typeof row !== 'object' || Array.isArray(row),
        )
      )
        throw new Error('INVALID_DIAGNOSTIC_RESPONSE');
      if (request === sequence.current) setResult(diagnostic);
    } catch {
      if (request === sequence.current)
        setError(
          'Collector check failed. The provider may be unavailable or its schema may have changed. Try the check again.',
        );
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }

  return (
    <section
      className="hi-card hi-review-panel"
      aria-label="Collector diagnostics"
      aria-busy={busy}
      style={{ overflowWrap: 'anywhere' }}
    >
      <h2>Collector diagnostics</h2>
      <p>
        Run a bounded, read-only collector check. Results are not saved or used
        to activate a feed.
      </p>
      <div className="hi-review-controls">
        <label>
          Collector source
          <select
            value={sourceKey}
            disabled={busy || !available.length}
            onChange={(event) => chooseSource(event.target.value)}
          >
            {!available.length && (
              <option value="">No collectors available</option>
            )}
            {available.map((source) => (
              <option key={source.sourceKey} value={source.sourceKey}>
                {display(source.name, source.sourceKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !sourceKey}
          onClick={() => void run()}
        >
          {busy ? 'Checking collector…' : 'Run collector check'}
        </button>
      </div>
      {!available.length && (
        <p>No configured collectors are available for this check.</p>
      )}
      {busy && (
        <p role="status">Checking collector and loading a bounded sample…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <h3>{display(result.source.name, result.source.key)}</h3>
          <p>
            {result.recordsFetched} rows returned ·{' '}
            {result.durationMs.toLocaleString('en-AU')} ms. Showing{' '}
            {result.sample.length} sample records.
          </p>
          <p>
            Configured {result.source.enabled ? 'enabled' : 'disabled'} ·
            Licence: {display(result.source.licence)}
          </p>
          <p>
            Collector completed: {display(result.observedAt)}. Collection time
            does not establish source activity.
          </p>
          <p>Source provenance: {display(result.source.provenance)}</p>
          {result.recordsFetched === 0 && (
            <p role="status">
              No rows were returned. This does not distinguish an empty source
              from a feed or parser problem.
            </p>
          )}
          <div className="hi-evidence-list">
            {result.sample.map((row, index) => (
              <article key={display(row.externalId, 'sample') + ':' + index}>
                <b>{display(row.project, 'Untitled source record')}</b>
                <p>
                  {display(row.location)} · Source ID: {display(row.externalId)}
                </p>
                <p>Source activity: {display(row.sourceObservedAt)}</p>
                <p>Collected: {display(row.observedAt)}</p>
                <p>Provenance: {display(row.provenance)}</p>
              </article>
            ))}
          </div>
          <p>
            No records were saved.{' '}
            {display(
              result.disclosure,
              'This check does not establish scheduled ingestion reliability.',
            )}
          </p>
        </div>
      )}
    </section>
  );
}
