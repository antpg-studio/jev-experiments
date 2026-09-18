import { useEffect, useRef, useState } from "react";
import type { BenchRow, BenchSummary } from "../shared/types.ts";
import { BENCH_QUERIES } from "../shared/bench-queries.ts";
import { streamBench } from "./api.ts";

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
    setRunning(true);
    stop.current = streamBench({
      onStart: () => {},
      onRow: (i, row, s) => {
        setRows((r) => r.map((x, j) => (j === i ? { row } : x)));
        setSummary(s);
      },
      onError: (i, _q, message) => setRows((r) => r.map((x, j) => (j === i ? { error: message } : x))),
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
          <h2>Live benchmark — {BENCH_QUERIES.length} hand-labelled queries</h2>
          <p>
            Each query: BM25 top-50 → one Jev request (50 × <code>score</code> + 1 × <code>noul</code>). Accuracy = target passage at rank 1 / in top 5. Every number is measured now, in this browser session.
            {mock && <strong className="mockwarn"> MOCK MODE: numbers below are from the offline stub, not Jev.</strong>}
          </p>
        </div>
        <button className="primary" onClick={start} disabled={running}>
          {running ? `Running… ${done}/${BENCH_QUERIES.length} · ${(elapsed / 1000).toFixed(1)} s` : summary ? "Run again" : "Run benchmark"}
        </button>
      </div>

      <Chart summary={summary} />

      <div className="bench-table">
        <div className="brow head">
          <span>#</span><span>query</span><span>BM25 rank</span><span>Jev rank</span><span>Δ</span><span>rerank ms</span><span>exists</span>
        </div>
        {BENCH_QUERIES.map((q, i) => {
          const s = rows[i];
          const r = s.row;
          return (
            <div key={q.query} className={`brow ${r ? (r.jevRank === 1 ? "hit" : r.jevRank && r.jevRank <= 5 ? "near" : "miss") : ""} ${s.error ? "err" : ""}`}>
              <span>{i + 1}</span>
              <span className="q">
                <span>
                  {q.paraphrase && <span className="ptag" title="paraphrase: shares few or no keywords with the target">P</span>} {q.query}
                </span>
                <small>{q.target}</small>
                {s.error && <small className="errtext">{s.error}</small>}
              </span>
              <span className={`rk ${rankTone(r?.bm25Rank)}`}>{r ? r.bm25Rank ?? "–" : ""}</span>
              <span className={`rk ${rankTone(r?.jevRank)}`}>{r ? r.jevRank ?? "–" : ""}</span>
              <span className="delta-cell">{r && r.bm25Rank && r.jevRank ? delta(r.bm25Rank, r.jevRank) : ""}</span>
              <span>{r ? ms(r.jevMs) : running && !s.error ? "…" : ""}</span>
              <span>{r ? pct(r.answerExists) : ""}</span>
            </div>
          );
        })}
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
  if (d === 0) return <span className="delta same">=</span>;
  return d > 0 ? <span className="delta up">▲ {d}</span> : <span className="delta down">▼ {-d}</span>;
}

function Chart({ summary }: { summary: BenchSummary | null }) {
  const s = summary;
  const bars = [
    { label: "top-1", a: s?.bm25Top1 ?? 0, b: s?.jevTop1 ?? 0 },
    { label: "top-5", a: s?.bm25Top5 ?? 0, b: s?.jevTop5 ?? 0 },
    { label: "MRR", a: s?.bm25Mrr ?? 0, b: s?.jevMrr ?? 0 },
  ];
  return (
    <section className="chart">
      <div className="bars">
        {bars.map((b) => (
          <div key={b.label} className="bargroup">
            <div className="barlabel">{b.label}</div>
            <div className="bar"><div className="fill bm25" style={{ width: `${b.a * 100}%` }} /><span>BM25 {s ? pct(b.a) : "—"}</span></div>
            <div className="bar"><div className="fill jev" style={{ width: `${b.b * 100}%` }} /><span>BM25 + Jev {s ? pct(b.b) : "—"}</span></div>
          </div>
        ))}
      </div>
      <div className="kpis">
        <Kpi label="queries done" value={s ? String(s.n) : "—"} />
        <Kpi label="mean rerank" value={s ? ms(s.meanMs) : "—"} accent />
        <Kpi label="p50 / p95" value={s ? `${ms(s.p50Ms)} / ${ms(s.p95Ms)}` : "—"} />
        <Kpi label="max" value={s ? ms(s.maxMs) : "—"} />
        <Kpi label="wall clock" value={s ? `${(s.wallMs / 1000).toFixed(1)} s` : "—"} />
        <Kpi label="candidates judged/s" value={s ? String(Math.round(s.candidatesPerSecond)) : "—"} />
        <Kpi label="target in BM25 top-50" value={s ? pct(s.inTop50) : "—"} />
        <Kpi label="tokens in / out" value={s ? `${s.inputTokens.toLocaleString()} / ${s.outputTokens.toLocaleString()}` : "—"} />
      </div>
      {s && s.n > 0 && (
        <div className="headline">
          50 candidates reranked in ~{ms(s.p50Ms)} (p50); top-1 accuracy <b>{pct(s.bm25Top1)} → {pct(s.jevTop1)}</b>
        </div>
      )}
    </section>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`kpi ${accent ? "accent" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
