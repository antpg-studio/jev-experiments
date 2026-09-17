import type { Product } from "./catalog.ts";
import { buildRequest, parseAnswers, type JevResponse, type ParsedAnswers } from "./jev.ts";

export interface RerankResult {
  answers: ParsedAnswers;
  ms: number;
  upstreamMs: number | null;
}

export async function rerank(query: string, candidates: Product[], signal?: AbortSignal): Promise<RerankResult> {
  const started = performance.now();
  const res = await fetch("/api/jev", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildRequest(query, candidates)),
    signal,
  });
  if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as JevResponse;
  const upstream = res.headers.get("x-upstream-ms");
  return { answers: parseAnswers(query, candidates, json), ms: performance.now() - started, upstreamMs: upstream ? Number(upstream) : null };
}
