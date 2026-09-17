import { useEffect, useRef, useState } from "react";
import { Swarm, type SwarmSettings } from "./swarm.ts";
import { drawWorld, HEURISTIC_COLOR, HUMAN_COLOR, PERSONALITY_COLOR, screenToWorld } from "./render.ts";
import { PERSONALITIES, type StatKey, type Stats } from "./world.ts";

interface Snapshot {
  alive: number;
  total: number;
  decisionsPerSec: number;
  inFlight: number;
  last: number;
  p50: number;
  p95: number;
  requests: number;
  errors: number;
  rateLimited: number;
  stale: number;
  fallbacks: number;
  decisions: number;
  tokensPerMin: number;
  usdPerHour: number;
  totalUsd: number;
  inputTokens: number;
  tokensPerDecision: number;
  elapsed: number;
  stats: Record<StatKey, Stats>;
  humanSize: number;
  humanKills: number;
  humanDeaths: number;
}

function fmtMs(v: number): string {
  return v ? `${Math.round(v)}` : "–";
}

const ROWS: { key: StatKey; label: string; color: string }[] = [
  ...PERSONALITIES.map((p) => ({ key: p as StatKey, label: p, color: PERSONALITY_COLOR[p] })),
  { key: "heuristic", label: "heuristic", color: HEURISTIC_COLOR },
  { key: "human", label: "you", color: HUMAN_COLOR },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swarmRef = useRef<Swarm | null>(null);
  const [settings, setSettings] = useState<SwarmSettings>(() => new Swarm().settings);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [paused, setPaused] = useState(false);
  const [showTargets, setShowTargets] = useState(true);
  const showTargetsRef = useRef(showTargets);
  showTargetsRef.current = showTargets;

  useEffect(() => {
    const swarm = new Swarm();
    swarmRef.current = swarm;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let lastSnap = 0;
    const loop = (now: number) => {
      swarm.frame(now);
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWorld(ctx, swarm.world, rect.width, rect.height, { showTargets: showTargetsRef.current, nowMs: now });
      if (now - lastSnap > 200) {
        lastSnap = now;
        const m = swarm.metrics;
        const human = swarm.human;
        setSnap({
          alive: swarm.world.agents.filter((a) => a.alive && a.controller !== "human").length,
          total: swarm.world.agents.filter((a) => a.controller !== "human").length,
          decisionsPerSec: m.decisionsPerSec(now),
          inFlight: m.inFlight,
          last: m.lastLatency,
          p50: m.percentile(50),
          p95: m.percentile(95),
          requests: m.requests,
          errors: m.errors,
          rateLimited: m.rateLimited,
          stale: m.stale,
          fallbacks: m.fallbacks,
          decisions: m.decisions,
          tokensPerMin: m.tokensPerMin(now),
          usdPerHour: m.usdPerHour(now),
          totalUsd: m.totalUsd(),
          inputTokens: m.inputTokens,
          tokensPerDecision: m.tokensPerDecision(),
          elapsed: swarm.elapsedMs(now) / 1000,
          stats: swarm.world.stats,
          humanSize: human?.size ?? 0,
          humanKills: human?.kills ?? 0,
          humanDeaths: human?.deaths ?? 0,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const update = (patch: Partial<SwarmSettings>, resetWorld: boolean) => {
    const swarm = swarmRef.current;
    if (!swarm) return;
    if (resetWorld) swarm.reset(patch);
    else swarm.settings = { ...swarm.settings, ...patch };
    setSettings({ ...swarm.settings });
  };

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const swarm = swarmRef.current;
    const human = swarm?.human;
    if (!swarm || !human || !canvasRef.current) return;
    human.steerTo = screenToWorld(canvasRef.current, e.clientX, e.clientY);
  };
  const boostHuman = () => {
    const human = swarmRef.current?.human;
    if (human) human.decision = { ...human.decision, boost: true, source: "human" };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        boostHuman();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slow = settings.simulatedDelayMs > 0;
  const s = snap;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="dot" />
          <h1>JEV SWARM</h1>
          <span className="sub">{settings.agentCount} independent Jev policies · one arena · move the mouse, space = boost</span>
        </div>
        <div className="controls">
          <label className="ctl">
            <span>agents {settings.agentCount}</span>
            <input
              type="range"
              min={4}
              max={64}
              step={4}
              value={settings.agentCount}
              onChange={(e) => update({ agentCount: Number(e.target.value) }, true)}
            />
          </label>
          <div className="seg">
            {(["jev", "mixed", "heuristic"] as const).map((p) => (
              <button key={p} className={settings.policy === p ? "on" : ""} onClick={() => update({ policy: p }, true)}>
                {p === "jev" ? "Jev agents" : p === "mixed" ? "Mixed" : "Heuristic bots"}
              </button>
            ))}
          </div>
          <label className="ctl">
            <span>batch</span>
            <select value={settings.agentsPerRequest} onChange={(e) => update({ agentsPerRequest: Number(e.target.value) }, false)}>
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}/req
                </option>
              ))}
            </select>
          </label>
          <label className="ctl">
            <span>tick</span>
            <select value={settings.decisionIntervalMs} onChange={(e) => update({ decisionIntervalMs: Number(e.target.value) }, false)}>
              {[250, 400, 600, 1000].map((n) => (
                <option key={n} value={n}>
                  {n} ms
                </option>
              ))}
            </select>
          </label>
          <button className={`toggle ${slow ? "warn" : ""}`} onClick={() => update({ simulatedDelayMs: slow ? 0 : 2500 }, false)}>
            {slow ? "slow LLM (2.5 s) ON" : "slow LLM (2.5 s)"}
          </button>
          <button className={`toggle ${showTargets ? "on" : ""}`} onClick={() => setShowTargets((v) => !v)}>
            targets
          </button>
          <button
            className="toggle"
            onClick={() => {
              const sw = swarmRef.current;
              if (!sw) return;
              sw.paused = !sw.paused;
              setPaused(sw.paused);
            }}
          >
            {paused ? "resume" : "pause"}
          </button>
          <button className="toggle" onClick={() => update({}, true)}>
            reset
          </button>
        </div>
      </header>

      <main className="body">
        <div className="arena">
          <canvas ref={canvasRef} onPointerMove={onPointer} onPointerDown={boostHuman} />
          <div className="legend">
            {ROWS.map((r) => (
              <span key={r.key}>
                <i style={{ background: r.color, borderRadius: r.key === "heuristic" ? 1 : 99 }} /> {r.label}
              </span>
            ))}
            <span className="hint">dashed ring = decision in flight · flash = fresh Jev answer</span>
          </div>
        </div>

        <aside className="panel">
          <section className="big">
            <div className="stat hero">
              <div className="k">
                {settings.policy === "heuristic" ? "Heuristic decisions / s" : settings.policy === "mixed" ? "Decisions / s (Jev + heuristic)" : "Jev decisions / s"}
              </div>
              <div className="v">{s ? s.decisionsPerSec.toFixed(1) : "–"}</div>
            </div>
            <div className="stat">
              <div className="k">agents alive</div>
              <div className="v">
                {s ? s.alive : "–"}
                <small>/{s ? s.total : "–"}</small>
              </div>
            </div>
            <div className="stat">
              <div className="k">in-flight requests</div>
              <div className="v">{s ? s.inFlight : "–"}</div>
            </div>
          </section>

          <section className="lat">
            <div className="k">round-trip latency · ms</div>
            <div className="row3">
              <div>
                <div className="v">{s ? fmtMs(s.last) : "–"}</div>
                <div className="k">last</div>
              </div>
              <div>
                <div className="v">{s ? fmtMs(s.p50) : "–"}</div>
                <div className="k">p50</div>
              </div>
              <div>
                <div className="v">{s ? fmtMs(s.p95) : "–"}</div>
                <div className="k">p95</div>
              </div>
            </div>
            {slow && <div className="warnline">+2500 ms artificial delay on every answer</div>}
          </section>

          <section className="grid">
            <div>
              <div className="k">tokens / min</div>
              <div className="v2">{s ? Math.round(s.tokensPerMin).toLocaleString() : "–"}</div>
            </div>
            <div>
              <div className="k">est. $ / hour</div>
              <div className="v2">{s ? `$${s.usdPerHour.toFixed(3)}` : "–"}</div>
            </div>
            <div>
              <div className="k">requests</div>
              <div className="v2">{s ? s.requests : "–"}</div>
            </div>
            <div>
              <div className="k">decisions</div>
              <div className="v2">{s ? s.decisions : "–"}</div>
            </div>
            <div>
              <div className="k">stale discarded</div>
              <div className="v2">{s ? s.stale : "–"}</div>
            </div>
            <div>
              <div className="k">fallbacks</div>
              <div className="v2">{s ? s.fallbacks : "–"}</div>
            </div>
            <div>
              <div className="k">tokens / decision</div>
              <div className="v2">{s ? Math.round(s.tokensPerDecision) : "–"}</div>
            </div>
            <div>
              <div className="k">errors · 429</div>
              <div className="v2">
                {s ? s.errors : "–"} · {s ? s.rateLimited : "–"}
              </div>
            </div>
          </section>

          <section className="board">
            <div className="k">leaderboard by personality</div>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>kills</th>
                  <th>deaths</th>
                  <th>pellets</th>
                  <th>win%</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const st = s?.stats[r.key];
                  if (!st) return null;
                  if (r.key === "human" && !settings.human) return null;
                  if (r.key === "heuristic" && settings.policy === "jev") return null;
                  if (PERSONALITIES.includes(r.key as (typeof PERSONALITIES)[number]) && settings.policy === "heuristic") return null;
                  const win = st.kills + st.deaths ? (100 * st.kills) / (st.kills + st.deaths) : 0;
                  return (
                    <tr key={r.key}>
                      <td>
                        <i style={{ background: r.color }} />
                        {r.label}
                      </td>
                      <td>{st.kills}</td>
                      <td>{st.deaths}</td>
                      <td>{st.pellets}</td>
                      <td>{st.kills + st.deaths ? `${win.toFixed(0)}%` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <footer className="foot">
            <span>
              run {s ? Math.floor(s.elapsed / 60) : 0}:{s ? String(Math.floor(s.elapsed % 60)).padStart(2, "0") : "00"}
            </span>
            <span>{s ? s.inputTokens.toLocaleString() : 0} tok · ${s ? s.totalUsd.toFixed(4) : "0"}</span>
            <span>
              you: size {s ? Math.round(s.humanSize) : 0} · {s?.humanKills ?? 0}K/{s?.humanDeaths ?? 0}D
            </span>
          </footer>
        </aside>
      </main>
    </div>
  );
}
