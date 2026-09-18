import { useCallback, useEffect, useReducer, useRef, useState, type WheelEvent } from "react";
import type { Config, Disagreement, Incident, Metrics, ServerMessage, Severity } from "../shared/types.ts";
import { initialState, reduce, type Row } from "./lib/store.ts";

const SEV_LABEL: Record<Severity, string> = {
  noise: "noise",
  informational: "info",
  degraded: "degraded",
  "customer-impacting": "cust-impact",
  outage: "OUTAGE",
};

async function post(path: string, body?: unknown): Promise<void> {
  await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => dispatch({ type: "connected", value: true });
    es.onerror = () => dispatch({ type: "connected", value: false });
    es.onmessage = (ev) => dispatch({ type: "message", message: JSON.parse(ev.data) as ServerMessage });
    return () => es.close();
  }, []);

  const setConfig = useCallback((patch: Partial<Config>) => void post("/api/config", patch), []);
  const storm = useCallback(() => void post("/api/storm"), []);

  const { config, metrics, calibration } = state;
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">▣</span>
          <span>LOG SENTINEL</span>
          <span className="sub">every log line judged by Jev, live</span>
        </div>
        {config?.mock && <span className="mock">MOCK MODE — replaying fixture labels, not calling TypeSafe</span>}
        {!config?.mock && config && <span className="live">LIVE · TypeSafe typesafe/jev-1.13</span>}
        <span className={`conn ${state.connected ? "on" : "off"}`}>{state.connected ? "stream connected" : "stream disconnected"}</span>
        {state.error && <span className="err" title={state.error}>{state.error}</span>}
        <div className="spacer" />
        {config && <Controls config={config} setConfig={setConfig} />}
        <button className="storm" onClick={storm} disabled={!calibration?.done}>
          ⚡ Storm
        </button>
      </header>

      {calibration && !calibration.done && (
        <div className="banner">Calibrating batch vs single-request mode against the live API…</div>
      )}

      <main className="panes">
        <Firehose rows={state.rows} />
        <Incidents incidents={state.incidents} storm={state.storm} />
        <MetricsPane metrics={metrics} config={config} calibration={calibration} disagreements={state.disagreements} />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- controls
function Controls({ config, setConfig }: { config: Config; setConfig: (p: Partial<Config>) => void }) {
  const [rate, setRate] = useState(config.rate);
  const [conc, setConc] = useState(config.concurrency);
  useEffect(() => setRate(config.rate), [config.rate]);
  useEffect(() => setConc(config.concurrency), [config.concurrency]);
  return (
    <div className="controls">
      <label>
        rate <b>{rate}</b>/s
        <input type="range" min={5} max={300} step={5} value={rate} onChange={(e) => setRate(Number(e.target.value))} onMouseUp={() => setConfig({ rate })} onTouchEnd={() => setConfig({ rate })} onKeyUp={() => setConfig({ rate })} />
      </label>
      <label>
        concurrency <b>{conc}</b>
        <input type="range" min={1} max={48} step={1} value={conc} onChange={(e) => setConc(Number(e.target.value))} onMouseUp={() => setConfig({ concurrency: conc })} onTouchEnd={() => setConfig({ concurrency: conc })} onKeyUp={() => setConfig({ concurrency: conc })} />
      </label>
      <div className="seg">
        <button className={config.mode === "batch" ? "sel" : ""} onClick={() => setConfig({ mode: "batch" })} title="5–16 events per request; one question set per event">
          batch×{config.batchSize}
        </button>
        <button className={config.mode === "single" ? "sel" : ""} onClick={() => setConfig({ mode: "single" })} title="one request per event">
          single
        </button>
      </div>
      <button onClick={() => setConfig({ paused: !config.paused })}>{config.paused ? "▶ resume" : "❚❚ pause"}</button>
    </div>
  );
}

// ---------------------------------------------------------------- firehose
function Firehose({ rows }: { rows: Row[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [rows, follow]);
  const atBottom = () => {
    const el = ref.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) setFollow(false);
  };
  const onScroll = () => {
    if (atBottom()) setFollow(true);
  };
  return (
    <section className="pane firehose">
      <h2>
        Firehose <span className="dim">raw stream · color = Jev severity</span>
        {!follow && (
          <button className="mini" onClick={() => setFollow(true)}>
            ↓ follow
          </button>
        )}
      </h2>
      <div className="scroll mono" ref={ref} onScroll={onScroll} onWheel={onWheel}>
        {rows.map(({ event, judgment }) => (
          <div key={event.id} className={`line sev-${judgment ? judgment.severity : "pending"} ${judgment?.actionable ? "act" : ""} ${event.storm ? "storm" : ""}`}>
            <span className="svc">{event.service}</span>
            <span className="tag">{judgment ? SEV_LABEL[judgment.severity] : "…"}</span>
            {judgment?.security && <span className="sec">sec</span>}
            <span className="txt">{event.line}</span>
            {judgment && <span className="age">{judgment.ageMs} ms</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- incidents
function fmtTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}
function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

function Incidents({ incidents, storm }: { incidents: Incident[]; storm: { phase: string; at: number }[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const open = incidents.filter((i) => now - i.lastSeen < 60_000);
  const older = incidents.filter((i) => now - i.lastSeen >= 60_000);
  return (
    <section className="pane incidents">
      <h2>
        Incidents <span className="dim">actionable events grouped by service + category (60 s window, in code)</span>
        <span className="count">{open.length} open</span>
      </h2>
      <div className="scroll">
        {storm.length > 0 && (
          <div className="stormlog">
            {storm.map((s, i) => (
              <div key={i} className={s.phase.startsWith("Jev") ? "jev" : s.phase.startsWith("Regex") ? "rx" : s.phase.startsWith("Verdict") ? "verdict" : ""}>
                <span className="t">{fmtTime(s.at)}</span> {s.phase}
              </div>
            ))}
          </div>
        )}
        {incidents.length === 0 && <div className="empty">No actionable events yet — the stream is quiet. Try ⚡ Storm.</div>}
        {open.map((i) => <IncidentCard key={i.key} i={i} now={now} />)}
        {older.length > 0 && <div className="divider">resolved / quiet</div>}
        {older.map((i) => <IncidentCard key={i.key} i={i} now={now} muted />)}
      </div>
    </section>
  );
}

function IncidentCard({ i, now, muted }: { i: Incident; now: number; muted?: boolean }) {
  return (
    <article className={`card sev-${i.severity} ${muted ? "muted" : ""}`}>
      <div className="head">
        <span className="sevpill">{SEV_LABEL[i.severity]}</span>
        <span className="svc">{i.service}</span>
        <span className="cat">{i.category.replace("_", " ")}</span>
        {i.security && <span className="sec">security</span>}
        <span className="spacer" />
        <span className="n">×{i.count}</span>
      </div>
      <div className="sample mono">{i.sample}</div>
      <div className="foot">
        first {fmtTime(i.firstSeen)} · last {fmtTime(i.lastSeen)} ({ago(i.lastSeen, now)})
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- metrics
function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function MetricsPane({
  metrics: m,
  config,
  calibration,
  disagreements,
}: {
  metrics: Metrics | null;
  config: Config | null;
  calibration: { results: { mode: string; batchSize: number; p50: number; eventsPerSecPerSlot: number }[]; chosen: string; done: boolean } | null;
  disagreements: Disagreement[];
}) {
  if (!m) return <section className="pane metrics" />;
  const backlogHot = m.backlog > (config?.batchSize ?? 8) * 2;
  const regexFalse = disagreements.filter((d) => d.kind === "regex_fp" || d.kind === "regex_fn");
  const jevFalse = disagreements.filter((d) => d.kind === "jev_fp" || d.kind === "jev_fn");
  return (
    <section className="pane metrics">
      <h2>
        Live metrics <span className="dim">measured with performance.now() around each request</span>
      </h2>
      <div className="scroll">
        <div className="grid">
          <Stat label="events/s in" value={m.eventsPerSec.toFixed(0)} />
          <Stat label="judgments/s" value={m.judgmentsPerSec.toFixed(0)} />
          <Stat label="in-flight" value={`${m.inFlight}/${config?.concurrency ?? "-"}`} />
          <Stat label="backlog" value={String(m.backlog)} hot={backlogHot} hint={backlogHot ? "raise concurrency" : undefined} />
          <Stat label="p50 latency" value={`${m.p50.toFixed(0)} ms`} />
          <Stat label="p95 latency" value={`${m.p95.toFixed(0)} ms`} />
          <Stat label="p99" value={`${m.p99.toFixed(0)} ms`} small />
          <Stat label="last" value={`${m.lastLatency.toFixed(0)} ms`} small />
          <Stat label="judged" value={m.totalJudged.toLocaleString()} small />
          <Stat label="requests" value={m.totalRequests.toLocaleString()} small />
          <Stat label="elapsed" value={`${(m.elapsedMs / 1000).toFixed(0)} s`} small />
          <Stat label="errors" value={String(m.errors)} small hot={m.errors > 0} />
        </div>

        <h3>Batching</h3>
        <div className="calib">
          {calibration?.results.map((r) => (
            <div key={r.mode} className={r.mode === calibration.chosen ? "chosen" : ""}>
              <span className="mode">{r.mode === "batch" ? `batch ×${r.batchSize}` : "single"}</span>
              <span>p50 {r.p50.toFixed(0)} ms</span>
              <span>{r.eventsPerSecPerSlot.toFixed(1)} ev/s per slot</span>
              {r.mode === calibration.chosen && <span className="pick">✓ kept</span>}
            </div>
          ))}
          {config && (
            <div className="now">
              running: <b>{config.mode === "batch" ? `batch ×${config.batchSize}` : "single"}</b> · concurrency {config.concurrency} ·
              capacity ≈ {config.mode === "batch" && m.p50 ? ((config.concurrency * config.batchSize * 1000) / m.p50).toFixed(0) : m.p50 ? ((config.concurrency * 1000) / m.p50).toFixed(0) : "–"} ev/s
            </div>
          )}
        </div>

        <h3>Regex rules vs Jev</h3>
        <div className="vs">
          <div className="col rx">
            <div className="big">{m.regexPaged}</div>
            <div className="lbl">would have paged with regex severity rules</div>
            <div className="pr">
              precision {pct(m.regex.precision)} · recall {pct(m.regex.recall)}
            </div>
          </div>
          <div className="col jv">
            <div className="big">{m.jevActionable}</div>
            <div className="lbl">Jev says actionable</div>
            <div className="pr">
              precision {pct(m.jev.precision)} · recall {pct(m.jev.recall)}
            </div>
          </div>
        </div>
        <div className="truth">
          fixture ground truth: {m.truthActionable} actionable of {m.totalEvents} events · regex FP {m.regex.fp} / FN {m.regex.fn} · Jev FP {m.jev.fp} / FN {m.jev.fn}
        </div>

        <h3>
          Regex mistakes <span className="dim">latest {regexFalse.length}</span>
        </h3>
        <div className="mistakes mono">
          {regexFalse.slice(0, 40).map((d) => (
            <div key={d.id} className={d.kind}>
              <span className="k">{d.kind === "regex_fp" ? "FALSE PAGE" : "MISSED"}</span>
              <span className="svc">{d.service}</span>
              <span className="txt">{d.line}</span>
            </div>
          ))}
        </div>
        {jevFalse.length > 0 && (
          <>
            <h3>
              Jev mistakes <span className="dim">{jevFalse.length}</span>
            </h3>
            <div className="mistakes mono">
              {jevFalse.slice(0, 20).map((d) => (
                <div key={d.id} className={d.kind}>
                  <span className="k">{d.kind === "jev_fp" ? "FALSE PAGE" : "MISSED"}</span>
                  <span className="svc">{d.service}</span>
                  <span className="txt">{d.line}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hot, hint, small }: { label: string; value: string; hot?: boolean; hint?: string; small?: boolean }) {
  return (
    <div className={`stat ${hot ? "hot" : ""} ${small ? "small" : ""}`}>
      <div className="v">{value}</div>
      <div className="l">
        {label}
        {hint && <span className="hint"> · {hint}</span>}
      </div>
    </div>
  );
}
