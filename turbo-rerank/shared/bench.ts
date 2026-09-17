import { mean, percentile } from "./rerank.ts";
import type { BenchQuery, BenchRow, BenchSummary, Bm25Hit, Passage, RankedResult, RerankTiming } from "./types.ts";

export type RerankFn = (
  query: string,
  hits: Bm25Hit[],
  bm25Ms: number,
) => Promise<{ results: RankedResult[]; answerExists: number; timing: RerankTiming }>;

export type Bm25Fn = (query: string) => { hits: Bm25Hit[]; bm25Ms: number };

export function rankOf(ids: string[], target: string): number | null {
  const i = ids.indexOf(target);
  return i === -1 ? null : i + 1;
}

export async function runBenchQuery(
  bq: BenchQuery,
  rerank: RerankFn,
  bm25: Bm25Fn,
  byId: Map<string, Passage>,
): Promise<{ row: BenchRow; timing: RerankTiming }> {
  if (!byId.has(bq.target)) throw new Error(`benchmark target ${bq.target} not in corpus`);
  const { hits, bm25Ms } = bm25(bq.query);
  const { results, answerExists, timing } = await rerank(bq.query, hits, bm25Ms);
  return {
    row: {
      query: bq.query,
      target: bq.target,
      paraphrase: Boolean(bq.paraphrase),
      bm25Rank: rankOf(hits.map((h) => h.id), bq.target),
      jevRank: rankOf(results.map((r) => r.id), bq.target),
      jevMs: timing.jevMs,
      answerExists,
    },
    timing,
  };
}

function hitRate(rows: BenchRow[], key: "bm25Rank" | "jevRank", k: number): number {
  if (!rows.length) return 0;
  return rows.filter((r) => r[key] !== null && (r[key] as number) <= k).length / rows.length;
}

function mrr(rows: BenchRow[], key: "bm25Rank" | "jevRank"): number {
  if (!rows.length) return 0;
  return mean(rows.map((r) => (r[key] ? 1 / (r[key] as number) : 0)));
}

export function summarize(rows: BenchRow[], wallMs: number, inputTokens = 0, outputTokens = 0): BenchSummary {
  const lat = rows.map((r) => r.jevMs);
  const candidates = rows.length * 50;
  return {
    n: rows.length,
    bm25Top1: hitRate(rows, "bm25Rank", 1),
    bm25Top5: hitRate(rows, "bm25Rank", 5),
    jevTop1: hitRate(rows, "jevRank", 1),
    jevTop5: hitRate(rows, "jevRank", 5),
    bm25Mrr: mrr(rows, "bm25Rank"),
    jevMrr: mrr(rows, "jevRank"),
    inTop50: hitRate(rows, "bm25Rank", 50),
    meanMs: mean(lat),
    p50Ms: percentile(lat, 50),
    p95Ms: percentile(lat, 95),
    maxMs: lat.length ? Math.max(...lat) : 0,
    wallMs,
    candidatesPerSecond: wallMs > 0 ? candidates / (wallMs / 1000) : 0,
    inputTokens,
    outputTokens,
  };
}
