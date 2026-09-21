import { useEffect, useRef, useState } from "react";
import { api } from "./workspace-client";
import type { RegistryContract } from "../backend/registry-contracts";
import type { readPullHistory } from "../backend/pull-receipts";

type History = Awaited<ReturnType<typeof readPullHistory>>;
const label = (value: string | undefined | null) =>
  value ? value.replace(/_/g, " ") : "Unknown";
const count = (value: number | null | undefined) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value.toLocaleString()
    : "Unknown";

export default function SourceHealth() {
  const [contracts, setContracts] = useState<RegistryContract[]>([]);
  const [key, setKey] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );

  async function loadRegister() {
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    setHistory(null);
    try {
      const { data } = await api.get("/api/sources/contracts");
      const result = data as { contracts: RegistryContract[] };
      if (
        !Array.isArray(result?.contracts) ||
        result.contracts.some(
          (row) => !row?.key || !row.name || !row.rights || !row.cadence,
        )
      )
        throw new Error("INVALID_REGISTER");
      if (request === sequence.current) {
        setContracts(result.contracts);
        setKey(result.contracts[0]?.key || "");
      }
    } catch {
      if (request === sequence.current)
        setError("Source register could not be loaded. Try again.");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function loadHistory(cursor?: string) {
    if (!key || busy) return;
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    setHistory(null);
    try {
      const { data } = await api.get(
        "/api/sources/" +
          encodeURIComponent(key) +
          "/health" +
          (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      const result = data as History;
      if (
        result?.contract?.key !== key ||
        !result.health?.transport ||
        !result.coverage ||
        !Array.isArray(result.receipts) ||
        result.receipts.length > 100 ||
        result.receipts.some(
          (row) =>
            row.sourceKey !== key ||
            !row.counts ||
            !row.transport ||
            !row.dates,
        )
      )
        throw new Error("INVALID_HISTORY");
      if (request === sequence.current) setHistory(result);
    } catch {
      if (request === sequence.current)
        setError("Pull history could not be loaded. Try again.");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  const contract = contracts.find((row) => row.key === key);
  return (
    <section
      className="hi-card hi-review-panel"
      aria-label="Source contracts and pull receipts"
      aria-busy={busy}
      style={{ overflowWrap: "anywhere" }}
    >
      <h2>Source contracts and pull receipts</h2>
      <p>
        Inspect the registered terms and recorded pull outcomes. Loading this
        view does not run a collector or change source activation.
      </p>
      <div className="hi-review-controls">
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadRegister()}
        >
          {contracts.length ? "Reload source register" : "Load source register"}
        </button>
        {contracts.length > 0 && (
          <>
            <label>
              Source contract
              <select
                value={key}
                disabled={busy}
                onChange={(event) => {
                  sequence.current++;
                  setKey(event.target.value);
                  setHistory(null);
                  setError("");
                }}
              >
                {contracts.map((source) => (
                  <option key={source.key} value={source.key}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !key}
              onClick={() => void loadHistory()}
            >
              View pull history
            </button>
          </>
        )}
      </div>
      {busy && <p role="status">Loading saved source information…</p>}
      {error && <p role="alert">{error}</p>}
      {contract && (
        <details open className="hi-source-contract">
          <summary>
            {contract.name} · {label(contract.activation)}
          </summary>
          <p>{contract.activationReason}</p>
          <dl className="hi-health-grid">
            <div>
              <dt>Owning agency</dt>
              <dd>{contract.owningAgency}</dd>
            </div>
            <div>
              <dt>Registered licence label</dt>
              <dd>{contract.attribution.licenceLabel}</dd>
            </div>
            <div>
              <dt>Rights review</dt>
              <dd>{label(contract.rights.status)}</dd>
            </div>
            <div>
              <dt>Commercial reuse</dt>
              <dd>{label(contract.allowedUses.commercial)}</dd>
            </div>
            <div>
              <dt>Publisher cadence</dt>
              <dd>{label(contract.cadence.publisher)}</dd>
            </div>
            <div>
              <dt>Source-date meaning</dt>
              <dd>{label(contract.dates.eventSemantics)}</dd>
            </div>
          </dl>
          <p>
            <a href={contract.provenance} target="_blank" rel="noreferrer">
              Source provenance
            </a>{" "}
            · Contract {contract.version.slice(0, 12)} · Publication version{" "}
            {label(contract.resourceVersion)}
          </p>
          <p>
            A registered licence label does not establish reviewed reuse
            permission. Existing activation is shown separately.
          </p>
        </details>
      )}
      {history && (
        <div aria-live="polite">
          <h3>Recorded health · this receipt page</h3>
          <p>
            {history.coverage.complete
              ? "All stored receipts fit this page."
              : "Partial history — this page cannot establish the latest result across all pulls."}
          </p>
          <dl className="hi-health-grid">
            <div>
              <dt>Transport</dt>
              <dd>
                {label(history.health.transport.status)}
                {history.health.transport.httpStatus !== null &&
                  ` · HTTP ${history.health.transport.httpStatus}`}
              </dd>
            </div>
            <div>
              <dt>Parser</dt>
              <dd>{label(history.health.parser)}</dd>
            </div>
            <div>
              <dt>Ingestion</dt>
              <dd>{label(history.health.ingestion)}</dd>
            </div>
            <div>
              <dt>Latest source date in selected pull</dt>
              <dd>{history.health.newestSourceDate || "Unknown"}</dd>
            </div>
            <div>
              <dt>Freshness</dt>
              <dd>{label(history.health.freshness)}</dd>
            </div>
            <div>
              <dt>Last acknowledged ingestion in this page</dt>
              <dd>
                {history.health.lastAcknowledgedIngestion ||
                  "No confirmed ingestion in this page"}
              </dd>
            </div>
          </dl>
          <p>{history.disclosure}</p>
          {history.coverage.omittedInvalid > 0 && (
            <p role="status">
              {history.coverage.omittedInvalid} malformed saved receipt(s) were
              excluded and need review.
            </p>
          )}
          {!history.receipts.length && (
            <p>
              No pull receipts in this page. Earlier runs may predate receipt
              support.
            </p>
          )}
          <div className="hi-receipt-list">
            {history.receipts.map((receipt, index) => (
              <details key={receipt.receiptId || index} open={index === 0}>
                <summary>
                  {receipt.mode} · {receipt.startedAt} · {receipt.outcome}
                </summary>
                <p>
                  {label(receipt.transport.status)}
                  {receipt.transport.httpStatus !== null &&
                    ` · HTTP ${receipt.transport.httpStatus}`}{" "}
                  · Parser: {label(receipt.parser)} ·{" "}
                  {label(receipt.reconciliation)}
                </p>
                <p>
                  Received: {count(receipt.counts.received)} · Normalised:{" "}
                  {count(receipt.counts.normalised)} · Unique:{" "}
                  {count(receipt.counts.unique)} · Duplicate:{" "}
                  {count(receipt.counts.duplicate)}
                </p>
                <p>
                  Held identities: {count(receipt.counts.held)} · Acknowledged:{" "}
                  {count(receipt.counts.acknowledged)} · Unacknowledged:{" "}
                  {count(receipt.counts.unacknowledged)} · Uncertain:{" "}
                  {count(receipt.counts.uncertain)}
                </p>
                <p>{receipt.countBasis}</p>
                {receipt.outcome === "RUNNING" && (
                  <p>
                    Outcome not confirmed. A stopped or interrupted pull may
                    have written rows; review before retrying.
                  </p>
                )}
                {receipt.persistenceUncertain && (
                  <p>
                    Storage needs reconciliation. Acknowledged is a confirmed
                    lower bound; additional rows may exist.
                  </p>
                )}
                {receipt.failure && <p>Failure: {receipt.failure}</p>}
              </details>
            ))}
          </div>
          {history.nextCursor && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadHistory(history.nextCursor!)}
            >
              Next receipt page
            </button>
          )}
        </div>
      )}
    </section>
  );
}
