import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Activity, Pause, Play, RotateCcw, Timer } from "lucide-react";
import { SCRIPTS, totalMessages } from "./data/scripts.ts";
import { MACROS, fillMacro, macroById } from "./data/macros.ts";
import { fetchHealth, judgeMessage } from "./lib/api.ts";
import type { Health } from "./lib/api.ts";
import { gateMacro } from "./lib/engine.ts";
import { LLM_BASELINE_MS, initialState, reducer } from "./lib/store.ts";
import type { Chat } from "./lib/store.ts";
import { Queue } from "./components/Queue.tsx";
import { Conversation } from "./components/Conversation.tsx";
import { Copilot } from "./components/Copilot.tsx";
import { MetricsBar } from "./components/MetricsBar.tsx";

const AUTO_SEND_DELAY_MS = 1500;

export default function App() {
  const [state, dispatch] = useReducer(reducer, SCRIPTS, initialState);
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    fetchHealth().then(setHealth);
  }, []);

  /** Tick so the simulated-baseline countdown and elapsed clock repaint while a run is live. */
  const [, setTick] = useState(0);
  useEffect(() => {
    const anyPlaying = state.chats.some((c) => c.playing || c.pending);
    const waitingBaseline =
      state.baseline && state.chats.some((c) => c.judgment && performance.now() - c.judgment.arrivedAt < LLM_BASELINE_MS);
    if (!anyPlaying && !waitingBaseline) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [state.chats, state.baseline]);

  const judge = useCallback(async (chat: Chat, handsFree: boolean) => {
    dispatch({ type: "judging", chatId: chat.id });
    try {
      const { response, panelMs } = await judgeMessage({
        chatId: chat.id,
        messageIndex: chat.messages.length - 1,
        conversation: chat.messages,
        customer: chat.customer,
      });
      const gate = gateMacro(response.answers.best_macro);
      const macro = gate.kind === "auto" ? macroById(gate.macroId) : undefined;
      const draft = macro ? fillMacro(macro, chat.customer.name) : null;
      dispatch({
        type: "judged",
        chatId: chat.id,
        judgment: {
          messageIndex: response.messageIndex,
          answers: response.answers,
          jevMs: response.jevMs,
          panelMs,
          arrivedAt: performance.now(),
          mock: response.mock,
          usage: response.usage,
        },
        draft,
      });
      if (handsFree && draft) {
        const key = `${chat.id}:send`;
        timers.current.set(
          key,
          setTimeout(() => {
            timers.current.delete(key);
            const current = stateRef.current.chats.find((c) => c.id === chat.id);
            const alreadySent = current?.messages.some((m) => m.role === "agent" && m.text === draft);
            if (current?.draftSource === "auto" && current.draft === draft && !alreadySent) {
              dispatch({ type: "agent_message", chatId: chat.id, text: draft });
            }
          }, AUTO_SEND_DELAY_MS),
        );
      }
    } catch (err) {
      dispatch({ type: "judge_failed", chatId: chat.id, error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const deliver = useCallback(
    (chatId: string, handsFree: boolean) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      const script = SCRIPTS.find((s) => s.id === chatId);
      if (!chat || !script) return false;
      const next = script.messages[chat.delivered];
      if (!next) return false;
      dispatch({ type: "customer_message", chatId, text: next.text });
      const updated: Chat = { ...chat, messages: [...chat.messages, { role: "customer", text: next.text }] };
      void judge(updated, handsFree);
      return true;
    },
    [judge],
  );

  const scheduleNext = useCallback(
    (chatId: string) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      const script = SCRIPTS.find((s) => s.id === chatId);
      if (!chat || !script) return;
      const next = script.messages[chat.delivered];
      if (!next) {
        dispatch({ type: "set_playing", chatIds: [chatId], playing: false });
        if (stateRef.current.chats.every((c) => c.id === chatId || !c.playing)) {
          dispatch({ type: "run_ended", at: performance.now() });
        }
        return;
      }
      timers.current.set(
        chatId,
        setTimeout(() => {
          timers.current.delete(chatId);
          if (!stateRef.current.chats.find((c) => c.id === chatId)?.playing) return;
          deliver(chatId, true);
          scheduleNext(chatId);
        }, next.delayMs),
      );
    },
    [deliver],
  );

  const play = useCallback(
    (chatIds: string[]) => {
      if (stateRef.current.runStartedAt === null || stateRef.current.runEndedAt !== null) {
        dispatch({ type: "run_started", at: performance.now() });
      }
      dispatch({ type: "set_playing", chatIds, playing: true });
      for (const id of chatIds) scheduleNext(id);
    },
    [scheduleNext],
  );

  const stop = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    dispatch({ type: "set_playing", chatIds: state.chats.map((c) => c.id), playing: false });
    dispatch({ type: "run_ended", at: performance.now() });
  }, [state.chats]);

  const reset = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    dispatch({ type: "reset", scripts: SCRIPTS });
  }, []);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const active = state.chats.find((c) => c.id === state.activeId) ?? state.chats[0]!;
  const anyPlaying = state.chats.some((c) => c.playing);
  const remaining = state.chats.reduce((n, c) => n + (c.scriptLength - c.delivered), 0);
  const mock = health?.mock === true || state.chats.some((c) => c.judgment?.mock);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Activity size={18} />
          <span>Agent Assist</span>
          <span className="sub">live copilot · 8 concurrent chats · powered by Jev (TypeSafe)</span>
        </div>
        {health === null && <span className="pill warn">proxy offline — run `npm run dev`</span>}
        {health && !health.mock && !health.hasKey && <span className="pill warn">TYPESAFE_API_KEY not set</span>}
        {mock && <span className="pill mock">MOCK MODE — canned answers, not Jev</span>}
        <div className="controls">
          <label className={`toggle ${state.baseline ? "on" : ""}`} title="Grey out the panel for 4 s after each message to simulate a typical LLM copilot. Jev numbers are still real.">
            <input type="checkbox" checked={state.baseline} onChange={() => dispatch({ type: "toggle_baseline" })} />
            <Timer size={14} />
            LLM baseline (simulated {(LLM_BASELINE_MS / 1000).toFixed(0)} s)
          </label>
          {anyPlaying ? (
            <button className="btn" onClick={stop}>
              <Pause size={14} /> Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => play(state.chats.map((c) => c.id))} disabled={remaining === 0}>
              <Play size={14} /> Run all 8 conversations
            </button>
          )}
          <button className="btn" onClick={reset} title="Clear all chats and metrics">
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </header>

      <MetricsBar state={state} total={totalMessages()} />

      <main className="columns">
        <Queue chats={state.chats} activeId={active.id} onSelect={(id) => dispatch({ type: "select", chatId: id })} />
        <Conversation
          chat={active}
          onDraft={(draft) => dispatch({ type: "set_draft", chatId: active.id, draft, source: draft ? "manual" : null })}
          onSend={() => {
            if (active.draft.trim()) dispatch({ type: "agent_message", chatId: active.id, text: active.draft.trim() });
          }}
          onNext={() => deliver(active.id, false)}
          onPlay={() => play([active.id])}
          onPause={() => {
            const t = timers.current.get(active.id);
            if (t) clearTimeout(t);
            timers.current.delete(active.id);
            dispatch({ type: "set_playing", chatIds: [active.id], playing: false });
          }}
        />
        <Copilot
          chat={active}
          baseline={state.baseline}
          macros={MACROS}
          onInsertMacro={(id) => {
            const m = macroById(id);
            if (m) dispatch({ type: "set_draft", chatId: active.id, draft: fillMacro(m, active.customer.name), source: "manual" });
          }}
        />
      </main>
    </div>
  );
}
