import { RELEVANCE_LABELS, type Bm25Response, type RankedResult, type SearchResponse } from "../shared/types.ts";

interface Props {
  bm25: Bm25Response | null;
  result: SearchResponse | null;
  pending: boolean;
}

const SHOW = 10;

export function ResultColumns({ bm25, result, pending }: Props) {
  if (!bm25) return <section className="columns empty">Type a query to search 598 passages. BM25 answers in about a millisecond; Jev reorders all 50 candidates in one request.</section>;
  const jevById = new Map(result?.results.map((r) => [r.id, r]) ?? []);
  return (
    <section className="columns">
      <div className="column">
        <h2>
          <span className="tag bm25">BM25</span> keyword order
          <small>{bm25.bm25Ms.toFixed(2)} ms</small>
        </h2>
        <ol>
          {bm25.results.slice(0, SHOW).map((r) => {
            const j = jevById.get(r.id);
            return (
              <li key={r.id} className={`hit ${j && j.jevRank === 1 ? "winner" : ""}`}>
                <div className="rank">{r.bm25Rank}</div>
                <div className="body">
                  <div className="title">
                    <span className={`kind ${r.kind}`}>{r.kind}</span> {r.title}
                    {j && <RankDelta from={r.bm25Rank} to={j.jevRank} />}
                  </div>
                  <p>{r.text}</p>
                  <div className="meta">bm25 {r.bm25Score.toFixed(2)} · {r.id}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className={`column jev ${pending && !result ? "loading" : ""}`}>
        <h2>
          <span className="tag jev">Jev</span> reranked order
          <small>{result ? `${result.timing.jevMs.toFixed(0)} ms · ${result.results.length} scored` : pending ? "judging 50 candidates…" : ""}</small>
        </h2>
        {result ? (
          <ol>
            {result.results.slice(0, SHOW).map((r) => <JevHit key={r.id} r={r} />)}
          </ol>
        ) : (
          <ol className="skeleton">
            {bm25.results.slice(0, SHOW).map((r) => (
              <li key={r.id} className="hit">
                <div className="rank">·</div>
                <div className="body">
                  <div className="title"><span className={`kind ${r.kind}`}>{r.kind}</span> {r.title}</div>
                  <p>{r.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function JevHit({ r }: { r: RankedResult }) {
  const pct = (r.relevance / 3) * 100;
  return (
    <li className={`hit level-${r.level} ${r.jevRank === 1 && r.level >= 2 ? "winner" : ""}`}>
      <div className="rank">{r.jevRank}</div>
      <div className="body">
        <div className="title">
          <span className={`kind ${r.kind}`}>{r.kind}</span> {r.title}
          <RankDelta from={r.bm25Rank} to={r.jevRank} />
        </div>
        <div className="relbar" title={`relevance ${r.relevance.toFixed(2)} / 3, confidence ${(r.confidence * 100).toFixed(0)}%`}>
          <div className={`fill level-${r.level}`} style={{ width: `${pct}%` }} />
          <span className="rellabel">
            {RELEVANCE_LABELS[r.level]} · {r.relevance.toFixed(2)} · conf {(r.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <p>{r.text}</p>
        <div className="meta">was #{r.bm25Rank} in BM25 · {r.id}</div>
      </div>
    </li>
  );
}

function RankDelta({ from, to }: { from: number; to: number }) {
  const d = from - to;
  if (d === 0) return <span className="delta same">=</span>;
  if (d > 0) return <span className="delta up">▲ {d}</span>;
  return <span className="delta down">▼ {-d}</span>;
}
