import { performance } from "node:perf_hooks";
import type { Answer, JudgeRequest, JudgeResponse } from "../src/lib/types.ts";
import { buildRequestBody } from "../src/lib/questions.ts";
import { mockAnswers } from "./mock.ts";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 250;

export class JevError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RawResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JevOptions {
  apiKey: string | undefined;
  mock: boolean;
  signal?: AbortSignal;
}

/** The only place that talks to TypeSafe. Returns typed answers plus the measured round trip. */
export async function judge(req: JudgeRequest, opts: JevOptions): Promise<JudgeResponse> {
  const body = buildRequestBody(req);
  const questionCount = Object.keys(body.questions).length;

  if (opts.mock) {
    const t0 = performance.now();
    await sleep(120 + Math.random() * 60);
    return {
      answers: mockAnswers(req),
      apiMs: performance.now() - t0,
      model: "mock",
      usage: { input_tokens: 0, output_tokens: 0 },
      questionCount,
      mock: true,
    };
  }

  if (!opts.apiKey) throw new JevError(500, "OPENROUTER_API_KEY is not set. Export it and restart `npm run dev`, or run with MOCK=1.");

  let attempt = 0;
  for (;;) {
    const t0 = performance.now();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    const apiMs = performance.now() - t0;

    if (res.ok) {
      const data = (await res.json()) as RawResponse;
      return { answers: data.answers, apiMs, model: data.model, usage: data.usage, questionCount, mock: false };
    }
    if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = retryAfter > 0 ? retryAfter * 1000 : BASE_BACKOFF_MS * 2 ** attempt * (0.5 + Math.random());
      attempt++;
      await sleep(wait);
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new JevError(res.status, `TypeSafe ${res.status}: ${text.slice(0, 300)}`);
  }
}
