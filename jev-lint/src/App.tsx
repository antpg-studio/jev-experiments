import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";
import { Editor } from "./Editor.tsx";
import { evaluate, pct } from "./eval.ts";
import { Linter, type ScanResult } from "./linter.ts";
import { KIND_LABEL, SEVERITY_RANK } from "./markers.ts";
import { fmtMs, fmtUsd } from "./metrics.ts";
import { SAMPLES } from "./samples.ts";
import { typeIntoEditor } from "./typer.ts";

type Baseline = "jev" | "heuristic" | "slow";
const SLOW_MS = 3000;

function useLinter(): { linter: Linter; version: number } {
  const ref = useRef<Linter | null>(null);
  if (ref.current === null) ref.current = new Linter(SAMPLES[0].text, SAMPLES[0].language);
  const linter = ref.current;
  const versionRef = useRef(0);
  const subscribe = useCallback(
    (fn: () => void) => {
      const bump = () => {
        versionRef.current++;
        fn();
      };
      const unsub = linter.subscribe(bump);
      const tick = setInterval(bump, 1000); // trailing-window stats decay while idle
      return () => {
        unsub();
        clearInterval(tick);
      };
    },
    [linter],
  );
  const version = useSyncExternalStore(subscribe, () => versionRef.current);
  return { linter, version };
}

export function App() {
  const { linter, version } = useLinter();
  const [sampleId, setSampleId] = useState(SAMPLES[0].id);
  const [docId, setDocId] = useState(`${SAMPLES[0].id}-0`);
  const [reveal, setReveal] = useState(false);
  const [baseline, setBaseline] = useState<Baseline>("jev");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const stopTyping = useRef<(() => void) | null>(null);
  const loads = useRef(0);
  const scans = useRef(0);

  const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];
  const markers = useMemo(() => linter.getMarkers(), [linter, version]); // oxlint-disable-line react-hooks/exhaustive-deps
  const snap = useMemo(() => linter.metrics.snapshot(), [linter, version]); // oxlint-disable-line react-hooks/exhaustive-deps
  const evaluation = useMemo(() => evaluate(markers, sample.planted), [markers, sample]);

  const runScan = useCallback(async () => {
    const id = ++scans.current;
    setScanning(true);
    try {
      const result = await linter.fullScan();
      if (id === scans.current) setScan(result);
    } finally {
      if (id === scans.current) setScanning(false);
    }
  }, [linter]);

  const loadSample = useCallback(
    (id: string) => {
      stopTyping.current?.();
      setTyping(false);
      const s = SAMPLES.find((x) => x.id === id) ?? SAMPLES[0];
      linter.load(s.text, s.language);
      setSampleId(s.id);
      setDocId(`${s.id}-${++loads.current}`);
      setScan(null);
      void runScan();
    },
    [linter, runScan],
  );

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const changeBaseline = useCallback(
    (next: Baseline) => {
      if (next === baseline) return;
      linter.mode = next === "heuristic" ? "heuristic" : "jev";
      linter.simulatedDelayMs = next === "slow" ? SLOW_MS : 0;
      setBaseline(next);
      void runScan();
    },
    [linter, baseline, runScan],
  );

  const onChange = useCallback((text: string) => linter.onChange(text), [linter]);

  const toggleTyping = () => {
    if (typing) {
      stopTyping.current?.();
      setTyping(false);
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    setTyping(true);
    stopTyping.current = typeIntoEditor(view, sample.demo, { onDone: () => setTyping(false) });
  };

  const counts = { error: 0, warning: 0, info: 0 };
  for (const m of markers) counts[m.severity]++;
  const strong = markers.filter((m) => SEVERITY_RANK[m.severity] >= 1);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" />
          <span className="name">jev-lint</span>
          <span className="tag">semantic judgments on every keystroke · jev-latest</span>
        </div>
        <nav className="tabs">
          {SAMPLES.map((s) => (
            <button key={s.id} className={s.id === sampleId ? "tab active" : "tab"} onClick={() => loadSample(s.id)}>
              {s.filename}
            </button>
          ))}
        </nav>
      </header>

      <main className="body">
        <section className="pane">
          <div className="pane-head">
            <span className="file">{sample.filename}</span>
            <span className="lang">{sample.language}</span>
            <span className={`inflight ${snap.inFlight > 0 ? "on" : ""}`}>
              {snap.inFlight > 0 ? `${snap.inFlight} in flight` : "idle"}
            </span>
            <span className="counts">
              <b className="sev-error">{counts.error}</b> errors <b className="sev-warning">{counts.warning}</b> warnings <b className="sev-info">{counts.info}</b> info
            </span>
          </div>
          <Editor docId={docId} language={sample.language} initialText={sample.text} markers={markers} planted={reveal ? sample.planted : null} onChange={onChange} viewRef={viewRef} />
        </section>

        <aside className="side">
          <div className="card actions">
            <button className="btn primary" onClick={() => void runScan()} disabled={scanning}>
              {scanning ? "Scanning…" : "Full-file scan"}
            </button>
            <button className={`btn ${typing ? "danger" : ""}`} onClick={toggleTyping}>
              {typing ? "Stop typing" : "Type it for me"}
            </button>
            <button className={`btn ${reveal ? "on" : ""}`} onClick={() => setReveal((r) => !r)}>
              {reveal ? "Hide planted issues" : "Reveal planted issues"}
            </button>
            <button className="btn ghost" onClick={() => loadSample(sampleId)}>
              Reset file
            </button>
          </div>

          <div className="card">
            <div className="card-title">Baseline</div>
            <div className="seg">
              {(
                [
                  ["jev", "Jev live"],
                  ["heuristic", "Regex only"],
                  ["slow", "LLM +3 s"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={baseline === id ? "active" : ""} onClick={() => changeBaseline(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="hint">
              {baseline === "jev" && "every edit → one fan-out request: 5 Nouls + 1 severity Choice per changed line"}
              {baseline === "heuristic" && "deterministic regex rules only — what the app does when Jev is unreachable"}
              {baseline === "slow" && "same Jev answers, held for 3 s: what a typical generate-and-parse LLM pass feels like"}
            </div>
          </div>

          {scan && (
            <div className="card burst">
              <div className="card-title">Full-file burst</div>
              <div className="big">
                {Math.round(scan.wallMs)}
                <small>ms wall-clock</small>
              </div>
              <div className="row">
                <span>{scan.requests} parallel requests</span>
                <span>{scan.questions} judgments</span>
                <span>{scan.inputTokens.toLocaleString()} tokens</span>
                {scan.failed > 0 && <span className="sev-error">{scan.failed} failed → heuristic</span>}
              </div>
            </div>
          )}

          {reveal && (
            <div className="card eval">
              <div className="card-title">Planted issues · {sample.planted.length} in this file</div>
              <div className="pr">
                <div>
                  <div className="big">{pct(evaluation.precision)}</div>
                  <div className="lbl">precision</div>
                </div>
                <div>
                  <div className="big">{pct(evaluation.recall)}</div>
                  <div className="lbl">recall</div>
                </div>
                <div className="tpfp">
                  <span>
                    <b>{evaluation.tp}</b> hit
                  </span>
                  <span>
                    <b>{evaluation.fn}</b> missed
                  </span>
                  <span>
                    <b>{evaluation.fp}</b> extra
                  </span>
                  <span>
                    <b>{evaluation.kindMatches}</b> kind ok
                  </span>
                </div>
              </div>
              <ul className="planted">
                {sample.planted.map((p) => {
                  const hit = evaluation.flaggedLines.includes(p.line);
                  return (
                    <li key={`${p.line}-${p.kind}`} className={hit ? "hit" : "miss"}>
                      <span className="ln">L{p.line}</span>
                      <span className="k">{KIND_LABEL[p.kind]}</span>
                      <span className="n">{p.note}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="hint">warning/error markers count as flags; info does not. Lines are matched exactly.</div>
            </div>
          )}

          <div className="card findings">
            <div className="card-title">Findings · {strong.length}</div>
            <ul>
              {strong.map((m) => (
                <li key={m.line}>
                  <span className={`dot sev-${m.severity}`} />
                  <span className="ln">L{m.line}</span>
                  <span className="msg">{m.message}</span>
                  {m.source === "heuristic" && <span className="src">regex</span>}
                </li>
              ))}
              {strong.length === 0 && <li className="empty">no warnings or errors</li>}
            </ul>
          </div>

          <div className="card log">
            <div className="card-title">Requests</div>
            <ul>
              {linter.log.slice(0, 8).map((e) => (
                <li key={e.seq} className={e.status}>
                  <span className="seq">#{e.seq}</span>
                  <span className="ms">{Math.round(e.ms)} ms</span>
                  <span className="lines">L{e.lines[0]}{e.lines.length > 1 ? `–${e.lines[e.lines.length - 1]}` : ""}</span>
                  <span className="st">{e.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>

      <footer className="status">
        <Stat label="last" value={fmtMs(snap.lastMs)} unit="ms" hot={snap.lastMs !== null && snap.lastMs < 250} />
        <Stat label="p50" value={fmtMs(snap.p50)} unit="ms" />
        <Stat label="p95" value={fmtMs(snap.p95)} unit="ms" />
        <Stat label="decisions" value={snap.decisionsPerSec.toFixed(1)} unit="/s" />
        <Stat label="judgments" value={snap.judgmentsPerMin.toLocaleString()} unit="/min" />
        <Stat label="requests" value={snap.requests.toLocaleString()} unit={snap.failures > 0 ? `${snap.failures} failed` : ""} />
        <Stat label="tokens in" value={snap.inputTokens.toLocaleString()} unit={snap.tokensPerJudgment === null ? "" : `${Math.round(snap.tokensPerJudgment)}/judgment`} />
        <Stat label="spent" value={fmtUsd(snap.costUsd)} unit="" />
        <Stat label="typing cost" value={fmtUsd(snap.costPerHourUsd)} unit="/hour" />
        <span className="pricing">priced at $42 per 1B input tokens · output free</span>
      </footer>
    </div>
  );
}

function Stat({ label, value, unit, hot }: { label: string; value: string; unit: string; hot?: boolean }) {
  return (
    <div className={`stat ${hot ? "hot" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {unit && <span className="stat-unit">{unit}</span>}
    </div>
  );
}
