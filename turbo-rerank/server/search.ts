import { performance } from "node:perf_hooks";
import { Bm25Index } from "../shared/bm25.ts";
import { buildCorpus } from "../shared/corpus/index.ts";
import type { Bm25Response, Passage } from "../shared/types.ts";

export const TOP_K = 50;

const corpus: Passage[] = buildCorpus();
export const byId = new Map(corpus.map((p) => [p.id, p]));
export const index = new Bm25Index(corpus);

export function bm25Search(query: string, k = TOP_K) {
  const t0 = performance.now();
  const hits = index.search(query, k);
  return { hits, bm25Ms: performance.now() - t0 };
}

export function bm25Response(query: string): Bm25Response {
  const { hits, bm25Ms } = bm25Search(query);
  return {
    query,
    bm25Ms,
    corpusSize: corpus.length,
    results: hits.map((h, i) => {
      const p = byId.get(h.id)!;
      return { id: p.id, doc: p.doc, title: p.title, kind: p.kind, text: p.text, bm25Rank: i + 1, bm25Score: h.score };
    }),
  };
}

export const corpusSize = corpus.length;
