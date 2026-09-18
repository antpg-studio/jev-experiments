import type { State } from "../lib/store.ts";
import { LLM_BASELINE_MS } from "../lib/store.ts";
import { fmtMs, latencyStats } from "../lib/engine.ts";

interface Props {
  state: State;
  total: number;
}

export function MetricsBar({ state, total }: Props) {
  const panel = latencyStats(state.samples.map((s) => s.panelMs));
  const jev = latencyStats(state.samples.map((s) => s.jevMs));
  const end = state.runEndedAt ?? performance.now();
  const elapsedMs = state.runStartedAt !== null ? end - state.runStartedAt : 0;
  const perSec = elapsedMs > 0 ? (panel.count / elapsedMs) * 1000 : 0;
  const inFlight = state.chats.filter((c) => c.pending).length;

  return (
    <div className="metrics">
      <Metric label="messages judged" value={`${panel.count}`} sub={`of ${total} · ${inFlight} in flight`} />
      <Metric label="panel refresh p50" value={fmtMs(panel.p50)} sub={`Jev p50 ${fmtMs(jev.p50)}`} big />
      <Metric label="panel refresh p95" value={fmtMs(panel.p95)} sub={`Jev p95 ${fmtMs(jev.p95)}`} big />
      <Metric label="min / max" value={`${fmtMs(panel.min)} / ${fmtMs(panel.max)}`} sub={`mean ${fmtMs(panel.mean)}`} />
      <Metric label="messages / s" value={perSec.toFixed(2)} sub="since run started" />
      <Metric label="elapsed" value={fmtMs(elapsedMs)} sub={state.runEndedAt ? "run finished" : state.runStartedAt ? "running" : "idle"} />
      <Metric label="tokens" value={state.tokens.toLocaleString()} sub="in + out" />
      <Metric
        label="vs LLM baseline"
        value={panel.count ? `${(LLM_BASELINE_MS / Math.max(1, panel.p50)).toFixed(0)}× faster` : "—"}
        sub={`${LLM_BASELINE_MS / 1000} s simulated`}
        dim
      />
    </div>
  );
}

function Metric({ label, value, sub, big, dim }: { label: string; value: string; sub?: string; big?: boolean; dim?: boolean }) {
  return (
    <div className={`metric ${big ? "big" : ""} ${dim ? "dim" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
