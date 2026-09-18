import { useState } from "react";
import { RELEVANCE_LABELS, type Bm25Response, type DocKind, type RankedResult, type SearchResponse } from "../shared/types.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  bm25: Bm25Response | null;
  result: SearchResponse | null;
  pending: boolean;
}

const KINDS: Record<DocKind, string> = {
  handbook: "Engineering handbook",
  hr: "People & policies",
  api: "API reference",
  runbook: "Runbooks",
  architecture: "Architecture",
};

export function ResultColumns({ bm25, result, pending }: Props) {
  const [showAll, setShowAll] = useState(false);
  if (!bm25 || bm25.results.length === 0) return null;
  const jevById = new Map(result?.results.map((r) => [r.id, r]) ?? []);
  const limit = showAll ? bm25.results.length : 5;
  return (
    <section className="comparison" aria-label="Search result comparison" aria-busy={pending}>
      <div className="columns">
        <section className="result-column" aria-labelledby="bm25-heading">
          <header className="column-heading">
            <div><h2 id="bm25-heading">Keyword search</h2><p>BM25 · original order</p></div>
            <span className="column-count">{bm25.results.length} matches</span>
          </header>
          <ol className="result-list">
            {bm25.results.slice(0, limit).map((r) => (
              <Hit key={r.id} r={r} rank={r.bm25Rank} judgment={jevById.get(r.id)} />
            ))}
          </ol>
        </section>
        <section className="result-column reranked" aria-labelledby="jev-heading">
          <header className="column-heading">
            <div><h2 id="jev-heading"><Icon name="mark" size={19} />Reranked by Jev</h2><p>Ordered by meaning</p></div>
            <span className="column-count">{result ? `${(result.answerExists * 100).toFixed(0)}% answer probability` : pending ? "Judging relevance…" : "Awaiting results"}</span>
          </header>
          {result ? (
            <ol className="result-list">
              {result.results.slice(0, limit).map((r) => <Hit key={r.id} r={r} rank={r.jevRank} judgment={r} reranked />)}
            </ol>
          ) : (
            <div className="result-placeholder" role="status">
              {pending && <span className="spinner" />}
              <p>{pending ? `Judging ${bm25.results.length} passages together…` : "Relevance results will appear here."}</p>
            </div>
          )}
        </section>
      </div>
      <div className="comparison-footer">
        <span>Showing {Math.min(limit, bm25.results.length)} of {bm25.results.length} candidates · select a passage to read more</span>
        {bm25.results.length > 5 && <button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 5" : `Show all ${bm25.results.length}`} <Icon name="chevron" size={14} /></button>}
      </div>
    </section>
  );
}

function Hit({ r, rank, judgment, reranked = false }: {
  r: Bm25Response["results"][number];
  rank: number;
  judgment?: RankedResult;
  reranked?: boolean;
}) {
  const winner = reranked && rank === 1 && judgment && judgment.level >= 2;
  return (
    <li className={`result-item ${winner ? "winner" : ""}`}>
      <span className="rank">{String(rank).padStart(2, "0")}</span>
      <details className="passage">
        <summary>
          <span className="passage-source"><Icon name="document" size={13} />{KINDS[r.kind]}
            {judgment && <RankDelta from={r.bm25Rank} to={judgment.jevRank} />}
          </span>
          <span className="passage-title">{r.title}</span>
          <span className="excerpt">{r.text}</span>
          <span className="read-more">Read passage <Icon name="chevron" size={12} /></span>
        </summary>
        <p className="passage-full">{r.text}</p>
        <div className="passage-id">{r.id} · BM25 score {r.bm25Score.toFixed(2)}</div>
      </details>
      {reranked && judgment && (
        <div className={`relevance level-${judgment.level}`}>
          <span className="relevance-label">{judgment.level === 3 && <Icon name="check" size={12} />}{RELEVANCE_LABELS[judgment.level]}</span>
          <div className="relevance-track" title={`Relevance ${judgment.relevance.toFixed(2)} of 3`}>
            <span style={{ width: `${judgment.relevance / 3 * 100}%` }} />
          </div>
          <span>{(judgment.confidence * 100).toFixed(0)}% confidence</span>
        </div>
      )}
    </li>
  );
}

function RankDelta({ from, to }: { from: number; to: number }) {
  const d = from - to;
  return <span className={`delta ${d > 0 ? "up" : "same"}`} title={`BM25 #${from} → Jev #${to}`} aria-label={`From rank ${from} to ${to}`}>
    {d === 0 ? "—" : `${d > 0 ? "↑" : "↓"} ${Math.abs(d)}`}
  </span>;
}
