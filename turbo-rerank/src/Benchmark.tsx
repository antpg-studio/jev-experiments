import { useEffect, useRef, useState } from "react";
import type { BenchRow, BenchSummary } from "../shared/types.ts";
import { BENCH_QUERIES } from "../shared/bench-queries.ts";
import { streamBench } from "./api.ts";
import { Icon } from "./Icon.tsx";

interface RowState {
  row?: BenchRow;
  error?: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;

export function Benchmark({ mock }: { mock: boolean }) {
  const [rows, setRows] = useState<RowState[]>(() => BENCH_QUERIES.map(() => ({})));
  const [summary, setSummary] = useState<BenchSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  useEffect(() => {
    if (!running) return;
    const t0 = performance.now();
    const id = setInterval(() => setElapsed(performance.now() - t0), 50);
    return () => clearInterval(id);
  }, [running]);

  const start = () => {
    stop.current?.();
    setRows(BENCH_QUERIES.map(() => ({})));
    setSummary(null);
    setError(null);
    setElapsed(0);
    setRunning(true);
    stop.current = streamBench({
      onStart: () => {},
      onRow: (i, row, s) => {
        setRows((r) => r.map((x, j) => (j === i ? { row } : x)));
        setSummary(s);
      },
      onError: (i, _q, message) => setRows((r) => r.map((x, j) => (j === i ? { error: message } : x))),
      onFailure: (message) => {
        setError(message);
        setRunning(false);
      },
      onDone: (s) => {
        setSummary(s);
        setRunning(false);
      },
    });
  };

  const done = rows.filter((r) => r.row || r.error).length;

  return (
    <main className="bench">
      <div className="bench-head">
        <div>
          <div className="eyebrow"><Icon name="book" size={16} /> Northwind workspace</div>
          <h1>Measure the difference.</h1>
          <p>{BENCH_QUERIES.length} questions. The same documents, ranked two ways. Compare keyword search with Jev using hand-labelled answers and live measurements.</p>
          {mock && <div className="mockwarn" role="status">Mock mode — results use an offline stub, not Jev.</div>}
        </div>
        <button className="primary" onClick={start} disabled={running}>
          {running && <span className="spinner" />}
          {running ? "Running benchmark" : done || error ? "Run again" : "Run benchmark"}
          {!running && <Icon name="chevron" size={14} />}
        </button>
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
      <div className="bench-progress">
        <span role="status">{running ? `Evaluating ${done} of ${BENCH_QUERIES.length} questions · ${(elapsed / 1000).toFixed(1)} s`
          : error ? `Stopped · ${done} of ${BENCH_QUERIES.length} questions finished`
          : done ? `${done} of ${BENCH_QUERIES.length} questions finished${rows.some((r) => r.error) ? ` · ${rows.filter((r) => r.error).length} failed` : ""}`
            : "Ready to run · up to 50 candidates per question"}</span>
        <progress value={done} max={BENCH_QUERIES.length} aria-label="Benchmark progress" />
      </div>
      {summary ? <Chart summary={summary} mock={mock} /> : (
        <section className="bench-empty">
          <h2>{running ? "Measuring relevance and speed…" : "How well does your search understand a question?"}</h2>
          <p>Top-1 checks whether the correct passage comes first. Top-5 checks whether it appears in the first five. Results and timings appear here as each question completes.</p>
        </section>
      )}
      <div className="table-heading">
        <h2>Evaluation set <span> / {BENCH_QUERIES.length} questions</span></h2>
        <span>P = paraphrased question</span>
      </div>
      <div className="table-scroll" role="region" aria-label="Benchmark results" tabIndex={0}>
        <table className="bench-table">
          <caption className="sr-only">Measured ranks of the hand-labelled target passage for each benchmark query</caption>
          <thead><tr>
            <th scope="col">#</th><th scope="col">Question / target passage</th><th scope="col">BM25</th><th scope="col">Jev</th><th scope="col">Change</th><th scope="col">Rerank</th><th scope="col">Answer exists</th>
          </tr></thead>
          <tbody>{BENCH_QUERIES.map((q, i) => {
            const s = rows[i];
            const r = s.row;
            return (
              <tr key={q.query} className={s.error ? "err" : ""}>
                <td>{String(i + 1).padStart(2, "0")}</td>
                <td className="query-cell">
                  <span>
                    {q.query}{q.paraphrase && <abbr className="paraphrase" title="Paraphrase: shares few or no keywords with the target">P</abbr>}
                  </span>
                  <small>{q.target}</small>
                  {s.error && <small className="errtext">{s.error}</small>}
                </td>
                <td className={`rk ${rankTone(r?.bm25Rank)}`}>{r ? r.bm25Rank ?? "–" : "—"}</td>
                <td className={`rk ${rankTone(r?.jevRank)}`}>{r ? r.jevRank ?? "–" : "—"}</td>
                <td>{r && r.bm25Rank && r.jevRank ? delta(r.bm25Rank, r.jevRank) : "—"}</td>
                <td>{r ? ms(r.jevMs) : running && !s.error ? "…" : "—"}</td>
                <td>{r ? pct(r.answerExists) : "—"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </main>
  );
}

function rankTone(r: number | null | undefined) {
  if (r === undefined) return "";
  if (r === null) return "bad";
  if (r === 1) return "good";
  if (r <= 5) return "ok";
  return "bad";
}

function delta(from: number, to: number) {
  const d = from - to;
  if (d === 0) return <span className="delta same">—</span>;
  return d > 0 ? <span className="delta up">↑ {d}</span> : <span className="delta down">↓ {-d}</span>;
}

function Chart({ summary, mock }: { summary: BenchSummary; mock: boolean }) {
  const s = summary;
  const bars = [
    { label: "Top-1", a: s.bm25Top1, b: s.jevTop1 },
    { label: "Top-5", a: s.bm25Top5, b: s.jevTop5 },
    { label: "MRR", a: s.bm25Mrr, b: s.jevMrr },
  ];
  return (
    <section className="chart">
      <div className="bars">
        <div className="accuracy-heading">
          <h2>Retrieval accuracy</h2>
          <div className="chart-legend"><span><i />BM25</span><span><i className="jev" />BM25 + Jev</span></div>
        </div>
        {bars.map((b) => (
          <div key={b.label} className="bargroup">
            <div className="barlabel">{b.label}</div>
            <div className="bar" aria-label={`BM25 ${b.label}: ${pct(b.a)}`}><div className="bar-track"><span className="bar-fill" style={{ width: `${b.a * 100}%` }} /></div><span>{pct(b.a)}</span></div>
            <div className="bar" aria-label={`BM25 plus Jev ${b.label}: ${pct(b.b)}`}><div className="bar-track"><span className="bar-fill jev" style={{ width: `${b.b * 100}%` }} /></div><span>{pct(b.b)}</span></div>
          </div>
        ))}
      </div>
      <dl className="benchmark-metrics">
        <div><dt>Mean rerank</dt><dd>{ms(s.meanMs)}</dd></div>
        <div><dt>p50 / p95</dt><dd>{Math.round(s.p50Ms)} / {Math.round(s.p95Ms)} <span>ms</span></dd></div>
        <div><dt>Wall clock</dt><dd>{(s.wallMs / 1000).toFixed(1)} <span>s</span></dd></div>
        <div><dt>Candidates judged</dt><dd>{Math.round(s.candidatesPerSecond).toLocaleString()} <span>/s</span></dd></div>
        <div className="small"><dt>Max rerank / successful queries</dt><dd>{ms(s.maxMs)} / {s.n}</dd></div>
        <div className="small"><dt>Target in BM25 top-50</dt><dd>{pct(s.inTop50)}</dd></div>
        <div className="small"><dt>Input / output tokens</dt><dd>{s.inputTokens.toLocaleString()} / {s.outputTokens.toLocaleString()}</dd></div>
      </dl>
      {s.n > 0 && (
        <p className="benchmark-headline">
          {mock ? "Mock results" : "Live results"} · top-1 accuracy <strong>{pct(s.bm25Top1)} → {pct(s.jevTop1)}</strong>, with a median rerank of <strong>{ms(s.p50Ms)}</strong>.
        </p>
      )}
    </section>
  );
}
