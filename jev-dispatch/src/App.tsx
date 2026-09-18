import { useCallback, useEffect, useRef, useState } from "react";
import { MapView } from "./MapView.tsx";
import { EventLog, Feed, Incidents } from "./panels.tsx";
import { fmtMs, fmtSeconds, fmtUsd } from "./kpi.ts";
import { makeLiveDecider } from "./live.ts";
import { DEFAULT_SEED, MANUAL_SECONDS, MODE_LABEL, RUN_SECONDS, SLOW_LLM_SECONDS, Sim, type Kpis, type Mode } from "./sim.ts";

const MODES: Mode[] = ["manual", "slow", "jev"];
const SPEEDS = [1, 2, 4];

const liveDecider = makeLiveDecider("/api/jev");

function newSim(mode: Mode, seed: number): Sim {
  return new Sim(mode, seed, mode === "jev" ? liveDecider : null);
}

interface KpiProps {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "bad" | "warn" | "good" | "accent";
  jev?: boolean;
  off?: boolean;
  tight?: boolean;
}

function Kpi({ label, value, unit, sub, tone, jev, off, tight }: KpiProps) {
  return (
    <div className={`kpi ${tone ?? ""} ${jev ? "jev" : ""} ${off ? "off" : ""}`}>
      <div className="label">{label}</div>
      <div className={`value mono ${tight ? "tight" : ""}`}>{value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function App() {
  const seed = DEFAULT_SEED;
  const [mode, setMode] = useState<Mode>("jev");
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [, setTick] = useState(0);
  const [results, setResults] = useState<Partial<Record<Mode, Kpis>>>({});
  const [autoRun, setAutoRun] = useState<Mode[] | null>(null);
  const simRef = useRef<Sim>(newSim("jev", seed));
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  speedRef.current = speed;
  pausedRef.current = paused;

  const start = useCallback((m: Mode) => {
    simRef.current = newSim(m, seed);
    setMode(m);
    setPaused(false);
    setTick((t) => t + 1);
  }, [seed]);

  useEffect(() => {
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) {
        const sim = simRef.current;
        const simDt = dt * speedRef.current;
        for (let s = simDt; s > 0; s -= 0.05) sim.step(Math.min(0.05, s));
      }
      acc += dt;
      if (acc >= 0.1) {
        acc = 0;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sim = simRef.current;
  const k = sim.kpis();
  const done = sim.finalKpis !== null;

  useEffect(() => {
    if (!sim.finalKpis) return;
    const final = sim.finalKpis;
    setResults((r) => (r[sim.mode] === final ? r : { ...r, [sim.mode]: final }));
    if (autoRun && autoRun.length) {
      const [next, ...rest] = autoRun;
      setAutoRun(rest.length ? rest : null);
      start(next);
    }
  }, [sim, sim.finalKpis, autoRun, start]);

  const jevLive = mode === "jev" && k.jev.requests > 0 && k.jev.errors < k.jev.requests;
  const perReport = mode === "manual" ? `${MANUAL_SECONDS}s / report` : mode === "slow" ? `${SLOW_LLM_SECONDS}s / report, sequential` : `${k.jev.inflight} in flight`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>Jev Dispatch</strong>
        </div>
        <div className="modes">
          {MODES.map((m) => (
            <button key={m} className={`${m === mode ? "active" : ""} ${m}`} onClick={() => start(m)}>
              {MODE_LABEL[m]}
              <small>{m === "manual" ? `human, ${MANUAL_SECONDS} s each` : m === "slow" ? `${SLOW_LLM_SECONDS} s, sequential` : "fan-out, overlapping"}</small>
            </button>
          ))}
        </div>
        <button onClick={() => { setResults({}); setAutoRun(["slow", "jev"]); start("manual"); }} title="Run manual → slow → Jev on the same seed and fill the comparison table">
          Run all 3
        </button>
        <div className="spacer" />
        <span className={`status-pill ${mode !== "jev" ? "" : jevLive ? "live" : k.jev.fallbacks > 0 ? "fallback" : ""}`}>
          {mode !== "jev" ? MODE_LABEL[mode] : jevLive ? "typesafe/jev-1.13 live" : k.jev.requests === 0 ? "jev idle" : "fallback"}
        </span>
        <div className="speed">
          {SPEEDS.map((s) => <button key={s} className={s === speed ? "active" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
        <button className="pause" onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
        <button onClick={() => start(mode)}>Restart</button>
        <button className="surge" onClick={() => { sim.surge(); setTick((t) => t + 1); }} title="Fire 40 extra reports over the next 10 seconds">Mass-casualty surge · 40 in 10 s</button>
        <div className="clock mono">{fmtSeconds(sim.time)}{done ? " ✓" : ""}</div>
      </header>

      <section className="kpis">
        <Kpi label="Median dispatch" value={k.medianDispatchS ? fmtSeconds(k.medianDispatchS) : "–"} tone={k.medianDispatchS > 30 ? "bad" : k.medianDispatchS > 5 ? "warn" : "good"} sub={`first report → first unit · triage ${fmtSeconds(k.medianTriageS)}`} />
        <Kpi label="Critical > 60 s" value={String(k.criticalWaiting)} tone={k.criticalWaiting > 0 ? "bad" : "good"} sub="severity ≥ 3, no unit assigned" />
        <Kpi label="In queue" value={String(k.queued)} tone={k.queued > 20 ? "bad" : k.queued > 5 ? "warn" : undefined} sub={perReport} />
        <Kpi label="Units idle" value={`${k.unitsIdle}`} unit={`/ ${k.unitsTotal}`} sub={`${k.incidentsOpen} open · ${k.incidentsClosed} closed`} />
        <Kpi label="Dupes merged" value={String(k.merged)} sub={`${k.reportsDecided} / ${k.reportsArrived} triaged`} />
        <div className="kpi-gap" />
        <Kpi jev off={mode !== "jev"} tight label="Latency last/p50/p95" value={`${fmtMs(k.jev.lastMs)} / ${fmtMs(k.jev.p50Ms)} / ${fmtMs(k.jev.p95Ms)}`} unit="ms" tone="accent" sub={`${k.jev.inflight} in flight · ${k.jev.fallbacks} fallbacks`} />
        <Kpi jev off={mode !== "jev"} label="Decisions / sec" value={k.jev.decisionsPerSec.toFixed(1)} tone="accent" sub="trailing 10 s window" />
        <Kpi jev off={mode !== "jev"} label="Requests" value={String(k.jev.requests)} sub={`${k.jev.errors} errors · ${k.jev.stale} stale`} />
        <Kpi jev off={mode !== "jev"} label="Input tokens" value={k.jev.inputTokens.toLocaleString()} sub={`${k.jev.requests ? Math.round(k.jev.inputTokens / k.jev.requests) : 0} / request · output free`} />
        <Kpi jev off={mode !== "jev"} label="Cost / 1k reports" value={fmtUsd(k.jev.costPer1k)} sub={`run ${fmtUsd(k.jev.costUsd)} · $0.042 / Mtok in`} />
      </section>

      <main className="main">
        <Feed items={sim.feed} time={sim.time} />
        <MapView city={sim.city} units={sim.units} incidents={sim.incidents} time={sim.time} caption={`seed ${seed} · ${sim.schedule.length} reports`} />
        <Incidents incidents={sim.incidents} time={sim.time} />
      </main>

      <footer className="bottom">
        <EventLog log={sim.log} />
        <Compare results={results} current={mode} live={done ? null : k} autoRun={autoRun} />
      </footer>
    </div>
  );
}

function Compare({ results, current, live, autoRun }: { results: Partial<Record<Mode, Kpis>>; current: Mode; live: Kpis | null; autoRun: Mode[] | null }) {
  const cell = (m: Mode, f: (k: Kpis) => string, tone?: (k: Kpis) => string) => {
    const k = results[m] ?? (m === current && live ? live : null);
    if (!k) return <td key={m} className="empty">–</td>;
    const partial = !results[m];
    return <td key={m} className={tone ? tone(k) : ""} style={partial ? { opacity: 0.55 } : undefined}>{f(k)}{partial ? "…" : ""}</td>;
  };
  const row = (label: string, f: (k: Kpis) => string, tone?: (k: Kpis) => string) => (
    <tr><td>{label}</td>{MODES.map((m) => cell(m, f, tone))}</tr>
  );
  return (
    <div className="compare">
      <h2 className="subhead">
        Same seed, {RUN_SECONDS}s run
        <span style={{ color: "var(--dim)", fontWeight: 400 }}>{autoRun ? `auto: next ${autoRun.map((m) => MODE_LABEL[m]).join(" → ")}` : "values at the 3:00 mark"}</span>
      </h2>
      <table>
        <thead><tr><th /><th>Manual</th><th>Slow LLM</th><th className="jev">Jev</th></tr></thead>
        <tbody>
          {row("Median time-to-dispatch", (k) => fmtSeconds(k.medianDispatchS), (k) => (k.medianDispatchS > 30 ? "bad" : k.medianDispatchS < 5 ? "good" : ""))}
          {row("Critical waiting > 60 s", (k) => String(k.criticalWaiting), (k) => (k.criticalWaiting > 0 ? "bad" : "good"))}
          {row("Still in queue", (k) => String(k.queued), (k) => (k.queued > 20 ? "bad" : k.queued === 0 ? "good" : ""))}
          {row("Reports triaged", (k) => `${k.reportsDecided} / ${k.reportsArrived}`)}
          {row("Duplicates merged", (k) => String(k.merged))}
        </tbody>
      </table>
    </div>
  );
}
