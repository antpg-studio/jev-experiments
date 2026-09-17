import { performance } from "node:perf_hooks";
import type { Question, SystemOneResponse } from "../src/shared/questions.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const MAX_RETRIES = 4;

export class JevError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface JevResult {
  response: SystemOneResponse;
  /** Wall-clock milliseconds from request start to parsed response (retries included). */
  latencyMs: number;
  retries: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The only place that talks to TypeSafe. Retries 429/529 with exponential backoff. */
export async function systemOne(
  apiKey: string,
  state: unknown,
  questions: Record<string, Question>,
  signal?: AbortSignal,
): Promise<JevResult> {
  const started = performance.now();
  let attempt = 0;
  for (;;) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, model: MODEL, questions }),
      signal,
    });
    if (res.ok) {
      const response = (await res.json()) as SystemOneResponse;
      return { response, latencyMs: performance.now() - started, retries: attempt };
    }
    const text = await res.text();
    if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt;
      attempt += 1;
      await sleep(backoff + Math.random() * 100);
      continue;
    }
    throw new JevError(res.status, text.slice(0, 500) || res.statusText);
  }
}
