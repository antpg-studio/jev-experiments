import type { ServerStats } from "../../shared/types.ts";
import type { Decision, FilterScore } from "../../shared/policy.ts";

export interface Metrics {
  counts: Record<Decision, number>;
  jev: FilterScore;
  wl: FilterScore;
  holdP50: number;
  holdP95: number;
  jevP50: number;
  jevP95: number;
  msgPerSec: number;
  elapsedMs: number;
  holdSamples: readonly number[];
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const pctOf = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
const clock = (v: number) => {
  const s = Math.floor(v / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function LatencyTrace({ samples }: { samples: readonly number[] }) {
  if (samples.length < 2) return <div className="trace-placeholder" />;
  const max = Math.max(1, ...samples);
  const points = samples.map((v, i) => `${(i / (samples.length - 1)) * 140},${32 - (v / max) * 28}`).join(" ");
  return (
    <svg className="latency-trace" viewBox="0 0 140 36" preserveAspectRatio="none" role="img" aria-label={`Hold times for the last ${samples.length} messages, scale 0 to ${Math.round(max)} milliseconds`}>
      <path d="M0 34H140" stroke="var(--line)" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Hud({ metrics: m, server, totalReleased, totalErrors }: { metrics: Metrics; server: ServerStats | null; totalReleased: number; totalErrors: number }) {
  const backlog = (server?.queued ?? 0) > 0;
  return (
    <section className="hud" aria-label="Live metrics">
      <div className="metric throughput">
        <span className="metric-label">Messages / second</span>
        <div className="metric-value">{m.msgPerSec.toFixed(1)}<span className="metric-unit">msg/s</span></div>
        <span className="metric-detail"><b>{totalReleased.toLocaleString()}</b> moderated · {clock(m.elapsedMs)} elapsed</span>
        <span className="metric-caption">Throughput over the last 3 seconds</span>
      </div>
      <div className="metric hold-metric">
        <span className="metric-label">Hold time <span className="percentile-label">p95</span></span>
        <div className="metric-value">{ms(m.holdP95)}<LatencyTrace samples={m.holdSamples} /></div>
        <span className="metric-detail">p50 <b>{ms(m.holdP50)}</b> · last 300 messages</span>
        <span className="metric-caption">Jev round trip p50 / p95 · {ms(m.jevP50)} / {ms(m.jevP95)}</span>
      </div>
      <div className={`metric ${backlog ? "backlog" : ""}`}>
        <span className="metric-label">In flight / queued</span>
        <div className="metric-value">{server?.inFlight ?? 0}<span className="metric-divider">/</span>{server?.queued ?? 0}</div>
        <span className="metric-detail pipeline-state"><span className="status-dot" /> {backlog ? "Clearing backlog" : "Queue clear"} <span className={totalErrors > 0 ? "error-text" : ""}>· {totalErrors} API errors</span></span>
        <span className="metric-caption">Each message gets 7 judgments in 1 request</span>
      </div>
    </section>
  );
}

export function Comparison({ metrics: m, customPolicy }: { metrics: Metrics; customPolicy: boolean }) {
  const actions: Array<[Decision, string]> = [
    ["allow", "Released"], ["hide", "Hidden"], ["timeout_user", "Timed out"], ["care", "Care"], ["review", "Review"],
  ];
  return (
    <section className="comparison" aria-label="Moderation outcomes">
      <div className="comparison-heading">
        <h2>Jev vs. a word list</h2>
        <p>Measured on the same chat.</p>
        <details className="outcome-details">
          <summary>Actions taken <span>↗</span></summary>
          <div className="outcomes">
            <div className="outcomes-heading"><span>Actions taken</span><span className={customPolicy ? "custom-policy" : ""}>{customPolicy ? "Custom thresholds" : "Default policy"}</span></div>
            <div className="outcome-counts">
              {actions.map(([key, label]) => <div key={key} className={`outcome ${key}`}><span>{label}</span><strong>{m.counts[key].toLocaleString()}</strong></div>)}
            </div>
          </div>
        </details>
        {customPolicy && <span className="custom-policy">Custom thresholds</span>}
      </div>
      <table>
        <thead><tr><th scope="col">Filter</th><th scope="col">Harmful caught</th><th scope="col">Clean messages blocked</th></tr></thead>
        <tbody>
          <tr><th scope="row">Keyword filter</th><td><strong>{pctOf(m.wl.caught, m.wl.harmfulTotal)}</strong><span>{m.wl.caught} / {m.wl.harmfulTotal}</span></td><td><strong>{pctOf(m.wl.wronglyBlocked, m.wl.cleanTotal)}</strong><span>{m.wl.wronglyBlocked} / {m.wl.cleanTotal}</span></td></tr>
          <tr className="jev-row"><th scope="row"><span className="status-dot" /> Jev + policy</th><td><strong>{pctOf(m.jev.caught, m.jev.harmfulTotal)}</strong><span>{m.jev.caught} / {m.jev.harmfulTotal}</span></td><td><strong>{pctOf(m.jev.wronglyBlocked, m.jev.cleanTotal)}</strong><span>{m.jev.wronglyBlocked} / {m.jev.cleanTotal}</span></td></tr>
        </tbody>
      </table>
    </section>
  );
}
