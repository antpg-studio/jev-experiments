import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, Channel, JudgeResponse, Span } from "./lib/types";
import { findSpans } from "./lib/spans";

export const DEBOUNCE_MS = 120;

export interface Sample {
  /** Measured in the browser around fetch(): keystroke pause → answers in hand. */
  clientMs: number;
  /** Measured on the Node proxy around the call to openrouter.ai. */
  apiMs: number;
  judgments: number;
  at: number;
}

export interface GuardState {
  answers: Record<string, Answer>;
  spans: Span[];
  /** The draft and channel the current answers were computed for. */
  judgedDraft: string;
  judgedChannel: string;
  inflight: boolean;
  last: Sample | null;
  samples: Sample[];
  cancelled: number;
  error: string | null;
  mock: boolean;
  model: string;
}

const EMPTY: GuardState = {
  answers: {},
  spans: [],
  judgedDraft: "",
  judgedChannel: "",
  inflight: false,
  last: null,
  samples: [],
  cancelled: 0,
  error: null,
  mock: false,
  model: "",
};

/** Debounced, cancellable live judging. One request per pause; stale in-flight requests are aborted. */
export function useGuard(draft: string, channel: Channel) {
  const [state, setState] = useState<GuardState>(EMPTY);
  const ctrl = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    async (text: string, ch: Channel) => {
      if (ctrl.current) {
        ctrl.current.abort();
        setState((s) => ({ ...s, cancelled: s.cancelled + 1 }));
      }
      const ac = new AbortController();
      ctrl.current = ac;
      const my = ++seq.current;
      const spans = findSpans(text);
      setState((s) => ({ ...s, inflight: true, spans }));
      const t0 = performance.now();
      try {
        const res = await fetch("/api/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: { name: ch.name, audience: ch.audience }, draft: text, spans }),
          signal: ac.signal,
        });
        const clientMs = performance.now() - t0;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as JudgeResponse;
        if (my !== seq.current) return;
        const sample: Sample = { clientMs, apiMs: data.apiMs, judgments: data.questionCount, at: Date.now() };
        setState((s) => ({
          ...s,
          answers: data.answers,
          spans,
          judgedDraft: text,
          judgedChannel: ch.id,
          inflight: false,
          last: sample,
          samples: [...s.samples, sample].slice(-500),
          error: null,
          mock: data.mock,
          model: data.model,
        }));
      } catch (err) {
        if (ac.signal.aborted) return;
        if (my !== seq.current) return;
        setState((s) => ({ ...s, inflight: false, error: err instanceof Error ? err.message : String(err) }));
      } finally {
        if (ctrl.current === ac) ctrl.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (draft.trim().length === 0) {
      ctrl.current?.abort();
      ctrl.current = null;
      seq.current++;
      setState((s) => ({ ...s, answers: {}, spans: [], judgedDraft: "", judgedChannel: "", inflight: false }));
      return;
    }
    timer.current = setTimeout(() => void run(draft, channel), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, channel, run]);

  const reset = useCallback(() => setState((s) => ({ ...EMPTY, mock: s.mock, model: s.model })), []);

  return { ...state, reset };
}
