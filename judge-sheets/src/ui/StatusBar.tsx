import { LLM_BASELINE_S_PER_CELL, summarize, type RunStats, type Totals } from "../lib/jevClient.ts";
import { fmtDuration, fmtMs } from "./format.ts";

type Props = {
  run: RunStats;
  totals: Totals;
  now: number;
  lastError: string | null;
  health: { mode: string; ok: boolean; concurrency: number };
};

export function StatusBar({ run, totals, now, lastError, health }: Props) {
  const elapsed = run.active ? now - run.startedAt : run.elapsedMs;
  const { p50, p95 } = summarize(run.latencies);
  const rate = elapsed > 0 ? run.cellsDone / (elapsed / 1000) : 0;
  const baselineS = run.cells * LLM_BASELINE_S_PER_CELL;
  const speedup = elapsed > 0 ? (baselineS * 1000) / elapsed : 0;
  const progress = run.requests > 0 ? run.requestsDone / run.requests : 0;
  const recent = run.latencies.slice(-80);
  const maxLat = Math.max(1, ...recent);
  const hasRun = run.requests > 0;

  return (
    <div className={`statusbar${run.active ? " running" : ""}`}>
      <div className="progress" style={{ width: `${(run.active ? progress : 0) * 100}%` }} />
      <div className="stat headline">
        {hasRun ? (
          <>
            <b>{run.cells}</b> cells · <b>{run.requests}</b> requests · <b>{fmtMs(elapsed)}</b> · p50{" "}
            <b>{fmtMs(p50)}</b> · p95 <b>{fmtMs(p95)}</b>
            {run.cacheHits > 0 && (
              <>
                {" "}
                · <span className="dim">{run.cacheHits} cache hits</span>
              </>
            )}
            {run.retries > 0 && <span className="dim"> · {run.retries} retries</span>}
            {run.errors > 0 && <span className="err"> · {run.errors} errors</span>}
          </>
        ) : (
          <span className="dim">idle — edit a JUDGE / PICK / RATE formula to start judging</span>
        )}
      </div>
      {hasRun && (
        <div className="stat rate">
          <b>{rate.toFixed(0)}</b> cells/s
        </div>
      )}
      {hasRun && (
        <div className="stat baseline" title={`simulated per-cell LLM call at ${LLM_BASELINE_S_PER_CELL} s per cell, ${run.cells} cells`}>
          per-cell LLM @ {LLM_BASELINE_S_PER_CELL} s: <b>{fmtDuration(baselineS)}</b>
          {speedup > 1 && <span className="speedup"> {speedup >= 100 ? speedup.toFixed(0) : speedup.toFixed(1)}× faster</span>}
        </div>
      )}
      <div className="spark" title="latency of the last requests (ms)">
        {recent.map((ms, i) => (
          <i key={i} style={{ height: `${Math.max(8, (ms / maxLat) * 100)}%` }} />
        ))}
      </div>
      <div className="stat totals dim" title="cumulative for this page load">
        session: {totals.cells} cells · {totals.requests} req
        {health.ok && ` · ${health.concurrency} lanes`}
      </div>
      {lastError && <div className="stat err">{lastError}</div>}
    </div>
  );
}
