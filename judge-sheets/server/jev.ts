/**
 * The only module that talks to Jev. Everything else (the formula engine,
 * the grid, the batcher) deals in the typed shapes below.
 */
import { performance } from "node:perf_hooks";
import type { Question, SystemOneResponse } from "./types.ts";

export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const MODEL = "typesafe/jev-1.13";

export class JevError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type JevResult = { response: SystemOneResponse; ms: number; attempts: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request = one `state` + many questions about it (fan-out).
 * Retries 429/529 with exponential backoff + jitter. `ms` is the wall time of
 * the whole call including retries, measured with performance.now().
 */
export async function systemOne(
  apiKey: string,
  state: unknown,
  questions: Record<string, Question>,
  opts: { maxAttempts?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<JevResult> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const timeoutMs = opts.timeoutMs ?? 2500;
  const f = opts.fetchImpl ?? fetch;
  const t0 = performance.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await f(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state, model: MODEL, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // stalled connection / DNS hiccup: retry like a 5xx
      if (attempt >= maxAttempts) throw new JevError(0, (e as Error).message);
      await sleep(Math.min(4000, 200 * 2 ** (attempt - 1)) + Math.random() * 100);
      continue;
    }
    if (res.ok) {
      const response = (await res.json()) as SystemOneResponse;
      return { response, ms: performance.now() - t0, attempts: attempt };
    }
    const text = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
    if (!retryable || attempt >= maxAttempts) {
      throw new JevError(res.status, text || res.statusText);
    }
    await sleep(Math.min(4000, 200 * 2 ** (attempt - 1)) + Math.random() * 100);
  }
}
