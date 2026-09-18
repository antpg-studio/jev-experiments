import type { Bm25Response, SearchResponse } from "../shared/types.ts";
import { percentile } from "../shared/rerank.ts";
import type { SearchStat } from "./App.tsx";
import { Icon } from "./Icon.tsx";

interface Props {
  result: SearchResponse | null;
  bm25: Bm25Response | null;
  history: SearchStat[];
  pending: boolean;
}

export function LatencyPanel({ result, bm25, history, pending }: Props) {
  const latencies = history.map((h) => h.jevMs);
  if (!bm25) return null;
  return (
    <section className="measurement" aria-label="Measured search performance">
      <div className="measurement-row">
        <div className="measurement-lead">
          <strong>{result ? Math.round(result.timing.jevMs) : "—"}<span> ms</span></strong>
          <span>{pending ? "Reranking" : "Jev rerank"}{result?.mock ? " · mock" : ""}</span>
        </div>
        <dl className="measurement-stats">
          <div><dt>Candidates</dt><dd>{bm25.results.length}</dd></div>
          <div><dt>BM25</dt><dd>{bm25.bm25Ms.toFixed(2)} <span>ms</span></dd></div>
          <div><dt>Throughput</dt><dd>{result && result.timing.jevMs > 0 ? Math.round(result.results.length / result.timing.jevMs * 1000) : "—"} <span>/s</span></dd></div>
          <div><dt>Session p50 / p95</dt><dd>{latencies.length ? `${Math.round(percentile(latencies, 50))} / ${Math.round(percentile(latencies, 95))}` : "—"} <span>ms</span></dd></div>
        </dl>
      </div>
      <details className="timing-details">
        <summary>Request details <Icon name="chevron" size={12} /></summary>
        <p>{result
          ? `${result.timing.batches} request${result.timing.batches === 1 ? "" : "s"} · ${result.timing.totalMs.toFixed(0)} ms server total · ${result.timing.inputTokens.toLocaleString()} input tokens · ${result.timing.outputTokens.toLocaleString()} output tokens`
          : "Waiting for Jev timings."}</p>
        <p>{history.length} completed rerank{history.length === 1 ? "" : "s"} this session. Throughput is candidates divided by Jev request time. Answer probability is Jev’s judgment that at least one candidate directly answers your question.</p>
      </details>
    </section>
  );
}
