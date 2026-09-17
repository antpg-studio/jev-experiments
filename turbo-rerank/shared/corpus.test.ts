import { describe, expect, it } from "vitest";
import { Bm25Index } from "./bm25.ts";
import { BENCH_QUERIES } from "./bench-queries.ts";
import { buildCorpus } from "./corpus/index.ts";

describe("corpus", () => {
  const corpus = buildCorpus();

  it("has roughly 600 passages with unique ids and every kind represented", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(550);
    expect(corpus.length).toBeLessThanOrEqual(700);
    expect(new Set(corpus.map((p) => p.id)).size).toBe(corpus.length);
    const kinds = new Set(corpus.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(["api", "architecture", "handbook", "hr", "runbook"]);
  });

  it("is deterministic across builds", () => {
    expect(buildCorpus()).toBe(corpus);
  });

  it("has 40 benchmark queries whose targets all exist", () => {
    expect(BENCH_QUERIES).toHaveLength(40);
    const ids = new Set(corpus.map((p) => p.id));
    for (const q of BENCH_QUERIES) expect(ids.has(q.target), q.target).toBe(true);
    expect(new Set(BENCH_QUERIES.map((q) => q.query)).size).toBe(40);
  });

  it("BM25 retrieves every benchmark target within the top 50", () => {
    const index = new Bm25Index(corpus);
    for (const q of BENCH_QUERIES) {
      const ids = index.search(q.query, 50).map((h) => h.id);
      expect(ids, q.query).toContain(q.target);
    }
  });
});
