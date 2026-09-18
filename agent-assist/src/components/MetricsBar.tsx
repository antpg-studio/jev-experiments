import type { State } from "../lib/store.ts";
import { LLM_BASELINE_MS } from "../lib/store.ts";
import { fmtMs, latencyStats } from "../lib/engine.ts";

interface Props {
  state: State;
  total: number;
}

export function MetricsBar({ state, total }: Props) {
  const panel = latencyStats(state.samples.map((s) => s.panelMs));
  const speedup = panel.count ? `${(LLM_BASELINE_MS / Math.max(1, panel.p50)).toFixed(0)}×` : "—";

  return (
    <div className="stats" title="Copilot panel refresh latency, measured in the browser with performance.now()">
      <Stat value={`${panel.count}`} label={`of ${total} judged`} />
      <Stat value={panel.count ? fmtMs(panel.p50) : "—"} label="p50" accent />
      <Stat value={panel.count ? fmtMs(panel.p95) : "—"} label="p95" accent />
      <Stat value={speedup} label={`vs ${LLM_BASELINE_MS / 1000} s LLM`} />
    </div>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
