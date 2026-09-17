import type { Bm25Response, SearchResponse } from "../shared/types.ts";
import { percentile } from "../shared/rerank.ts";
import type { SearchStat } from "./App.tsx";

interface Props {
  result: SearchResponse | null;
  bm25: Bm25Response | null;
  history: SearchStat[];
  pending: boolean;
}

const fmt = (ms: number, digits = 0) => `${ms.toFixed(digits)} ms`;

export function LatencyPanel({ result, bm25, history, pending }: Props) {
  const jev = history.map((h) => h.jevMs);
  const n = result?.results.length ?? 0;
  return (
    <section className="latency">
      <Stat label="BM25 top-50" value={bm25 ? fmt(bm25.bm25Ms, 2) : "—"} sub={bm25 ? `${bm25.corpusSize} passages scanned` : ""} />
      <Stat
        label="Jev rerank"
        value={result ? fmt(result.timing.jevMs) : pending ? "…" : "—"}
        sub={result ? `${n} candidates · ${result.timing.batches} request${result.timing.batches === 1 ? "" : "s"} · ${result.timing.inputTokens.toLocaleString()} tok in` : ""}
        accent
      />
      <Stat label="Total" value={result ? fmt(result.timing.totalMs) : pending ? "…" : "—"} sub="server-side, BM25 + Jev" />
      <Stat
        label="Throughput"
        value={result && result.timing.jevMs > 0 ? `${Math.round((n / result.timing.jevMs) * 1000)} /s` : "—"}
        sub="candidates judged per second"
      />
      <Stat label="Session p50 / p95" value={jev.length ? `${fmt(percentile(jev, 50))} / ${fmt(percentile(jev, 95))}` : "—"} sub={`${jev.length} rerank${jev.length === 1 ? "" : "s"} this session`} />
      <Stat
        label="Answer exists"
        value={result ? `${(result.answerExists * 100).toFixed(0)}%` : "—"}
        sub="noul: answer_exists_in_candidates"
        tone={result ? (result.answerExists >= 0.5 ? "good" : "bad") : undefined}
      />
    </section>
  );
}

function Stat({ label, value, sub, accent, tone }: { label: string; value: string; sub: string; accent?: boolean; tone?: "good" | "bad" }) {
  return (
    <div className={`stat ${accent ? "accent" : ""} ${tone ?? ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
