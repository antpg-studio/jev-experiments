import { performance } from "node:perf_hooks";
import { APIError, TypeSafeClient } from "@typesafe-ai/sdk";
import { buildRerankRequest, parseRerankAnswers, type RawAnswer } from "../shared/questions.ts";
import { mergeRanking, splitBatches } from "../shared/rerank.ts";
import type { Bm25Hit, CandidateJudgment, Passage, RerankTiming } from "../shared/types.ts";
import { mockRerank } from "./mock.ts";

export const MOCK = process.env.MOCK === "1" || process.argv.includes("--mock");

/** Number of parallel batches per rerank. 1 = all 50 candidates in a single request. */
export const BATCHES = Math.max(1, Number(process.env.RERANK_BATCHES ?? "1") || 1);

/* openrouter-shim:begin */
/**
 * OpenRouter's Decisions API speaks the same protocol as TypeSafe's System One, at a different
 * path. The SDK hardcodes `/v1/systemone`, so rewrite it on the way out and keep the SDK's typed
 * question builders, retry policy and response parsing.
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai";
const OPENROUTER_MODEL = "typesafe/jev-1.13";
const openRouterFetch: typeof fetch = (input, init) => {
  if (typeof input === "string" || input instanceof URL) {
    return fetch(String(input).replace("/v1/systemone", "/api/alpha/decisions"), init);
  }
  return fetch(input, init);
};
/* openrouter-shim:end */

let client: TypeSafeClient | null = null;

export class MissingKeyError extends Error {
  constructor() {
    super("OPENROUTER_API_KEY is not set. Export it in your shell (never commit it) or run with MOCK=1.");
    this.name = "MissingKeyError";
  }
}

function getClient(): TypeSafeClient {
  if (!process.env.OPENROUTER_API_KEY) throw new MissingKeyError();
  client ??= new TypeSafeClient({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    defaultModel: OPENROUTER_MODEL,
    fetch: openRouterFetch,
    timeout: 20_000,
    retry: {
      maxRetries: 4,
      backoffInitialMs: 400,
      backoffMaxMs: 8_000,
      httpStatuses: new Set([408, 429, 500, 502, 503, 504, 529]),
    },
  });
  return client;
}

export interface RerankOutput {
  judgments: CandidateJudgment[];
  answerExists: number;
  jevMs: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
}

async function judgeBatch(query: string, passages: Passage[]) {
  const { state, questions, keyToId } = buildRerankRequest(query, passages);
  const { answers, usage } = await getClient().systemOne({ state, questions, model: "typesafe/jev-1.13" });
  const parsed = parseRerankAnswers(answers as Record<string, RawAnswer>, keyToId);
  return { ...parsed, usage };
}

/** One Jev round trip (or `BATCHES` parallel ones) judging every candidate against the query. */
export async function judgeCandidates(query: string, passages: Passage[]): Promise<RerankOutput> {
  if (!passages.length) return { judgments: [], answerExists: 0, jevMs: 0, batches: 0, inputTokens: 0, outputTokens: 0 };
  if (MOCK) return mockRerank(query, passages);
  const t0 = performance.now();
  const groups = splitBatches(passages, BATCHES);
  const results = await Promise.all(groups.map((g) => judgeBatch(query, g)));
  const jevMs = performance.now() - t0;
  return {
    judgments: results.flatMap((r) => r.judgments),
    // Any batch saying "an answer exists" is enough; take the max probability.
    answerExists: Math.max(...results.map((r) => r.answerExists)),
    jevMs,
    batches: groups.length,
    inputTokens: results.reduce((a, r) => a + r.usage.input_tokens, 0),
    outputTokens: results.reduce((a, r) => a + r.usage.output_tokens, 0),
  };
}

export async function rerank(
  query: string,
  hits: Bm25Hit[],
  byId: Map<string, Passage>,
  bm25Ms: number,
) {
  const t0 = performance.now();
  const passages = hits.map((h) => {
    const p = byId.get(h.id);
    if (!p) throw new Error(`unknown passage ${h.id}`);
    return p;
  });
  const out = await judgeCandidates(query, passages);
  const results = mergeRanking(hits, out.judgments, byId);
  const timing: RerankTiming = {
    bm25Ms,
    jevMs: out.jevMs,
    totalMs: bm25Ms + (performance.now() - t0),
    batches: out.batches,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
  };
  return { results, answerExists: out.answerExists, timing, mock: MOCK };
}

export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof MissingKeyError) return { status: 503, message: err.message };
  if (err instanceof APIError) {
    return { status: err.status >= 400 && err.status < 600 ? err.status : 502, message: `TypeSafe API error ${err.status}: ${err.message}` };
  }
  if (err instanceof Error) return { status: 500, message: err.message };
  return { status: 500, message: String(err) };
}
