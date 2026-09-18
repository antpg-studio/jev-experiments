import type { AppState, Answer } from "../shared/questions.ts";

export interface ResolveResponse {
  answers: Record<string, Answer>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  jevLatencyMs: number;
  retries: number;
  mock: boolean;
}

export interface Timed<T> {
  result: T;
  /** Browser-measured round trip through the local proxy, ms. */
  clientMs: number;
  /** Proxy-measured round trip to TypeSafe, ms. */
  jevMs: number;
}

export class ResolveError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Single entry point for every Jev call made by the browser. */
export async function resolveQuery(query: string, app_state: AppState, signal?: AbortSignal): Promise<Timed<ResolveResponse>> {
  const t0 = performance.now();
  const res = await fetch("/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, app_state }),
    signal,
  });
  const clientMs = performance.now() - t0;
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* body was not JSON */
    }
    throw new ResolveError(res.status, message);
  }
  const result = (await res.json()) as ResolveResponse;
  return { result, clientMs, jevMs: result.jevLatencyMs };
}

/** Runs `items` through `fn` with at most `limit` in flight. Results keep input order. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
