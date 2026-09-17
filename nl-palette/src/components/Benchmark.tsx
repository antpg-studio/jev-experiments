import { useRef, useState } from "react";
import { BENCHMARK_CASES, type BenchmarkCase } from "../data/benchmark.ts";
import { mapWithConcurrency, resolveQuery } from "../lib/jev.ts";
import { COMMANDS, COMMAND_BY_ID } from "../shared/commands.ts";
import { fuzzyRank } from "../shared/fuzzy.ts";
import type { AppState } from "../shared/questions.ts";
import { previewLabel, resolveAnswers } from "../shared/resolve.ts";
import { summarize } from "../shared/stats.ts";

export const CONCURRENCY = 8;

interface Row {
  c: BenchmarkCase;
  jevTop?: string;
  jevLabel?: string;
  jevArg?: string;
  jevOk?: boolean;
  argOk?: boolean;
  confidence?: number;
  clientMs?: number;
  jevMs?: number;
  fuzzyTop?: string;
  fuzzyOk: boolean;
  fuzzyMs: number;
  error?: string;
}

interface Run {
  rows: Row[];
  running: boolean;
  startedAt: number;
  elapsedMs: number;
  mock: boolean;
}

interface Props {
  appState: AppState;
  onClose: () => void;
}

function fuzzyRow(c: BenchmarkCase): Row {
  const t0 = performance.now();
  const top = fuzzyRank(c.query, COMMANDS)[0];
  const fuzzyMs = performance.now() - t0;
  return { c, fuzzyTop: top?.command.id, fuzzyOk: top?.command.id === c.expected, fuzzyMs };
}

export function Benchmark({ appState, onClose }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function start() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const rows = BENCHMARK_CASES.map(fuzzyRow);
    const startedAt = performance.now();
    setRun({ rows, running: true, startedAt, elapsedMs: 0, mock: false });

    const tick = setInterval(() => setRun((r) => (r && r.running ? { ...r, elapsedMs: performance.now() - startedAt } : r)), 50);
    let mock = false;
    await mapWithConcurrency(BENCHMARK_CASES, CONCURRENCY, async (c, i) => {
      let patch: Partial<Row>;
      try {
        const { result, clientMs, jevMs } = await resolveQuery(c.query, appState, controller.signal);
        mock ||= result.mock;
        const res = resolveAnswers(result.answers);
        const top = res.ranked[0];
        patch = {
          jevTop: top?.command.id,
          jevLabel: top ? previewLabel(top) : "—",
          jevArg: top?.arg,
          jevOk: top?.command.id === c.expected,
          argOk: c.expectedArg === undefined ? undefined : top?.arg === c.expectedArg,
          confidence: res.confidence,
          clientMs,
          jevMs,
        };
      } catch (err) {
        if (controller.signal.aborted) return;
        patch = { error: err instanceof Error ? err.message : String(err), jevOk: false };
      }
      setRun((r) => (r ? { ...r, rows: r.rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) } : r));
    });
    clearInterval(tick);
    if (!controller.signal.aborted) setRun((r) => (r ? { ...r, running: false, elapsedMs: performance.now() - startedAt, mock } : r));
  }

  const done = run?.rows.filter((r) => r.jevOk !== undefined) ?? [];
  const jevAcc = done.filter((r) => r.jevOk).length;
  const fuzzyAcc = run?.rows.filter((r) => r.fuzzyOk).length ?? 0;
  const argRows = done.filter((r) => r.argOk !== undefined);
  const argAcc = argRows.filter((r) => r.argOk).length;
  const client = summarize(done.map((r) => r.clientMs ?? 0));
  const jev = summarize(done.map((r) => r.jevMs ?? 0));
  const fuzzy = summarize((run?.rows ?? []).map((r) => r.fuzzyMs));
  const total = run?.elapsedMs ?? 0;
  const perSecond = total > 0 ? done.length / (total / 1000) : 0;
  const n = BENCHMARK_CASES.length;

  return (
    <div className="bench-backdrop" onMouseDown={onClose}>
      <div className="bench" onMouseDown={(e) => e.stopPropagation()}>
        <header className="bench-head">
          <div>
            <h2>Benchmark · {n} natural-language phrasings</h2>
            <p className="muted">
              Each phrasing → one Jev request ({COMMANDS.length} commands + 4 argument slots + destructive check), concurrency {CONCURRENCY}. Same phrasing → fzf-style
              fuzzy match on command titles. Every number is measured in this browser right now.
            </p>
          </div>
          <div className="bench-actions">
            <button className="primary" onClick={start} disabled={run?.running} type="button">
              {run?.running ? "Running…" : run ? "Run again" : "Run benchmark"}
            </button>
            <button onClick={onClose} type="button">
              Close
            </button>
          </div>
        </header>

        <section className="scoreboard">
          <div className="score-card jev">
            <div className="label">Jev · accuracy@1</div>
            <div className="big">
              {run ? `${Math.round((jevAcc / n) * 100)}%` : "—"}
              <small>
                {jevAcc}/{n}
              </small>
            </div>
            <div className="sub">
              args {argRows.length ? `${argAcc}/${argRows.length}` : "—"} · mean <b>{Math.round(client.mean)} ms</b> · p50 {Math.round(client.p50)} · p95 {Math.round(client.p95)}
            </div>
            <div className="sub muted">Jev-side {Math.round(jev.mean)} ms mean · total {(total / 1000).toFixed(2)} s · {perSecond.toFixed(1)} queries/s</div>
          </div>
          <div className="score-card fuzzy">
            <div className="label">Fuzzy · accuracy@1</div>
            <div className="big">
              {run ? `${Math.round((fuzzyAcc / n) * 100)}%` : "—"}
              <small>
                {fuzzyAcc}/{n}
              </small>
            </div>
            <div className="sub">
              mean <b>{fuzzy.mean.toFixed(3)} ms</b> · p95 {fuzzy.p95.toFixed(3)} ms
            </div>
            <div className="sub muted">instant, but only when you already know the command's name</div>
          </div>
          <div className="score-card progress">
            <div className="label">Progress</div>
            <div className="big">
              {done.length}
              <small>/ {n}</small>
            </div>
            <div className="meter">
              <span style={{ width: `${(done.length / n) * 100}%` }} />
            </div>
            <div className="sub muted">{run?.mock ? <em className="mock">MOCK answers (MOCK=1)</em> : run ? "live TypeSafe API · jev-latest" : "press Run"}</div>
          </div>
        </section>

        <div className="bench-table-wrap">
          <table className="bench-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Phrasing</th>
                <th>Expected</th>
                <th>Jev top-1</th>
                <th>conf</th>
                <th>ms</th>
                <th>Fuzzy top-1</th>
              </tr>
            </thead>
            <tbody>
              {(run?.rows ?? BENCHMARK_CASES.map(fuzzyRow)).map((r, i) => (
                <tr key={r.c.query}>
                  <td className="muted">{i + 1}</td>
                  <td className="q">“{r.c.query}”</td>
                  <td className="mono">
                    {COMMAND_BY_ID.get(r.c.expected)?.title}
                    {r.c.expectedArg ? <span className="muted"> · {r.c.expectedArg}</span> : null}
                  </td>
                  <td className={r.jevOk === undefined ? "pending" : r.jevOk && r.argOk !== false ? "ok" : "bad"}>
                    {r.error ? <span className="err">{r.error}</span> : r.jevOk === undefined ? (run?.running ? "…" : "") : r.jevLabel}
                  </td>
                  <td className="muted">{r.confidence !== undefined ? `${Math.round(r.confidence * 100)}%` : ""}</td>
                  <td className="mono">{r.clientMs !== undefined ? Math.round(r.clientMs) : ""}</td>
                  <td className={r.fuzzyOk ? "ok" : "bad"}>{r.fuzzyTop ? COMMAND_BY_ID.get(r.fuzzyTop)?.title : <span className="muted">no match</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
