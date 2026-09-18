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
import { Hud } from "./components/Hud.tsx";
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
    };
  }, [decided, state.holdMs, state.jevMs, state.releaseTimes, state.archivedWordList, state.startedAt, now]);

  const reviewQueue = useMemo(() => decided.filter((d) => d.decision === "review" && d.override === null).slice(-40).reverse(), [decided]);
  const careQueue = useMemo(() => decided.filter((d) => d.decision === "care" && d.override !== "handled").slice(-20).reverse(), [decided]);

  const setOverride = useCallback((id: number, ov: Override) => {
    setOverrides((o) => new Map(o).set(id, ov));
  }, []);

  const running = state.server?.running ?? false;
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
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <div>
            <h1>ModStream</h1>
            <p>pre-publish chat moderation · every message held, judged by Jev, then released</p>
          </div>
        </div>
        <div className="controls">
          {state.server?.mock && <span className="mock-badge" title="MOCK=1: canned judgments, no TypeSafe calls">MOCK MODE — canned judgments</span>}
          <span className={`conn ${state.connected ? "on" : "off"}`}>{state.connected ? "server connected" : "connecting…"}</span>
          <label className="slider">
            <span>
              rate <b>{rate}</b> msg/s
            </span>
            <input type="range" min={5} max={60} step={1} value={rate} onChange={(e) => onRate(Number(e.target.value))} />
          </label>
          <label className="slider small">
            <span>
              concurrency <b>{concurrency}</b>
            </span>
            <input type="range" min={1} max={48} step={1} value={concurrency} onChange={(e) => onConcurrency(Number(e.target.value))} />
          </label>
          <button className={`btn primary ${running ? "live" : ""}`} onClick={toggle} disabled={!state.connected}>
            {running ? "■ Pause" : "▶ Go live"}
          </button>
          <button className="btn danger" onClick={() => send({ type: "raid", count: 150 })} disabled={!state.connected} title="Dump 150 spam/harassment messages onto the queue in 1.5 s">
            ⚡ Raid
          </button>
          <button className="btn ghost" onClick={onReset} title="Clear counters and chat">
            Reset
          </button>
          <button className="btn ghost" onClick={() => setDrawerOpen((o) => !o)} aria-expanded={drawerOpen}>
            ⚙ Thresholds
          </button>
        </div>
      </header>

      <Hud metrics={metrics} server={state.server} totalReleased={state.totalReleased} totalErrors={state.totalErrors} />

      <main className="panes">
        <ChatPane items={decided} />
        <QueuePane review={reviewQueue} care={careQueue} careReply={CARE_REPLY} onOverride={setOverride} />
      </main>

      <SettingsDrawer open={drawerOpen} thresholds={thresholds} onChange={setThresholds} onClose={() => setDrawerOpen(false)} windowSize={decided.length} />
    </div>
  );
}
