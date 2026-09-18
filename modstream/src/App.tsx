import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../shared/types.ts";
import {
  CARE_REPLY,
  DEFAULT_THRESHOLDS,
  decide,
  emptyScore,
  isBlocking,
  scoreVerdict,
  type Decision,
  type FilterScore,
  type Thresholds,
} from "../shared/policy.ts";
import { wordListMatch } from "../shared/wordlist.ts";
import { percentile } from "../shared/stats.ts";
import { useStream } from "./useStream.ts";
import { Comparison, Hud } from "./components/Hud.tsx";
import { Icon } from "./components/Icon.tsx";
import { ChatPane } from "./components/ChatPane.tsx";
import { QueuePane } from "./components/QueuePane.tsx";
import { SettingsDrawer } from "./components/SettingsDrawer.tsx";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export type Override = "allow" | "hide" | "handled";

export interface Decided {
  msg: ChatMessage;
  decision: Decision;
  reason: string;
  override: Override | null;
  wordList: string | null;
}

export const DECISIONS: readonly Decision[] = ["allow", "hide", "timeout_user", "care", "review"];

const emptyCounts = (): Record<Decision, number> => ({ allow: 0, hide: 0, timeout_user: 0, care: 0, review: 0 });

function effectiveDecision(msg: ChatMessage, t: Thresholds, override: Override | null) {
  const base = decide(msg.judgment, t);
  if (override === "allow") return { decision: "allow" as Decision, reason: `mod approved (${base.reason})` };
  if (override === "hide") return { decision: "hide" as Decision, reason: `mod rejected (${base.reason})` };
  return base;
}

export default function App() {
  const { state, send, reset } = useStream(WS_URL);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [overrides, setOverrides] = useState<Map<number, Override>>(new Map());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rate, setRate] = useState(12);
  const [concurrency, setConcurrency] = useState(16);
  const [now, setNow] = useState(Date.now());

  // Totals for messages that left the 500-message window, frozen with the thresholds active at eviction.
  const archivedJev = useRef<FilterScore>(emptyScore());
  const archivedCounts = useRef<Record<Decision, number>>(emptyCounts());
  const archivedTruth = useRef<{ harmful: number; selfHarm: number }>({ harmful: 0, selfHarm: 0 });
  const thresholdsRef = useRef(thresholds);
  thresholdsRef.current = thresholds;
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;

  useEffect(() => {
    if (state.evicted.length === 0) return;
    for (const m of state.evicted) {
      const ov = overridesRef.current.get(m.id) ?? null;
      const d = effectiveDecision(m, thresholdsRef.current, ov);
      archivedCounts.current[d.decision]++;
      scoreVerdict(archivedJev.current, m.truth, isBlocking(d.decision));
      if (m.truth === "self_harm") archivedTruth.current.selfHarm++;
    }
    if (overridesRef.current.size > 2000) {
      const keep = new Set(state.messages.map((m) => m.id));
      setOverrides((o) => new Map([...o].filter(([id]) => keep.has(id))));
    }
  }, [state.evicted, state.messages]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (state.server && state.connected) {
      setRate(state.server.rate);
      setConcurrency(state.server.concurrency);
    }
    // only when (re)connecting
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected]);

  // Policy is pure: changing a threshold re-decides all 500 messages here, with no new inference.
  const decided = useMemo<Decided[]>(
    () =>
      state.messages.map((msg) => {
        const override = overrides.get(msg.id) ?? null;
        const { decision, reason } = effectiveDecision(msg, thresholds, override);
        return { msg, decision, reason, override, wordList: wordListMatch(msg.text) };
      }),
    [state.messages, thresholds, overrides],
  );

  const metrics = useMemo(() => {
    const counts = { ...archivedCounts.current };
    const jev: FilterScore = { ...archivedJev.current };
    const wl: FilterScore = { ...state.archivedWordList };
    for (const d of decided) {
      counts[d.decision]++;
      scoreVerdict(jev, d.msg.truth, isBlocking(d.decision));
      scoreVerdict(wl, d.msg.truth, d.wordList !== null);
    }
    const hold = state.holdMs.values();
    const jevMs = state.jevMs.values();
    const nowPerf = performance.now();
    const recent = state.releaseTimes.filter((t) => nowPerf - t <= 3000).length;
    return {
      counts,
      jev,
      wl,
      holdP50: percentile(hold, 50),
      holdP95: percentile(hold, 95),
      jevP50: percentile(jevMs, 50),
      jevP95: percentile(jevMs, 95),
      msgPerSec: recent / 3,
      elapsedMs: state.startedAt ? now - state.startedAt : 0,
      holdSamples: hold,
    };
  }, [decided, state.holdMs, state.jevMs, state.releaseTimes, state.archivedWordList, state.startedAt, now]);

  const reviewQueue = useMemo(() => decided.filter((d) => d.decision === "review" && d.override === null).slice(-40).reverse(), [decided]);
  const careQueue = useMemo(() => decided.filter((d) => d.decision === "care" && d.override !== "handled").slice(-20).reverse(), [decided]);

  const setOverride = useCallback((id: number, ov: Override) => {
    setOverrides((o) => new Map(o).set(id, ov));
  }, []);

  const running = state.server?.running ?? false;
  const customPolicy = Object.entries(DEFAULT_THRESHOLDS).some(([key, value]) => thresholds[key as keyof Thresholds] !== value);
  const toggle = () => send({ type: running ? "stop" : "start" });
  const onRate = (v: number) => {
    setRate(v);
    send({ type: "set_rate", rate: v });
  };
  const onConcurrency = (v: number) => {
    setConcurrency(v);
    send({ type: "set_concurrency", concurrency: v });
  };
  const onReset = () => {
    archivedJev.current = emptyScore();
    archivedCounts.current = emptyCounts();
    archivedTruth.current = { harmful: 0, selfHarm: 0 };
    setOverrides(new Map());
    reset();
  };

  return (
    <div className={`app ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
      <header className="app-header">
        <button className="btn ghost icon-button sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar" aria-expanded={sidebarOpen} aria-controls="workspace-nav">
          <Icon name="sidebar" />
        </button>
        <a className="brand" href="#main">
          <svg className="logo" width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M4 22V6h4l6 9 6-9h4v16h-5V14l-5 7-5-7v8H4Z" fill="currentColor" /></svg>
          ModStream
        </a>
        <span className="header-divider" />
        <span className="header-channel">Speedrun community</span>
        <span className="simulation-label">Demo</span>
        <div className="session-state">
          {state.server?.mock && <span className="mock-badge">Mock mode · canned judgments</span>}
          <span className={`conn ${state.connected ? "on" : "off"}`}>{state.connected ? "Server connected" : "Connecting…"}</span>
          <span className="api-label">{state.server?.mock ? "Offline simulation" : "TypeSafe API"}</span>
        </div>
      </header>
      <aside className="sidebar" id="workspace-nav" aria-label="Workspace" inert={!sidebarOpen}>
        <div className="workspace-label">Workspace</div>
        <a className="nav-active" href="#main" aria-current="page"><Icon name="activity" /> Live moderation</a>
        <button className="nav-button" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen}><Icon name="settings" /> Policy settings</button>
        <div className="channel-context">
          <span className="workspace-label">Your channel</span>
          <div className="channel-card"><span className="channel-avatar">S</span><div><strong>Speedrun</strong><span>Community chat</span></div><span className={`status-dot ${running ? "" : "muted"}`} /></div>
          <span className="participant-note"><Icon name="people" /> 1,000 simulated participants</span>
        </div>
        <div className="sidebar-bottom">
          <div className="pipeline-note">
            <Icon name="shield" />
            <strong>Pre-publish moderation</strong>
            <p>Every message is checked before your community sees it.</p>
          </div>
          <div className="powered-by"><span className="jev-mark">j</span><div>Powered by <strong>Jev</strong><span>Semantic judgments by TypeSafe</span></div></div>
        </div>
      </aside>
      <main className="workspace" id="main">
        <header className="topbar">
          <div className="page-heading">
            <h1>Live moderation</h1>
            <p>Every message checked before it reaches chat.</p>
          </div>
          <div className="primary-controls">
            <button className="btn" onClick={() => send({ type: "raid", count: 150 })} disabled={!state.connected} title="Send 150 spam and harassment messages in 1.5 seconds"><Icon name="raid" /> Simulate raid</button>
            <button className="btn primary" onClick={toggle} disabled={!state.connected}><Icon name={running ? "pause" : "play"} />{running ? "Pause stream" : "Go live"}</button>
          </div>
        </header>
        <div className="stream-toolbar">
          <div className={`stream-status ${running ? "running" : ""}`}><span className="status-dot" />{running ? "Live stream" : "Stream paused"}</div>
          <label className="slider">
            <span>Message rate <b>{rate}<small> / sec</small></b></span>
            <input aria-label="Message rate" type="range" min={5} max={60} step={1} value={rate} onChange={(e) => onRate(Number(e.target.value))} />
          </label>
          <label className="slider small">
            <span>Concurrency <b>{concurrency}</b></span>
            <input aria-label="Concurrency" type="range" min={1} max={48} step={1} value={concurrency} onChange={(e) => onConcurrency(Number(e.target.value))} />
          </label>
          <div className="controls">
            <button className="btn ghost icon-button" onClick={onReset} title="Clear counters and chat" aria-label="Reset counters and chat"><Icon name="reset" /></button>
            <button className="btn ghost" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen}><Icon name="settings" /> Thresholds{customPolicy && <span className="custom-dot" title="Custom policy thresholds" />}</button>
          </div>
        </div>
        <Hud metrics={metrics} server={state.server} totalReleased={state.totalReleased} totalErrors={state.totalErrors} />
        <div className="panes">
          <ChatPane items={decided} />
          <QueuePane review={reviewQueue} care={careQueue} careReply={CARE_REPLY} onOverride={setOverride} />
        </div>
        <Comparison metrics={metrics} customPolicy={customPolicy} />
        <footer className="workspace-footer">
          <span><Icon name="shield" /> {state.server?.mock ? "Mock mode · simulated timings" : "Real API. Real timings. Simulated chat."}</span>
          <span>Fixture comparison excludes care cases</span>
        </footer>
      </main>

      <SettingsDrawer open={drawerOpen} thresholds={thresholds} onChange={setThresholds} onClose={() => setDrawerOpen(false)} windowSize={decided.length} />
    </div>
  );
}
