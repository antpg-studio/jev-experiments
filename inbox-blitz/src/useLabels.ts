import { useCallback, useEffect, useRef, useState } from "react";
import type { LabelStreamEvent, MatchResult } from "./lib/types";
import { LatencyTracker, computeStats } from "./lib/stats";
import { labelName, MAX_INTENT_CHARS, pickColor, type IntentLabel } from "./lib/labels";

const UI_TICK_MS = 50;
const QUESTIONS_PER_LABEL = 1;

/**
 * User-defined labels, each backed by one streamed `/api/label` run that asks
 * Jev a single yes/no question per email. Runs execute one at a time so the
 * on-screen throughput numbers describe a single run.
 */
export function useLabels(total: number) {
  const [labels, setLabels] = useState<IntentLabel[]>([]);
  const queue = useRef<Array<{ id: string; intent: string }>>([]);
  const running = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const created = useRef(0);

  const patch = useCallback((id: string, fn: (l: IntentLabel) => IntentLabel) => {
    setLabels((prev) => prev.map((l) => (l.id === id ? fn(l) : l)));
  }, []);

  const run = useCallback(
    async (id: string, intent: string, concurrency: number) => {
      running.current = id;
      const ac = new AbortController();
      abort.current = ac;
      const tracker = new LatencyTracker(QUESTIONS_PER_LABEL);
      const startedAt = performance.now();
      let finalElapsed: number | null = null;
      patch(id, (l) => ({ ...l, phase: "running" }));

      const ticker = setInterval(() => {
        patch(id, (l) => ({ ...l, stats: tracker.stats(performance.now() - startedAt, total) }));
      }, UI_TICK_MS);

      const finish = (fn: (l: IntentLabel) => IntentLabel) => {
        clearInterval(ticker);
        patch(id, fn);
        running.current = null;
      };

      let res: Response;
      try {
        res = await fetch("/api/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent, concurrency }),
          signal: ac.signal,
        });
      } catch (e) {
        finish((l) => ({ ...l, phase: "error", fatal: `Could not reach the local server: ${e instanceof Error ? e.message : String(e)}` }));
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
        finish((l) => ({ ...l, phase: "error", fatal: msg }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const pending: MatchResult[] = [];
      const pendingErrors: Array<[string, string]> = [];
      let scheduled = false;
      const flush = () => {
        scheduled = false;
        if (!pending.length && !pendingErrors.length) return;
        const batch = pending.splice(0);
        const errs = pendingErrors.splice(0);
        patch(id, (l) => {
          const matches = new Map(l.matches);
          for (const m of batch) matches.set(m.id, m);
          const errors = new Map(l.errors);
          for (const [eid, msg] of errs) errors.set(eid, msg);
          return { ...l, matches, errors };
        });
      };
      const schedule = () => {
        if (!scheduled) {
          scheduled = true;
          setTimeout(flush, UI_TICK_MS);
        }
      };
      const handle = (ev: LabelStreamEvent) => {
        switch (ev.type) {
          case "match": {
            const { type: _t, ...m } = ev;
            void _t;
            tracker.add(m.latencyMs, m.inputTokens);
            pending.push(m);
            schedule();
            break;
          }
          case "error":
            tracker.errors++;
            pendingErrors.push([ev.id, ev.message]);
            schedule();
            break;
          case "done":
            finalElapsed = ev.elapsedMs;
            break;
          case "start":
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
            if (line) handle(JSON.parse(line) as LabelStreamEvent);
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          flush();
          finish((l) => ({ ...l, phase: "error", fatal: e instanceof Error ? e.message : String(e) }));
          return;
        }
      }
      flush();
      const elapsed = finalElapsed ?? performance.now() - startedAt;
      finish((l) => ({ ...l, phase: "done", stats: tracker.stats(elapsed, total) }));
    },
    [patch, total],
  );

  const concurrencyRef = useRef(12);
  const pump = useCallback(() => {
    if (running.current || queue.current.length === 0) return;
    const { id, intent } = queue.current.shift()!;
    void run(id, intent, concurrencyRef.current).then(pump);
  }, [run]);

  // Whenever a run finishes, start the next queued one.
  useEffect(() => {
    if (!running.current) pump();
  }, [labels, pump]);

  const add = useCallback(
    (rawIntent: string, concurrency: number): IntentLabel | null => {
      const intent = rawIntent.trim().replace(/\s+/g, " ").slice(0, MAX_INTENT_CHARS);
      if (!intent) return null;
      concurrencyRef.current = concurrency;
      const id = `L${++created.current}`;
      const label: IntentLabel = {
        id,
        intent,
        name: labelName(intent),
        color: pickColor(created.current - 1),
        phase: "queued",
        matches: new Map(),
        errors: new Map(),
        stats: computeStats([], 0, 0, total, 0, QUESTIONS_PER_LABEL),
      };
      setLabels((prev) => [...prev, label]);
      queue.current.push({ id, intent });
      return label;
    },
    [total],
  );

  const remove = useCallback((id: string) => {
    queue.current = queue.current.filter((q) => q.id !== id);
    if (running.current === id) {
      abort.current?.abort();
      running.current = null;
    }
    setLabels((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const stop = useCallback((id: string) => {
    if (running.current !== id) return;
    abort.current?.abort();
  }, []);

  const active = labels.find((l) => l.phase === "running") ?? null;
  return { labels, add, remove, stop, active };
}
