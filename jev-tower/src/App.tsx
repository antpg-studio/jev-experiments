import { useCallback, useEffect, useRef, useState } from "react";
import type { Mode } from "./types.ts";
import { Sim, type Scorecard, type TickerEntry } from "./engine.ts";
import { Controller, SLOW_LLM_DELAY_MS, decisionsPerSecond, newTelemetry, type Telemetry } from "./controller.ts";
import { Scope, type ScopeSnapshot } from "./Scope.tsx";

const TICK_S = 0.5;
const DEFAULT_SEED = 7;

const MODE_LABEL: Record<Mode, string> = {
  rules: "Rule-based autopilot",
  jev: "Jev",
  slow: `Slow LLM (${SLOW_LLM_DELAY_MS / 1000} s)`,
};

interface View {
  t: number;
  count: number;
  score: Scorecard;
  telemetry: Telemetry;
  dps: number;
  ticker: TickerEntry[];
  conflicts: number;
}

interface Runtime {
  sim: Sim;
  controller: Controller;
  telemetry: Telemetry;
  acc: number;
}

function makeRuntime(mode: Mode, seed: number, rushHour: boolean): Runtime {
  const sim = new Sim({ seed, rushHour });
  const telemetry = newTelemetry();
  return { sim, controller: new Controller(mode, sim, telemetry), telemetry, acc: 0 };
}

export function App() {
  const [mode, setMode] = useState<Mode>("jev");
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [rushHour, setRushHour] = useState(false);
  const [running, setRunning] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const rt = useRef<Runtime>(makeRuntime(mode, seed, rushHour));
  const [view, setView] = useState<View>(() => snapshotView(rt.current));

  const reset = useCallback(
    (m: Mode, s: number, rush: boolean) => {
      rt.current.controller.dispose();
      rt.current = makeRuntime(m, s, rush);
      setView(snapshotView(rt.current));
      setEpoch((e) => e + 1);
    },
    [],
  );

  const changeMode = (m: Mode): void => {
    setMode(m);
    reset(m, seed, rushHour);
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastView = 0;
    const loop = (now: number): void => {
      const r = rt.current;
      const dtReal = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (running) {
        r.acc += dtReal * speed;
        let ticks = 0;
        while (r.acc >= TICK_S && ticks < 8) {
          r.acc -= TICK_S;
          r.sim.step(TICK_S);
          r.controller.tick();
          ticks++;
        }
      }
      if (now - lastView > 200) {
        lastView = now;
        setView(snapshotView(r));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, epoch]);

  const snapshot = useCallback((): ScopeSnapshot => {
    const s = rt.current.sim;
    return { t: s.t, aircraft: s.aircraft, conflicts: s.conflicts };
  }, []);

  const tm = view.telemetry;
  const isNet = mode !== "rules";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-title">JEV TOWER</span>
          <span className="brand-sub">terminal radar · 3 NM / 1000 ft</span>
        </div>
        <div className="modes">
          {(["rules", "jev", "slow"] as Mode[]).map((m) => (
            <button key={m} className={`mode ${m} ${mode === m ? "active" : ""}`} onClick={() => changeMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="controls">
          <button className={`chip ${rushHour ? "on" : ""}`} onClick={() => {
            setRushHour((v) => {
              rt.current.sim.rushHour = !v;
              return !v;
            });
          }}>
            Rush hour {rushHour ? "ON" : "off"}
          </button>
          <button className={`chip ${speed === 4 ? "on" : ""}`} onClick={() => setSpeed(speed === 1 ? 4 : 1)}>
            {speed}×
          </button>
          <button className="chip" onClick={() => setRunning((v) => !v)}>
            {running ? "Pause" : "Run"}
          </button>
          <label className="seed">
            seed
            <input
              type="number"
              value={seed}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                setSeed(v);
                reset(mode, v, rushHour);
              }}
            />
          </label>
          <button className="chip" onClick={() => reset(mode, seed, rushHour)}>
            Reset
          </button>
        </div>
      </header>

      <main className="body">
        <section className="left">
          <Scope snapshot={snapshot} width={720} height={620} />
          <div className="clock">
            <span>T+{fmtClock(view.t)}</span>
            <span>{view.count} aircraft</span>
            <span className={view.conflicts ? "warn" : ""}>{view.conflicts} predicted conflicts</span>
          </div>
        </section>

        <aside className="right">
          <div className="scoreboard">
            <Stat label="Losses of separation" value={view.score.losses} tone={view.score.losses ? "bad" : "good"} big />
            <Stat label="Near misses" value={view.score.nearMisses} tone={view.score.nearMisses ? "bad" : "good"} big />
            <Stat label="Avg delay vs direct" value={`${view.score.avgDelayS >= 0 ? "+" : ""}${view.score.avgDelayS.toFixed(0)} s`} sub={`${view.score.completed} handed off`} />
            <Stat label="Decisions / s" value={view.dps.toFixed(2)} sub={`${view.score.decisions} total · ${view.score.instructions} instr`} />
            <Stat
              label={isNet ? "Latency last / p50 / p95 (ms)" : "Compute last / p50 / p95 (ms)"}
              value={`${fmtMs(tm.latency.last)} / ${fmtMs(tm.latency.p50)} / ${fmtMs(tm.latency.p95)}`}
              tone={isNet && tm.latency.p50 > 1000 ? "bad" : "accent"}
            />
            <Stat
              label="Requests"
              value={isNet ? `${tm.requests}` : "—"}
              sub={isNet ? `${tm.inFlight} in flight · ${tm.stale} stale · ${tm.errors} failed` : "no network in this mode"}
            />
            <Stat
              label="Tokens · est. cost"
              value={isNet ? `${fmtTokens(tm.inputTokens)} in / ${fmtTokens(tm.outputTokens)} out` : "—"}
              sub={isNet ? `$${tm.costUsd.toFixed(5)} at $0.042 / M input · ${tm.model ?? "jev-latest"}` : ""}
            />
            {tm.lastError && <div className="error">last error: {tm.lastError}</div>}
          </div>
          <div className="ticker">
            <div className="ticker-head">INSTRUCTIONS</div>
            <ul>
              {view.ticker
                .slice(-40)
                .reverse()
                .map((e, i) => (
                  <li key={`${e.t}-${e.callsign}-${i}`} className={`${e.kind} ${e.source}`}>
                    <span className="tt">{fmtClock(e.t)}</span>
                    <span className="tc">{e.callsign}</span>
                    <span className="tx">{e.text}</span>
                  </li>
                ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: string | number; sub?: string; tone?: "good" | "bad" | "accent"; big?: boolean }) {
  return (
    <div className={`stat ${big ? "big" : ""} ${tone ?? ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function snapshotView(r: Runtime): View {
  return {
    t: r.sim.t,
    count: r.sim.aircraft.length,
    score: r.sim.scorecard,
    telemetry: r.telemetry,
    dps: decisionsPerSecond(r.telemetry, performance.now()),
    ticker: r.sim.ticker.slice(),
    conflicts: r.sim.conflicts.length,
  };
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtMs(ms: number): string {
  if (ms === 0) return "0";
  if (ms < 1) return `${ms.toFixed(2)}`;
  return `${Math.round(ms)}`;
}

function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
