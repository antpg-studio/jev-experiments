import { performance } from "node:perf_hooks";
import { tokenize } from "../shared/bm25.ts";
import type { CandidateJudgment, Passage, RelevanceLevel } from "../shared/types.ts";
import type { RerankOutput } from "./jev.ts";

/**
 * Mock mode: no network. Produces deterministic pseudo-judgments from token overlap so the UI can be
 * exercised offline. Clearly labelled as MOCK in every response; never used unless MOCK=1 / --mock.
 */
export async function mockRerank(query: string, passages: Passage[]): Promise<RerankOutput> {
  const t0 = performance.now();
  const q = new Set(tokenize(query));
  const judgments: CandidateJudgment[] = passages.map((p) => {
    const toks = tokenize(p.text);
    const overlap = toks.filter((t) => q.has(t)).length;
    const frac = q.size ? Math.min(1, overlap / (q.size * 1.5)) : 0;
    const relevance = frac * 3;
    const level = Math.round(relevance) as RelevanceLevel;
    const probabilities: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0 };
    probabilities[String(level)] = 0.7;
    probabilities[String(Math.max(0, level - 1))] += 0.3;
    return { id: p.id, relevance, level, confidence: 0.7, probabilities };
  });
  // Simulate a realistic round trip so latency panels are exercised.
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 60));
  const best = Math.max(0, ...judgments.map((j) => j.relevance));
  return {
    judgments,
    answerExists: best >= 2 ? 0.9 : 0.1,
    jevMs: performance.now() - t0,
    batches: 1,
    inputTokens: 0,
    outputTokens: 0,
  };
}
