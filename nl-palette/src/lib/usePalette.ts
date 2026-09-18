import { useCallback, useEffect, useRef, useState } from "react";
import { COMMANDS } from "../shared/commands.ts";
import { fuzzyRank, type FuzzyResult } from "../shared/fuzzy.ts";
import type { AppState } from "../shared/questions.ts";
import { resolveAnswers, type Resolution } from "../shared/resolve.ts";
import { resolveQuery, ResolveError } from "./jev.ts";

export const DEBOUNCE_MS = 100;

export interface PaletteResult {
  query: string;
  jev: Resolution | null;
  fuzzy: FuzzyResult[];
  fuzzyMs: number;
  clientMs: number;
  jevMs: number;
  model: string;
  mock: boolean;
  inputTokens: number;
}

export interface LatencyLog {
  /** Browser-measured ms for each completed Jev call this session. */
  samples: number[];
  cancelled: number;
}

/** Survives palette open/close so the footer shows whole-session numbers. */
const sessionLog: LatencyLog = { samples: [], cancelled: 0 };

interface PaletteState {
  result: PaletteResult | null;
  pending: boolean;
  error: string | null;
}

/**
 * Debounces palette input (~100 ms), fires ONE Jev request per pause, aborts
 * stale in-flight requests, and keeps a per-session latency log.
 */
export function usePalette(query: string, appState: AppState, enabled: boolean) {
  const [state, setState] = useState<PaletteState>({ result: null, pending: false, error: null });
  const [log, setLog] = useState<LatencyLog>(sessionLog);
  const inflight = useRef<AbortController | null>(null);
  const latestQuery = useRef(query);
  latestQuery.current = query;

  const reset = useCallback(() => {
    inflight.current?.abort();
    inflight.current = null;
    setState({ result: null, pending: false, error: null });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    if (!trimmed) {
      inflight.current?.abort();
      inflight.current = null;
      setState({ result: null, pending: false, error: null });
      return;
    }
    const timer = setTimeout(() => {
      if (inflight.current) {
        inflight.current.abort();
        sessionLog.cancelled += 1;
        setLog({ ...sessionLog });
      }
      const controller = new AbortController();
      inflight.current = controller;
      setState((s) => ({ ...s, pending: true }));

      const f0 = performance.now();
      const fuzzy = fuzzyRank(trimmed, COMMANDS);
      const fuzzyMs = performance.now() - f0;

      resolveQuery(trimmed, appState, controller.signal)
        .then(({ result, clientMs, jevMs }) => {
          if (controller.signal.aborted) return;
          inflight.current = null;
          const jev = resolveAnswers(result.answers);
          sessionLog.samples = [...sessionLog.samples, clientMs].slice(-500);
          setLog({ ...sessionLog });
          setState({
            pending: false,
            error: null,
            result: { query: trimmed, jev, fuzzy, fuzzyMs, clientMs, jevMs, model: result.model, mock: result.mock, inputTokens: result.usage.input_tokens },
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          inflight.current = null;
          const message = err instanceof ResolveError ? err.message : err instanceof Error ? err.message : String(err);
          setState({ result: { query: trimmed, jev: null, fuzzy, fuzzyMs, clientMs: 0, jevMs: 0, model: "", mock: false, inputTokens: 0 }, pending: false, error: message });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // appState intentionally read at fire time; a state change while typing does not re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled]);

  return { ...state, log, reset };
}
