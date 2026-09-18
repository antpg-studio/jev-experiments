import { useCallback, useEffect, useReducer, useRef } from "react";
import type { HealthResponse, JudgeRequest, MeetingContext, PreviousUtterance } from "./types.ts";
import { resolveJudgment, type Judgment } from "./resolve.ts";
import { addJudgment, emptyAggregate, markShown, recentDecisions, setAssignee, type AggregateState } from "./aggregate.ts";
import { createLimiter } from "./queue.ts";
import { judge, health } from "./client.ts";
import { isKeywordActionItem } from "./keyword.ts";
import { createSegmenter } from "./segment.ts";
import { getSpeechRecognition, type SpeechRecognitionLike } from "./speech.ts";
import { MEETING, TRANSCRIPT, type GroundTruth } from "../data/transcript.ts";

export type Speed = 1 | 4 | "instant";
export type Mode = "replay" | "mic";
export type Phase = "idle" | "running" | "done";

export interface Row {
  id: number;
  speaker: string;
  text: string;
  /** performance.now() when the utterance finished */
  spokenAt: number;
  /** meeting clock (s) when the utterance finished */
  endsAt: number;
  status: "pending" | "done" | "error";
  judgment?: Judgment;
  apiMs?: number;
  clientMs?: number;
  error?: string;
  keywordFlag: boolean;
  truth?: GroundTruth;
}

export interface MeetingState {
  mode: Mode;
  speed: Speed;
  phase: Phase;
  rows: Row[];
  agg: AggregateState;
  /** end-of-utterance → card painted, ms */
  screenLatencies: number[];
  apiLatencies: number[];
  clientLatencies: number[];
  inFlight: number;
  errors: number;
  lastError: string | null;
  wallStart: number | null;
  wallEnd: number | null;
  /** seconds on the meeting clock */
  clock: number;
  health: HealthResponse | null;
  micSupported: boolean;
  micInterim: string;
  micSpeaker: string;
  /** Why the microphone session ended, if it did not end by the user pressing Stop. */
  micError: string | null;
}

type Action =
  | { type: "health"; health: HealthResponse | null }
  | { type: "setMode"; mode: Mode }
  | { type: "setSpeed"; speed: Speed }
  | { type: "setMicSpeaker"; name: string }
  | { type: "start"; wallStart: number }
  | { type: "reset" }
  | { type: "tick"; clock: number }
  | { type: "utterance"; row: Row }
  | { type: "judged"; id: number; judgment: Judgment; apiMs: number; clientMs: number }
  | { type: "failed"; id: number; error: string }
  | { type: "shown"; itemId: number; ms: number }
  | { type: "fixAssignee"; itemId: number; name: string | null }
  | { type: "interim"; text: string }
  | { type: "micError"; error: string }
  | { type: "finish"; wallEnd: number };

export const CONCURRENCY = 12;

const MIC_ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Microphone access was denied. Allow the mic for this site (or use Replay).",
  "service-not-allowed": "Speech recognition is not allowed in this browser context.",
  "audio-capture": "No microphone was found on this device.",
  network: "Speech recognition needs a network connection to the browser's speech service.",
};

const initial = (): MeetingState => ({
  mode: "replay",
  speed: 4,
  phase: "idle",
  rows: [],
  agg: emptyAggregate(),
  screenLatencies: [],
  apiLatencies: [],
  clientLatencies: [],
  inFlight: 0,
  errors: 0,
  lastError: null,
  wallStart: null,
  wallEnd: null,
  clock: 0,
  health: null,
  micSupported: typeof window !== "undefined" && getSpeechRecognition() !== null,
  micInterim: "",
  micSpeaker: "You",
  micError: null,
});

export function reducer(s: MeetingState, a: Action): MeetingState {
  switch (a.type) {
    case "health":
      return { ...s, health: a.health };
    case "setMode":
      return s.phase === "running" ? s : { ...initial(), health: s.health, mode: a.mode, speed: s.speed, micSpeaker: s.micSpeaker };
    case "setSpeed":
      return { ...s, speed: a.speed };
    case "setMicSpeaker":
      return { ...s, micSpeaker: a.name };
    case "start":
      return { ...initial(), health: s.health, mode: s.mode, speed: s.speed, micSpeaker: s.micSpeaker, phase: "running", wallStart: a.wallStart };
    case "reset":
      return { ...initial(), health: s.health, mode: s.mode, speed: s.speed, micSpeaker: s.micSpeaker };
    case "tick":
      return s.clock === a.clock ? s : { ...s, clock: a.clock };
    case "utterance":
      return { ...s, rows: [...s.rows, a.row], inFlight: s.inFlight + 1 };
    case "judged": {
      const row = s.rows.find((r) => r.id === a.id);
      if (!row) return s;
      const { state: agg } = addJudgment(s.agg, a.judgment, row);
      return {
        ...s,
        agg,
        inFlight: s.inFlight - 1,
        apiLatencies: [...s.apiLatencies, a.apiMs],
        clientLatencies: [...s.clientLatencies, a.clientMs],
        rows: s.rows.map((r) => (r.id === a.id ? { ...r, status: "done", judgment: a.judgment, apiMs: a.apiMs, clientMs: a.clientMs } : r)),
      };
    }
    case "failed":
      return {
        ...s,
        inFlight: s.inFlight - 1,
        errors: s.errors + 1,
        lastError: a.error,
        rows: s.rows.map((r) => (r.id === a.id ? { ...r, status: "error", error: a.error } : r)),
      };
    case "shown": {
      const item = s.agg.items.find((x) => x.id === a.itemId);
      if (!item || item.latencyMs !== null) return s;
      return { ...s, agg: markShown(s.agg, a.itemId, a.ms), screenLatencies: [...s.screenLatencies, a.ms] };
    }
    case "fixAssignee":
      return { ...s, agg: setAssignee(s.agg, a.itemId, a.name) };
    case "interim":
      return { ...s, micInterim: a.text };
    case "micError":
      return { ...s, micError: a.error, micInterim: "" };
    case "finish":
      return s.phase === "running" ? { ...s, phase: "done", wallEnd: a.wallEnd, micInterim: "" } : s;
    default:
      return s;
  }
}

export function useMeeting() {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  const limiter = useRef(createLimiter(CONCURRENCY));
  const timers = useRef<number[]>([]);
  const raf = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const recog = useRef<SpeechRecognitionLike | null>(null);
  const nextMicId = useRef(0);
  /** Rows submitted so far, kept in sync synchronously so bursts see the right `previous_3_utterances`. */
  const submitted = useRef<Row[]>([]);

  useEffect(() => {
    health().then((h) => dispatch({ type: "health", health: h }));
  }, []);

  const submit = useCallback((row: Row, ctx: MeetingContext) => {
    dispatch({ type: "utterance", row });
    const previous: PreviousUtterance[] = submitted.current.slice(-3).map((r) => ({ speaker: r.speaker, text: r.text }));
    submitted.current.push(row);
    const req: JudgeRequest = {
      utterance: row.text,
      speaker: row.speaker,
      previous,
      recentDecisions: recentDecisions(stateRef.current.agg.items),
      context: ctx,
    };
    const signal = abort.current?.signal;
    limiter.current
      .run(() => judge(req, signal))
      .then((res) => {
        if (signal?.aborted) return;
        const judgment = resolveJudgment(res.answers, row.text, row.speaker, ctx);
        dispatch({ type: "judged", id: row.id, judgment, apiMs: res.apiMs, clientMs: res.clientMs });
      })
      .catch((e: unknown) => {
        if (signal?.aborted) return;
        dispatch({ type: "failed", id: row.id, error: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  const stopEngines = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    abort.current?.abort();
    abort.current = null;
    if (recog.current) {
      recog.current.onend = null;
      recog.current.onresult = null;
      recog.current.abort();
      recog.current = null;
    }
  }, []);

  const finishWhenDrained = useCallback(() => {
    const check = () => {
      if (stateRef.current.inFlight === 0) dispatch({ type: "finish", wallEnd: performance.now() });
      else timers.current.push(window.setTimeout(check, 50));
    };
    check();
  }, []);

  const startReplay = useCallback(() => {
    stopEngines();
    abort.current = new AbortController();
    limiter.current = createLimiter(CONCURRENCY);
    submitted.current = [];
    const wallStart = performance.now();
    dispatch({ type: "start", wallStart });
    const speed = stateRef.current.speed;
    const factor = speed === "instant" ? 0 : 1000 / speed;
    const total = TRANSCRIPT[TRANSCRIPT.length - 1].endsAt;

    for (const u of TRANSCRIPT) {
      const fire = () => {
        const row: Row = {
          id: u.id,
          speaker: u.speaker,
          text: u.text,
          spokenAt: performance.now(),
          endsAt: u.endsAt,
          status: "pending",
          keywordFlag: isKeywordActionItem(u.text),
          truth: u.truth,
        };
        submit(row, MEETING);
      };
      if (factor === 0) fire();
      else timers.current.push(window.setTimeout(fire, u.endsAt * factor));
    }

    const loop = () => {
      const elapsed = (performance.now() - wallStart) / 1000;
      const clock = factor === 0 ? total : Math.min(total, elapsed * (speed as number));
      dispatch({ type: "tick", clock: Math.floor(clock * 10) / 10 });
      if (clock >= total) {
        raf.current = null;
        finishWhenDrained();
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }, [stopEngines, submit, finishWhenDrained]);

  const stop = useCallback(() => {
    const r = recog.current as (SpeechRecognitionLike & { flush?: () => void }) | null;
    r?.flush?.();
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    if (recog.current) {
      recog.current.onend = null;
      recog.current.onresult = null;
      recog.current.stop();
      recog.current = null;
    }
    finishWhenDrained();
  }, [finishWhenDrained]);

  const startMic = useCallback(() => {
    stopEngines();
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    abort.current = new AbortController();
    limiter.current = createLimiter(CONCURRENCY);
    submitted.current = [];
    const wallStart = performance.now();
    dispatch({ type: "start", wallStart });
    nextMicId.current = 0;
    const seg = createSegmenter();
    const ctx: MeetingContext = { ...MEETING, today: new Date().toISOString().slice(0, 10) };

    const emit = (sentence: string) => {
      const row: Row = {
        id: nextMicId.current++,
        speaker: stateRef.current.micSpeaker || "You",
        text: sentence,
        spokenAt: performance.now(),
        endsAt: (performance.now() - wallStart) / 1000,
        status: "pending",
        keywordFlag: isKeywordActionItem(sentence),
      };
      submit(row, ctx);
    };

    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const text = res[0].transcript;
        if (res.isFinal) for (const s of seg.push(text)) emit(s);
        else interim += text;
      }
      dispatch({ type: "interim", text: `${seg.pending} ${interim}`.trim() });
    };
    r.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      // not-allowed / audio-capture / network / service-not-allowed: nothing to listen to, end the session.
      dispatch({ type: "micError", error: MIC_ERROR_TEXT[ev.error] ?? `Speech recognition error: ${ev.error}` });
      if (recog.current === r) {
        r.onend = null;
        r.onresult = null;
        recog.current = null;
        r.abort();
        stop();
      }
    };
    r.onend = () => {
      // Chrome stops after silence; keep listening while the session is running (never in a tight loop).
      if (recog.current !== r || stateRef.current.phase !== "running") return;
      timers.current.push(
        window.setTimeout(() => {
          if (recog.current === r && stateRef.current.phase === "running") r.start();
        }, 250),
      );
    };
    const tick = () => {
      dispatch({ type: "tick", clock: Math.floor((performance.now() - wallStart) / 100) / 10 });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    recog.current = r;
    r.start();
    (recog.current as SpeechRecognitionLike & { flush?: () => void }).flush = () => {
      for (const s of seg.flush()) emit(s);
    };
  }, [stopEngines, submit, stop]);

  const reset = useCallback(() => {
    stopEngines();
    dispatch({ type: "reset" });
  }, [stopEngines]);

  useEffect(() => stopEngines, [stopEngines]);

  return {
    state,
    start: state.mode === "replay" ? startReplay : startMic,
    stop,
    reset,
    setMode: (mode: Mode) => dispatch({ type: "setMode", mode }),
    setSpeed: (speed: Speed) => dispatch({ type: "setSpeed", speed }),
    setMicSpeaker: (name: string) => dispatch({ type: "setMicSpeaker", name }),
    fixAssignee: (itemId: number, name: string | null) => dispatch({ type: "fixAssignee", itemId, name }),
    shown: (itemId: number, ms: number) => dispatch({ type: "shown", itemId, ms }),
  };
}
