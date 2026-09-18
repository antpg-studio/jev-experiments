import type { Bm25Hit, CandidateJudgment, Passage, RankedResult } from "./types.ts";

/**
 * Merges BM25 order with Jev judgments into the final ranking.
 * Sort key: probability-weighted relevance descending, then BM25 rank ascending as the tiebreaker.
 */
export function mergeRanking(
  hits: Bm25Hit[],
  judgments: CandidateJudgment[],
  byId: Map<string, Passage>,
): RankedResult[] {
  const judgmentById = new Map(judgments.map((j) => [j.id, j]));
  const rows = hits.map((hit, i) => {
    const p = byId.get(hit.id);
    if (!p) throw new Error(`unknown passage ${hit.id}`);
    const j = judgmentById.get(hit.id);
    return {
      id: p.id,
      doc: p.doc,
      title: p.title,
      kind: p.kind,
      text: p.text,
      bm25Rank: i + 1,
      bm25Score: hit.score,
      jevRank: 0,
      relevance: j?.relevance ?? 0,
      level: j?.level ?? 0,
      confidence: j?.confidence ?? 0,
    } satisfies RankedResult;
  });
  const order = [...rows].sort((a, b) => b.relevance - a.relevance || a.bm25Rank - b.bm25Rank);
  order.forEach((r, i) => {
    r.jevRank = i + 1;
  });
  return order;
}

/** Splits candidates into `n` near-equal contiguous batches (used when one request is too large). */
export function splitBatches<T>(items: T[], n: number): T[][] {
  const count = Math.max(1, Math.min(n, items.length));
  const size = Math.ceil(items.length / count);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
