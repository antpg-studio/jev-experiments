import { useCallback, useEffect, useRef, useState } from "react";
import type { JudgmentResult, StreamEvent } from "./lib/types";
import { LatencyTracker, type RunStats, computeStats } from "./lib/stats";

export type Phase = "idle" | "running" | "done" | "error";

export interface RunMeta {
  mock: boolean;
  model: string;
  concurrency: number;
}

/** Results are batched into React state at this cadence so 500 rows don't re-render on every single answer. */
const UI_TICK_MS = 50;
const EMPTY_STATS = computeStats([], 0, 0, 0, 0);

/** Streams NDJSON from the local proxy and folds it into React state. */
export function useTriage(total: number) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<Map<string, JudgmentResult>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [stats, setStats] = useState<RunStats>({ ...EMPTY_STATS, total });
  const [meta, setMeta] = useState<RunMeta | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const tracker = useRef(new LatencyTracker());
  const startedAt = useRef(0);
  const finalElapsed = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Elapsed-time ticker while running.
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setStats(tracker.current.stats(performance.now() - startedAt.current, total)), UI_TICK_MS);
    return () => clearInterval(id);
  }, [phase, total]);

  const reset = useCallback(() => {
    abort.current?.abort();
    tracker.current.reset();
    finalElapsed.current = null;
    setResults(new Map());
    setErrors(new Map());
    setStats({ ...EMPTY_STATS, total });
    setMeta(null);
    setFatal(null);
    setPhase("idle");
  }, [total]);

  const start = useCallback(
    async (concurrency: number) => {
      reset();
      const ac = new AbortController();
      abort.current = ac;
      setPhase("running");
      startedAt.current = performance.now();

      let res: Response;
      try {
        res = await fetch("/api/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concurrency }),
          signal: ac.signal,
        });
      } catch (e) {
        setFatal(`Could not reach the local server: ${e instanceof Error ? e.message : String(e)}`);
        setPhase("error");
        return;
      }
      if (!res.ok || !res.body) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        setFatal(msg);
        setPhase("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const pendingResults: JudgmentResult[] = [];
      const pendingErrors: Array<[string, string]> = [];
      let flushScheduled = false;
      const flush = () => {
        flushScheduled = false;
        if (pendingResults.length) {
          const batch = pendingResults.splice(0);
          setResults((prev) => {
            const next = new Map(prev);
            for (const r of batch) next.set(r.id, r);
            return next;
          });
        }
        if (pendingErrors.length) {
          const batch = pendingErrors.splice(0);
          setErrors((prev) => {
            const next = new Map(prev);
            for (const [id, m] of batch) next.set(id, m);
            return next;
          });
        }
      };
      const schedule = () => {
        if (!flushScheduled) {
          flushScheduled = true;
          setTimeout(flush, UI_TICK_MS);
        }
      };

      const handle = (ev: StreamEvent) => {
        switch (ev.type) {
          case "start":
            setMeta({ mock: ev.mock, model: ev.model, concurrency: ev.concurrency });
            break;
          case "result": {
            const { type: _t, ...r } = ev;
            void _t;
            tracker.current.add(r.latencyMs, r.inputTokens);
            pendingResults.push(r);
            schedule();
            break;
          }
          case "error":
            tracker.current.errors++;
            pendingErrors.push([ev.id, ev.message]);
            schedule();
            break;
          case "done":
            finalElapsed.current = ev.elapsedMs;
            break;
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handle(JSON.parse(line) as StreamEvent);
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          setFatal(e instanceof Error ? e.message : String(e));
          setPhase("error");
          return;
        }
      }
      flush();
      const elapsed = finalElapsed.current ?? performance.now() - startedAt.current;
      setStats(tracker.current.stats(elapsed, total));
      setPhase("done");
    },
    [reset, total],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    setStats(tracker.current.stats(performance.now() - startedAt.current, total));
    setPhase("done");
  }, [total]);

  return { phase, results, errors, stats, meta, fatal, start, stop, reset };
}
