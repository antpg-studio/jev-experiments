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
}

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const pctOf = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((100 * a) / b)}%`);
const clock = (v: number) => {
  const s = Math.floor(v / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Hud({ metrics: m, server, totalReleased, totalErrors }: { metrics: Metrics; server: ServerStats | null; totalReleased: number; totalErrors: number }) {
  const backlog = (server?.queued ?? 0) > 0;
  return (
    <section className="hud" aria-label="live metrics">
      <div className="card">
        <span className="label">released</span>
        <span className="value">{m.msgPerSec.toFixed(1)}</span>
        <span className="unit">msg/s (3 s window)</span>
      </div>
      <div className={`card ${backlog ? "warn" : ""}`}>
        <span className="label">in flight / queued</span>
        <span className="value">
          {server?.inFlight ?? 0}
          <span className="dim"> / </span>
          {server?.queued ?? 0}
        </span>
        <span className="unit">concurrency {server?.concurrency ?? "–"}</span>
      </div>
      <div className="card accent">
        <span className="label">hold time p50 / p95</span>
        <span className="value">
          {ms(m.holdP50)}
          <span className="dim"> / </span>
          {ms(m.holdP95)}
        </span>
        <span className="unit">arrival → release, last 300 msgs</span>
      </div>
      <div className="card">
        <span className="label">jev round trip p50 / p95</span>
        <span className="value">
          {ms(m.jevP50)}
          <span className="dim"> / </span>
          {ms(m.jevP95)}
        </span>
        <span className="unit">7 questions · 1 request</span>
      </div>
      <div className="card">
        <span className="label">moderated · elapsed</span>
        <span className="value">
          {totalReleased.toLocaleString()}
          <span className="dim"> · </span>
          {clock(m.elapsedMs)}
        </span>
        <span className="unit">{totalErrors > 0 ? `${totalErrors} errors → review` : "0 errors"}</span>
      </div>
      <div className="card actions">
        <span className="label">actions taken</span>
        <div className="chips">
          <span className="chip allow">allow {m.counts.allow}</span>
          <span className="chip hide">hide {m.counts.hide}</span>
          <span className="chip timeout">timeout {m.counts.timeout_user}</span>
          <span className="chip care">care {m.counts.care}</span>
          <span className="chip review">review {m.counts.review}</span>
        </div>
      </div>
      <div className="card compare">
        <span className="label">vs. ground truth (fixture labels)</span>
        <table>
          <thead>
            <tr>
              <th />
              <th>caught harmful</th>
              <th>wrongly blocked</th>
            </tr>
          </thead>
          <tbody>
            <tr className="wl">
              <td>word-list filter</td>
              <td>
                <b>{m.wl.caught}</b> of {m.wl.harmfulTotal} <span className="pct">{pctOf(m.wl.caught, m.wl.harmfulTotal)}</span>
              </td>
              <td>
                <b>{m.wl.wronglyBlocked}</b> of {m.wl.cleanTotal} clean <span className="pct">{pctOf(m.wl.wronglyBlocked, m.wl.cleanTotal)}</span>
              </td>
            </tr>
            <tr className="jv">
              <td>Jev + policy</td>
              <td>
                <b>{m.jev.caught}</b> of {m.jev.harmfulTotal} <span className="pct">{pctOf(m.jev.caught, m.jev.harmfulTotal)}</span>
              </td>
              <td>
                <b>{m.jev.wronglyBlocked}</b> of {m.jev.cleanTotal} clean <span className="pct">{pctOf(m.jev.wronglyBlocked, m.jev.cleanTotal)}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
