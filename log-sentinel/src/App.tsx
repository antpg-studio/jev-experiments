import { useCallback, useEffect, useReducer, useRef, useState, type WheelEvent } from "react";
import type { Calibration, Config, Disagreement, Incident, Metrics, ServerMessage, Severity } from "../shared/types.ts";
import { initialState, reduce, type Row, type StormPhase } from "./lib/store.ts";

const SEV_LABEL: Record<Severity, string> = {
  noise: "Noise",
  informational: "Info",
  degraded: "Degraded",
  "customer-impacting": "Impacting",
  outage: "Outage",
};

async function post(path: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
}

function fmtTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

function summary(line: string): string {
  if (line.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object" && "msg" in value && typeof value.msg === "string") return value.msg;
    } catch {
      return line;
    }
  }
  return line.replace(/^\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z| UTC)?\s*/, "");
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function App() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [controlError, setControlError] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => dispatch({ type: "connected", value: true });
    es.onerror = () => dispatch({ type: "connected", value: false });
    es.onmessage = (ev) => dispatch({ type: "message", message: JSON.parse(ev.data) as ServerMessage });
    return () => es.close();
  }, []);

  const send = useCallback(async (path: string, body?: unknown) => {
    try {
      await post(path, body);
      setControlError(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "Unable to update the stream");
    }
  }, []);
  const setConfig = useCallback((patch: Partial<Config>) => void send("/api/config", patch), [send]);
  const { config, metrics, calibration } = state;

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="26" height="26" rx="6" fill="currentColor" />
            <path d="M7 18V10M12 21V7M17 17V11M22 15V13" stroke="white" strokeWidth="2" />
          </svg>
          Log Sentinel
        </div>
        <span className="header-divider" />
        <span className="workspace-label">Observability</span>
        <div className="spacer" />
        <span className="environment">Synthetic environment</span>
        <span className={`connection ${state.connected ? "connected" : "disconnected"}`}>
          <i /> {state.connected ? "Connected" : "Reconnecting"}
        </span>
      </header>

      <div className="workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">Operations / Live stream</div>
            <h1>Incident monitor</h1>
            <p>Find the signal in every log line.</p>
          </div>
          <div className="heading-actions">
            <span className={`model-label ${config?.mock ? "mock" : ""}`}>
              <i /> {config?.mock ? "Mock · fixture replay" : config ? "Live API · TypeSafe Jev" : "Connecting to API"}
            </span>
            <button className="primary" onClick={() => void send("/api/storm")} disabled={!calibration?.done || !state.connected || config?.paused}>
              <span aria-hidden="true">+</span> Inject storm
            </button>
          </div>
        </div>

        {(state.error || controlError) && <div role="alert" className="error-banner">{controlError || state.error}</div>}
        {calibration && !calibration.done && <div className="banner">Measuring single and batch request performance…</div>}
        <div className="control-bar">
          <div className="source-label"><i /> Seeded log stream <span>7 services</span></div>
          <div className="spacer" />
          {config && <Controls config={config} setConfig={setConfig} />}
        </div>

        <Performance metrics={metrics} config={config} />

        <main className="panes">
          <Firehose rows={state.rows} paused={config?.paused ?? false} />
          <Incidents incidents={state.incidents} storm={state.storm} />
          <Evaluation metrics={metrics} config={config} calibration={calibration} disagreements={state.disagreements} />
        </main>

        <footer className="statusbar">
          <span>Seeded fixtures · No production data</span>
          <span>Latency measured per API request · All times UTC</span>
          <span>{metrics ? `${metrics.totalRequests.toLocaleString()} requests · ${(metrics.elapsedMs / 1000).toFixed(0)}s elapsed` : "Waiting for metrics"}</span>
        </footer>
      </div>
    </div>
  );
}

function Controls({ config, setConfig }: { config: Config; setConfig: (p: Partial<Config>) => void }) {
  const [rate, setRate] = useState(config.rate);
  const [conc, setConc] = useState(config.concurrency);
  useEffect(() => setRate(config.rate), [config.rate]);
  useEffect(() => setConc(config.concurrency), [config.concurrency]);
  return (
    <div className="controls">
      <label>
        Rate <b>{rate}<small>/s</small></b>
        <input aria-label="Event rate" type="range" min={5} max={300} step={5} value={rate}
          onChange={(e) => setRate(Number(e.target.value))} onPointerUp={() => setConfig({ rate })} onKeyUp={() => setConfig({ rate })} />
      </label>
      <label>
        Workers <b>{conc}</b>
        <input aria-label="Concurrency" type="range" min={1} max={48} step={1} value={conc}
          onChange={(e) => setConc(Number(e.target.value))} onPointerUp={() => setConfig({ concurrency: conc })} onKeyUp={() => setConfig({ concurrency: conc })} />
      </label>
      <div className="seg" aria-label="Request mode">
        <button aria-pressed={config.mode === "batch"} onClick={() => setConfig({ mode: "batch" })}>Batch ×{config.batchSize}</button>
        <button aria-pressed={config.mode === "single"} onClick={() => setConfig({ mode: "single" })}>Single</button>
      </div>
      <button className="pause" onClick={() => setConfig({ paused: !config.paused })}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {config.paused ? <path d="M3 1L11 6L3 11Z" fill="currentColor" /> : <path d="M3 1V11M9 1V11" stroke="currentColor" strokeWidth="2" />}
        </svg>
        {config.paused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}

function Performance({ metrics: m, config }: { metrics: Metrics | null; config: Config | null }) {
  return (
    <section className="performance" aria-label="Live performance">
      <div className="metric">
        <span className="metric-label">Judgments / second</span>
        <div className="metric-value">{m ? m.judgmentsPerSec.toFixed(0) : "—"}<span>events/s</span></div>
        <span className="metric-caption">{m ? `${m.eventsPerSec.toFixed(0)} events/s arriving` : "Waiting for stream"}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Median latency <small>p50</small></span>
        <div className="metric-value">{m ? m.p50.toFixed(0) : "—"}<span>ms</span></div>
        <span className="metric-caption">Round-trip per request</span>
      </div>
      <div className="metric">
        <span className="metric-label">Tail latency <small>p95</small></span>
        <div className="metric-value">{m ? m.p95.toFixed(0) : "—"}<span>ms</span></div>
        <span className="metric-caption">{m ? `${m.p99.toFixed(0)} ms at p99` : "Measuring"}</span>
      </div>
      <div className={`metric ${m && m.backlog > (config?.batchSize ?? 8) * 2 ? "warning" : ""}`}>
        <span className="metric-label">Queue depth</span>
        <div className="metric-value">{m ? m.backlog : "—"}<span>events</span></div>
        <span className="metric-caption">{m ? `${m.inFlight} / ${config?.concurrency ?? "—"} workers in flight` : "Waiting for workers"}</span>
      </div>
      <div className="metric">
        <span className="metric-label">Events judged</span>
        <div className="metric-value">{m ? m.totalJudged.toLocaleString() : "—"}</div>
        <span className={`metric-caption ${m && m.errors > 0 ? "error-text" : ""}`}>{m ? `${m.errors} request errors · last ${m.lastLatency.toFixed(0)} ms` : "This session"}</span>
      </div>
    </section>
  );
}

function Firehose({ rows, paused }: { rows: Row[]; paused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [showPending, setShowPending] = useState(false);
  const visibleRows = showPending ? rows : rows.filter((row) => row.judgment);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [rows, follow, showPending]);
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) setFollow(false);
  };
  const onScroll = () => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) setFollow(true);
  };
  return (
    <section className="pane firehose">
      <div className="pane-heading">
        <div><h2>Event stream</h2><p>{showPending ? "Raw logs as they arrive" : "Raw logs after semantic judgment"}</p></div>
        {!follow ? <button className="follow" onClick={() => setFollow(true)}>Follow live ↓</button> : <span className="stream-state"><i />{paused ? "Paused" : "Live"}</span>}
      </div>
      <div className="stream-columns">
        <div className="stream-filter" aria-label="Event visibility">
          <button aria-pressed={!showPending} onClick={() => setShowPending(false)}>Judged</button>
          <button aria-pressed={showPending} onClick={() => setShowPending(true)}>All events</button>
        </div>
        <span>Jev severity</span>
      </div>
      <div className="scroll log-scroll" ref={ref} onScroll={onScroll} onWheel={onWheel} tabIndex={0} aria-label="Live log events">
        {visibleRows.map(({ event, judgment }) => (
          <details key={event.id} className={`log-row sev-${judgment?.severity ?? "pending"} ${event.storm ? "storm-event" : ""}`}
            onToggle={(e) => { if (e.currentTarget.open) setFollow(false); }}>
            <summary>
              <div className="log-meta">
                <time>{fmtTime(event.ts)}</time><span className="log-service">{event.service}</span>
                {event.storm && <span className="storm-marker">storm</span>}
                {judgment?.security && <span className="security-mark">security</span>}
                <span className="severity-label">{judgment ? SEV_LABEL[judgment.severity] : "Pending"}</span>
              </div>
              <div className="log-text">{event.line}</div>
            </summary>
            <pre>{event.line}</pre>
            <div className="log-detail">{event.lines} raw line{event.lines === 1 ? "" : "s"} · {judgment ? `${judgment.ageMs} ms to judgment · ${judgment.actionable ? "Actionable" : "No action needed"}` : "Awaiting judgment"}</div>
          </details>
        ))}
      </div>
      <div className="stream-footer"><span><i /> Severity from Jev, independent of log level</span><span>{rows.length} buffered</span></div>
    </section>
  );
}

function StormTimeline({ phases }: { phases: StormPhase[] }) {
  const jev = phases.find((s) => s.phase.startsWith("Jev"));
  const regex = phases.find((s) => s.phase.startsWith("Regex"));
  const verdict = phases.find((s) => s.phase.startsWith("Verdict"));
  const timing = (phase?: StormPhase) => phase?.phase.match(/\+([\d.]+)s/)?.[1];
  const lead = verdict?.phase.match(/was (-?[\d.]+)s ahead/)?.[1];
  return (
    <div className="storm-panel">
      <div className="storm-title"><span>Storm scenario</span><span>{lead ? `${Number(lead) >= 0 ? "Jev" : "Regex"} detected ${Math.abs(Number(lead)).toFixed(1)}s earlier` : "Detection in progress"}</span></div>
      <h3>Payments provider degradation</h3>
      <p>INFO-level anomalies before the first error.</p>
      <div className="detection">
        <div className={jev ? "detected" : ""}><span><i /> Jev</span><strong>{timing(jev) ? `+${timing(jev)}s` : "Listening"}</strong></div>
        <div><span><i /> Regex rules</span><strong>{timing(regex) ? `+${timing(regex)}s` : "No alert yet"}</strong></div>
      </div>
      <details className="timeline-details">
        <summary>Detection timeline</summary>
        {phases.map((phase, index) => <p key={index}><time>{fmtTime(phase.at)}</time> {phase.phase}</p>)}
      </details>
    </div>
  );
}

function Incidents({ incidents, storm }: { incidents: Incident[]; storm: StormPhase[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const open = incidents.filter((i) => now - i.lastSeen < 60_000);
  const older = incidents.filter((i) => now - i.lastSeen >= 60_000);
  return (
    <section className="pane incidents">
      <div className="pane-heading">
        <div><h2>Incident queue <span className="count">{open.length}</span></h2><p>Grouped by service and category</p></div>
        <span className="window-label">60s window</span>
      </div>
      {storm.length > 0 && <StormTimeline phases={storm} />}
      <div className="scroll incident-scroll" tabIndex={0} aria-label="Incidents">
        {incidents.length === 0 && <div className="empty"><strong>Listening for incidents</strong><p>Actionable events appear here.<br />Inject a storm to see detection in action.</p></div>}
        {open.map((incident) => <IncidentRow key={incident.key} incident={incident} now={now} />)}
        {older.length > 0 && <div className="divider">Quiet for over a minute</div>}
        {older.map((incident) => <IncidentRow key={incident.key} incident={incident} now={now} muted />)}
      </div>
    </section>
  );
}

function IncidentRow({ incident: i, now, muted }: { incident: Incident; now: number; muted?: boolean }) {
  const seconds = Math.max(0, Math.round((now - i.lastSeen) / 1000));
  return (
    <article className={`incident-row sev-${i.severity} ${muted ? "muted" : ""}`}>
      <div className="incident-meta"><span className="severity-label"><i />{SEV_LABEL[i.severity]}</span>{i.security && <span className="security-badge">Security</span>}<span className="last-seen">{seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`}</span></div>
      <div className="incident-title"><h3>{i.service} <span>/ {i.category.replaceAll("_", " ")}</span></h3><span className="event-count">{i.count}<small>events</small></span></div>
      <p className="incident-summary">{summary(i.sample)}</p>
      <div className="incident-foot"><span>First {fmtTime(i.firstSeen)} · Last {fmtTime(i.lastSeen)}</span><details><summary>Raw event</summary><pre>{i.sample}</pre></details></div>
    </article>
  );
}

function Evaluation({ metrics: m, config, calibration, disagreements }: {
  metrics: Metrics | null;
  config: Config | null;
  calibration: Calibration | null;
  disagreements: Disagreement[];
}) {
  const regexFalse = disagreements.filter((d) => d.kind.startsWith("regex"));
  const jevFalse = disagreements.filter((d) => d.kind.startsWith("jev"));
  return (
    <aside className="pane evaluation">
      <div className="pane-heading"><div><h2>Signal quality</h2><p>Against labelled fixture ground truth</p></div></div>
      <div className="scroll evaluation-scroll" tabIndex={0} aria-label="Evaluation and request metrics">
        {m ? <>
          <div className="comparison-title"><h3>Alert precision</h3><span>Higher is better</span></div>
          <div className="precision-row jev-precision"><div><strong>Jev</strong><b>{pct(m.jev.precision)}</b></div><div className="bar"><i style={{ width: pct(m.jev.precision) }} /></div></div>
          <div className="precision-row"><div><span>Regex + severity</span><b>{pct(m.regex.precision)}</b></div><div className="bar"><i style={{ width: pct(m.regex.precision) }} /></div></div>
          <table className="comparison">
            <thead><tr><th scope="col">This stream</th><th scope="col">Regex</th><th scope="col">Jev</th></tr></thead>
            <tbody>
              <tr><th scope="row">Would alert</th><td>{m.regexPaged.toLocaleString()}</td><td>{m.jevActionable.toLocaleString()}</td></tr>
              <tr><th scope="row">False positives</th><td>{m.regex.fp}</td><td>{m.jev.fp}</td></tr>
              <tr><th scope="row">Missed events</th><td>{m.regex.fn}</td><td>{m.jev.fn}</td></tr>
              <tr><th scope="row">Recall</th><td>{pct(m.regex.recall)}</td><td>{pct(m.jev.recall)}</td></tr>
            </tbody>
          </table>
          <p className="truth-note">{m.truthActionable.toLocaleString()} labelled actionable / {m.totalEvents.toLocaleString()} emitted.<br />Jev scores cover completed judgments.</p>
        </> : <p className="empty">Waiting for measured results.</p>}

        <section className="batch-section">
          <div className="comparison-title"><h3>Request strategy</h3><span>{config?.mode === "batch" ? `Batch ×${config.batchSize}` : config?.mode === "single" ? "Single" : "Calibrating"}</span></div>
          <table className="calibration">
            <thead><tr><th scope="col">Calibration</th><th scope="col">p50</th><th scope="col">Events/s/slot</th></tr></thead>
            <tbody>{calibration?.results.map((result) => (
              <tr key={result.mode} className={result.mode === calibration.chosen ? "chosen" : ""}>
                <th scope="row">{result.mode === "batch" ? `Batch ×${result.batchSize}` : "Single"}{result.mode === calibration.chosen && <span className="recommended">Best</span>}</th>
                <td>{result.p50.toFixed(0)} ms</td><td>{result.eventsPerSecPerSlot.toFixed(1)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>

        <section className="disagreements">
          <div className="comparison-title"><h3>Where regex gets it wrong</h3><span>Recent</span></div>
          {regexFalse.length === 0 && <p className="truth-note">No disagreements recorded yet.</p>}
          {regexFalse.slice(0, 20).map((d) => <DisagreementRow key={d.id} item={d} />)}
        </section>
        {jevFalse.length > 0 && <section className="disagreements"><h3>Jev disagreements</h3>{jevFalse.slice(0, 20).map((d) => <DisagreementRow key={d.id} item={d} />)}</section>}
      </div>
    </aside>
  );
}

function DisagreementRow({ item }: { item: Disagreement }) {
  return (
    <details className="disagreement">
      <summary><div><span className={item.kind.endsWith("fp") ? "false-page" : "missed"}>{item.kind.endsWith("fp") ? "False alert" : "Missed"}</span><span>{item.service}</span></div><p>{summary(item.line)}</p></summary>
      <pre>{item.line}</pre>
    </details>
  );
}
