import { useEffect, useRef, useState } from 'react';
import { api } from './workspace-client';

type Origin = 'ARCHIVE' | 'LIVE';
type ReviewRow = {
  reviewId: string;
  sourceKey: string;
  externalId: string;
  project: string;
  location: string;
  description: string;
  sourceObservedAt: string;
  provenance: string;
  issues: string[];
  contentHash: string;
};
type ReviewPage = {
  items: ReviewRow[];
  nextCursor?: string;
  pageIssues: string[];
  summary: { rows: number; needsReview: number; duplicateRows: number };
  disclosure: string;
};

export default function EvidenceExplorer() {
  const [open, setOpen] = useState(false),
    [origin, setOrigin] = useState<Origin>('ARCHIVE');
  const [cursors, setCursors] = useState<Array<string | undefined>>([
      undefined,
    ]),
    [position, setPosition] = useState(0);
  const [result, setResult] = useState<ReviewPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function load(kind: Origin, cursor: string | undefined) {
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const query = new URLSearchParams({ origin: kind, limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const { data } = await api.get(
        '/api/evidence/review?' + query.toString(),
      );
      if (request === sequence.current) setResult(data as ReviewPage);
    } catch {
      if (request === sequence.current)
        setError(
          'Evidence could not be loaded. Retry this page or start again.',
        );
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  function changeOrigin(kind: Origin) {
    setOrigin(kind);
    setCursors([undefined]);
    setPosition(0);
    void load(kind, undefined);
  }
  function move(next: number) {
    const cursor = next > position ? result?.nextCursor : cursors[next];
    if (next > position) setCursors([...cursors.slice(0, next), cursor]);
    setPosition(next);
    void load(origin, cursor);
  }
  function exportPage() {
    if (!result) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...result,
            origin,
            pageNumber: position + 1,
            cursor: cursors[position] ?? null,
            exportedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download =
      'hire-intelligence-evidence-review-' +
      origin.toLowerCase() +
      '-' +
      (position + 1) +
      '.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="hi-card hi-review-panel" aria-label="Stored evidence">
      <h2>Stored evidence</h2>
      <p>
        Browse current records and historical pages beyond the dashboard window.
        Review findings preserve the stored originals.
      </p>
      {!open ? (
        <button
          onClick={() => {
            setOpen(true);
            void load(origin, undefined);
          }}
        >
          Browse stored evidence
        </button>
      ) : (
        <>
          <div className="hi-review-controls">
            <label>
              Evidence collection
              <select
                value={origin}
                disabled={busy}
                onChange={(event) => changeOrigin(event.target.value as Origin)}
              >
                <option value="ARCHIVE">Historical archive</option>
                <option value="LIVE">Current evidence</option>
              </select>
            </label>
            <button
              disabled={busy || position === 0}
              onClick={() => move(position - 1)}
            >
              Previous page
            </button>
            <span>Page {position + 1}</span>
            <button
              disabled={busy || !result?.nextCursor}
              onClick={() => move(position + 1)}
            >
              Next page
            </button>
            <button disabled={busy || !result} onClick={exportPage}>
              Export review page
            </button>
            <button disabled={busy} onClick={() => changeOrigin(origin)}>
              Start again
            </button>
          </div>
          {busy && <p role="status">Loading stored evidence…</p>}
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button onClick={() => void load(origin, cursors[position])}>
                Retry this page
              </button>
            </div>
          )}
          {result && (
            <>
              <p>
                {result.summary.rows} rows · {result.summary.needsReview} with
                review findings · {result.summary.duplicateRows} duplicate
                identities on this page.
              </p>
              <p>{result.disclosure}</p>
              {result.pageIssues.length > 0 && (
                <p role="status">
                  Page needs review: {result.pageIssues.join(', ')}. Continue to
                  inspect later pages.
                </p>
              )}
              {result.items.length === 0 && <p>No records on this page.</p>}
              <div className="hi-review-records">
                {result.items.map((row) => (
                  <details key={row.reviewId}>
                    <summary>
                      {row.project || 'Unnamed evidence'}{' '}
                      <small>
                        {row.sourceKey} · {row.location}
                      </small>
                    </summary>
                    <p>{row.description}</p>
                    <p>
                      Source activity: {row.sourceObservedAt || 'Unknown'} ·
                      Source record: {row.externalId || 'Missing'}
                    </p>
                    {row.issues.length > 0 && (
                      <p>Review findings: {row.issues.join(', ')}</p>
                    )}
                    {/^(https?:)\/\//i.test(row.provenance) && (
                      <a href={row.provenance} target="_blank" rel="noreferrer">
                        Open original source
                      </a>
                    )}
                    <p className="hi-review-hash">
                      Record fingerprint: {row.contentHash}
                    </p>
                  </details>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
