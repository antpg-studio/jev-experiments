import type { BenchRow, BenchSummary, Bm25Response, SearchResponse } from "../shared/types.ts";

export interface Health {
  ok: boolean;
  mock: boolean;
  corpusSize: number;
  batches: number;
  hasKey: boolean;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export const fetchHealth = () => getJson<Health>("/api/health");

export const fetchBm25 = (q: string, signal?: AbortSignal) =>
  getJson<Bm25Response>(`/api/bm25?q=${encodeURIComponent(q)}`, signal);

export const fetchSearch = (q: string, signal?: AbortSignal) =>
  getJson<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, signal);

export interface BenchEvents {
  onStart(n: number, mock: boolean): void;
  onRow(index: number, row: BenchRow, summary: BenchSummary): void;
  onError(index: number, query: string, message: string): void;
  onDone(summary: BenchSummary): void;
}

/** Streams the benchmark over SSE so rows appear as each Jev request completes. */
export function streamBench(events: BenchEvents): () => void {
  const es = new EventSource("/api/bench");
  es.addEventListener("start", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { n: number; mock: boolean };
    events.onStart(d.n, d.mock);
  });
  es.addEventListener("row", (e) => {
    const d = JSON.parse((e as MessageEvent).data) as { index: number; row: BenchRow; summary: BenchSummary };
    events.onRow(d.index, d.row, d.summary);
  });
  es.addEventListener("error", (e) => {
    const me = e as MessageEvent;
    if (typeof me.data !== "string") return;
    const d = JSON.parse(me.data) as { index: number; query: string; message: string };
    events.onError(d.index, d.query, d.message);
  });
  es.addEventListener("done", (e) => {
    events.onDone(JSON.parse((e as MessageEvent).data) as BenchSummary);
    es.close();
  });
  return () => es.close();
}
