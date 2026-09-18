import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG_SIZE, generateCatalog, type Product } from "./catalog.ts";
import { rerank } from "./client.ts";
import { estimateCostUsd, heuristicQueryJudgment, MODEL, RELEVANCE_LEVELS, type ParsedAnswers } from "./jev.ts";
import { combine, DEFAULT_WEIGHTS, lexicalOnly, type RankedItem, type Ranking, type Weights } from "./rank.ts";
import { createIndex, search, TOP_K, type LexicalHit } from "./retriever.ts";
import { InFlightLimiter, LatencyStats, SequenceGate } from "./sequence.ts";
import { EXAMPLES } from "./examples.ts";

type Mode = "jev" | "heuristic" | "slow";
const SLOW_LLM_MS = 2500;
const DECISIONS_PER_REQUEST = TOP_K + 5;
const SHOW = 8;
const MAX_IN_FLIGHT = 4;

interface Painted {
  seq: number;
  query: string;
  hits: LexicalHit[];
  answers: ParsedAnswers;
  source: "jev" | "fallback" | "heuristic";
}

interface Metrics {
  retrieverMs: number;
  jevLast: number;
  jevP50: number;
  jevP95: number;
  paintLast: number;
  paintP50: number;
  requests: number;
  inFlight: number;
  discarded: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  keystrokes: number;
  model: string;
}

const EMPTY_METRICS: Metrics = {
  retrieverMs: 0, jevLast: 0, jevP50: 0, jevP95: 0, paintLast: 0, paintP50: 0,
  requests: 0, inFlight: 0, discarded: 0, errors: 0, inputTokens: 0, outputTokens: 0, keystrokes: 0, model: MODEL,
};

function heuristicAnswers(query: string): ParsedAnswers {
  return { relevance: new Map(), query: heuristicQueryJudgment(query), model: "heuristic", inputTokens: 0, outputTokens: 0 };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function App() {
  const catalog = useMemo(() => generateCatalog(), []);
  const index = useMemo(() => createIndex(catalog), [catalog]);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("jev");
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [hits, setHits] = useState<LexicalHit[]>([]);
  const [painted, setPainted] = useState<Painted | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [latestSeq, setLatestSeq] = useState(-1);

  const gate = useRef(new SequenceGate());
  const limiter = useRef(new InFlightLimiter(MAX_IN_FLIGHT));
  const jevStats = useRef(new LatencyStats());
  const paintStats = useRef(new LatencyStats());
  const counters = useRef({ requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, keystrokes: 0, model: MODEL, retrieverMs: 0 });
  const typer = useRef<number | null>(null);

  const publish = useCallback(() => {
    const c = counters.current;
    setMetrics({
      retrieverMs: c.retrieverMs,
      jevLast: jevStats.current.last, jevP50: jevStats.current.p50, jevP95: jevStats.current.p95,
      paintLast: paintStats.current.last, paintP50: paintStats.current.p50,
      requests: c.requests, inFlight: limiter.current.inFlight,
      discarded: gate.current.discardedCount + limiter.current.supersededCount, errors: c.errors,
      inputTokens: c.inputTokens, outputTokens: c.outputTokens, keystrokes: c.keystrokes, model: c.model,
    });
  }, []);

  useEffect(() => {
    const seq = gate.current.issue();
    setLatestSeq(seq);
    const t0 = performance.now();
    const found = search(index, byId, query);
    counters.current.retrieverMs = performance.now() - t0;
    counters.current.keystrokes++;
    setHits(found);
    if (!query.trim() || found.length === 0) {
      gate.current.accept(seq);
      setPainted(null);
      publish();
      return;
    }
    const finish = (answers: ParsedAnswers, source: Painted["source"]) => {
      if (!gate.current.accept(seq)) return publish();
      setPainted({ seq, query, hits: found, answers, source });
      requestAnimationFrame(() => {
        paintStats.current.push(performance.now() - t0);
        publish();
      });
    };
    if (mode === "heuristic") {
      finish(heuristicAnswers(query), "heuristic");
      return;
    }
    const start = () => {
      if (gate.current.isStale(seq)) return false;
      counters.current.requests++;
      rerank(query, found.map((h) => h.product))
        .then(async (r) => {
          counters.current.inputTokens += r.answers.inputTokens;
          counters.current.outputTokens += r.answers.outputTokens;
          counters.current.model = r.answers.model;
          jevStats.current.push(r.ms);
          limiter.current.done();
          if (mode === "slow") await sleep(SLOW_LLM_MS);
          finish(r.answers, "jev");
        })
        .catch(() => {
          counters.current.errors++;
          limiter.current.done();
          finish(heuristicAnswers(query), "fallback");
        });
      return true;
    };
    limiter.current.run(start);
    publish();
  }, [query, mode, index, byId, publish]);

  const left = useMemo<Ranking>(() => lexicalOnly(hits), [hits]);
  const right = useMemo<Ranking | null>(() => (painted ? combine(painted.hits, painted.answers, weights) : null), [painted, weights]);
  const leftPos = useMemo(() => new Map(left.items.map((it, i) => [it.product.id, i])), [left]);
  const pending = painted ? painted.seq < latestSeq : latestSeq >= 0 && query.trim().length > 0;

  const typeExample = (text: string) => {
    if (typer.current) window.clearInterval(typer.current);
    setQuery("");
    let i = 0;
    typer.current = window.setInterval(() => {
      i++;
      setQuery(text.slice(0, i));
      if (i >= text.length && typer.current) {
        window.clearInterval(typer.current);
        typer.current = null;
      }
    }, 70);
  };

  const avgTokens = metrics.requests ? metrics.inputTokens / metrics.requests : 0;
  const costPer1k = estimateCostUsd(avgTokens) * 1000;
  const decisionsPerSec = metrics.jevP50 ? DECISIONS_PER_REQUEST / (metrics.jevP50 / 1000) : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="dot" /> jev-instant-search
          <span className="sub">{CATALOG_SIZE.toLocaleString()} products · MiniSearch top-{TOP_K} · {metrics.model}</span>
        </div>
        <div className="modes">
          {(["jev", "heuristic", "slow"] as Mode[]).map((m) => (
            <button key={m} className={m === mode ? "on" : ""} onClick={() => setMode(m)}>
              {m === "jev" ? "Lexical + Jev" : m === "heuristic" ? "Baseline: heuristics only" : `Baseline: simulated ${SLOW_LLM_MS / 1000}s LLM`}
            </button>
          ))}
        </div>
      </header>

      <section className="searchbar">
        <input
          autoFocus
          value={query}
          placeholder="Type to search… every keystroke re-ranks 30 candidates with Jev"
          onChange={(e) => {
            if (typer.current) window.clearInterval(typer.current);
            typer.current = null;
            setQuery(e.target.value);
          }}
        />
        <span className={`status ${pending ? "pending" : "fresh"}`}>{pending ? `seq ${latestSeq} in flight` : painted ? `seq ${painted.seq} painted` : "idle"}</span>
      </section>

      <section className="chips">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => typeExample(e)}>{e}</button>
        ))}
      </section>

      <section className="metrics">
        <Metric label="retriever" value={fmt(metrics.retrieverMs)} unit="ms" />
        <Metric label="jev last" value={fmt(metrics.jevLast)} unit="ms" hot />
        <Metric label="jev p50" value={fmt(metrics.jevP50)} unit="ms" />
        <Metric label="jev p95" value={fmt(metrics.jevP95)} unit="ms" />
        <Metric label="to paint" value={fmt(metrics.paintLast)} unit="ms" hot />
        <Metric label="decisions/s" value={decisionsPerSec ? Math.round(decisionsPerSec).toString() : "–"} unit="" />
        <Metric label="requests" value={`${metrics.requests}`} unit={metrics.inFlight ? `${metrics.inFlight} live` : ""} />
        <Metric label="stale / skipped" value={`${metrics.discarded}`} unit={metrics.errors ? `${metrics.errors} err` : ""} />
        <Metric label="tokens in" value={metrics.inputTokens.toLocaleString()} unit={avgTokens ? `${Math.round(avgTokens)}/req` : ""} />
        <Metric label="cost / 1k searches" value={costPer1k ? `$${costPer1k.toFixed(3)}` : "–"} unit="" />
      </section>

      <section className="columns">
        <Column title="Lexical only" subtitle="MiniSearch BM25-style, prefix + fuzzy" items={left.items.slice(0, SHOW)} leftPos={null} />
        <Column
          title={mode === "heuristic" ? "Lexical + heuristics" : "Lexical + Jev"}
          subtitle={right ? judgmentLine(painted!, right) : "waiting for first keystroke"}
          items={right ? right.items.slice(0, SHOW) : []}
          leftPos={leftPos}
          stale={pending}
        />
      </section>

      <section className="sliders">
        <Slider label="lexical" v={weights.lexical} min={0} max={1} step={0.05} on={(v) => setWeights({ ...weights, lexical: v })} />
        <Slider label="relevance" v={weights.relevance} min={0} max={2} step={0.05} on={(v) => setWeights({ ...weights, relevance: v })} />
        <Slider label="category" v={weights.category} min={0} max={1} step={0.05} on={(v) => setWeights({ ...weights, category: v })} />
        <Slider label="price pref" v={weights.price} min={0} max={1} step={0.05} on={(v) => setWeights({ ...weights, price: v })} />
        <Slider label="gift" v={weights.gift} min={0} max={1} step={0.05} on={(v) => setWeights({ ...weights, gift: v })} />
        <Slider label="rel. floor" v={weights.relevanceFloor} min={0} max={4} step={0.5} on={(v) => setWeights({ ...weights, relevanceFloor: v })} />
        <label className="toggle">
          <input type="checkbox" checked={weights.applySort} onChange={(e) => setWeights({ ...weights, applySort: e.target.checked })} /> apply inferred sort
        </label>
        <button className="reset" onClick={() => setWeights(DEFAULT_WEIGHTS)}>reset</button>
        <span className="hint">sliders re-rank locally, no new requests</span>
      </section>
    </div>
  );
}

function judgmentLine(p: Painted, r: Ranking): string {
  const q = p.answers.query;
  const parts = [
    `intent ${q.intent} ${pct(q.intentConfidence)}`,
    `cheap ${pct(q.wantsCheap)}`,
    `premium ${pct(q.wantsPremium)}`,
    `gift ${pct(q.isGift)}`,
    `sort ${q.sort} ${pct(q.sortConfidence)}${r.appliedSort !== "relevance" ? " ✓" : ""}`,
  ];
  if (p.source !== "jev") parts.unshift(p.source === "fallback" ? "FALLBACK (request failed)" : "HEURISTIC");
  return parts.join(" · ");
}

function Metric({ label, value, unit, hot }: { label: string; value: string; unit: string; hot?: boolean }) {
  return (
    <div className={`metric ${hot ? "hot" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}<span className="unit">{unit}</span></div>
    </div>
  );
}

function Column({ title, subtitle, items, leftPos, stale }: { title: string; subtitle: string; items: RankedItem[]; leftPos: Map<string, number> | null; stale?: boolean }) {
  return (
    <div className={`column ${stale ? "stale" : ""}`}>
      <div className="colhead">
        <h2>{title}</h2>
        <div className="colsub">{subtitle}</div>
      </div>
      <ol>
        {items.map((it, i) => (
          <Row key={it.product.id} item={it} rank={i} from={leftPos ? leftPos.get(it.product.id) ?? null : null} />
        ))}
      </ol>
    </div>
  );
}

function Row({ item, rank, from }: { item: RankedItem; rank: number; from: number | null }) {
  const p: Product = item.product;
  const delta = from === null ? null : from - rank;
  return (
    <li className={item.belowFloor ? "floor" : ""}>
      <div className="rank">{rank + 1}</div>
      <div className="body">
        <div className="title">
          {p.title}
          {delta !== null && delta !== 0 && <span className={`delta ${delta > 0 ? "up" : "down"}`}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}
          {delta === null || delta === 0 ? null : from !== null && from >= SHOW ? <span className="delta new">was #{from + 1}</span> : null}
        </div>
        <div className="meta">
          <span className={`cat ${p.category}`}>{p.category}</span>
          <span>${p.price.toFixed(2)}</span>
          <span>★ {p.rating.toFixed(1)}</span>
          <span className="lex">lex {item.lexNorm.toFixed(2)}</span>
        </div>
        <div className="desc">{p.description}</div>
      </div>
      <div className="scores">
        {item.relevance ? (
          <>
            <div className="scorenum">{item.relevance.score.toFixed(2)}</div>
            <div className="bars" title={item.relevance.probabilities.map((v, i) => `${RELEVANCE_LEVELS[i]}: ${pct(v)}`).join("\n")}>
              {item.relevance.probabilities.map((v, i) => (
                <span key={i} className={`seg l${i}`} style={{ width: `${Math.max(2, v * 100)}%` }} />
              ))}
            </div>
          </>
        ) : (
          <div className="scorenum dim">{item.lexNorm.toFixed(2)}</div>
        )}
      </div>
    </li>
  );
}

function Slider({ label, v, min, max, step, on }: { label: string; v: number; min: number; max: number; step: number; on: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
      <b>{v.toFixed(2)}</b>
    </label>
  );
}

const fmt = (ms: number) => (ms >= 100 ? Math.round(ms).toString() : ms.toFixed(1));
const pct = (v: number) => `${Math.round(v * 100)}%`;
