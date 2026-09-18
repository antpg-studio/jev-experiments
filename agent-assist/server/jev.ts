import { performance } from "node:perf_hooks";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JsonValue } from "@typesafe-ai/sdk";
import { MACRO_SUMMARIES } from "../src/data/macros.ts";
import { buildQuestions, buildState } from "../src/lib/questions.ts";
import type { JudgeAnswers, JudgeRequest, JudgeResponse } from "../src/lib/questions.ts";
import { mockAnswers } from "./mock.ts";

export const MOCK = process.env.MOCK === "1";
export const HAS_KEY = Boolean(process.env.TYPESAFE_API_KEY);

const MAX_CONCURRENT = 8;
const QUESTIONS = buildQuestions(MACRO_SUMMARIES);

let client: TypeSafeClient | null = null;
function getClient(): TypeSafeClient {
  if (!client) {
    // The SDK retries 429/529/5xx with exponential backoff (500 ms doubling, jittered) by default.
    client = new TypeSafeClient({ retry: { maxRetries: 4, backoffInitialMs: 300, backoffMaxMs: 4000 }, timeout: 8000 });
  }
  return client;
}

/** Tiny semaphore so eight chats firing at once never exceed MAX_CONCURRENT in-flight requests. */
let inFlight = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}
function release(): void {
  inFlight--;
  waiters.shift()?.();
}

export async function judge(req: JudgeRequest): Promise<JudgeResponse> {
  const state = buildState(req, MACRO_SUMMARIES);
  await acquire();
  try {
    if (MOCK) {
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 5));
      const answers = mockAnswers(state);
      return {
        chatId: req.chatId,
        messageIndex: req.messageIndex,
        answers,
        jevMs: performance.now() - t0,
        usage: { input_tokens: 0, output_tokens: 0 },
        mock: true,
        model: "mock",
      };
    }
    const stateJson = JSON.parse(JSON.stringify(state)) as { [key: string]: JsonValue };
    const t0 = performance.now();
    const result = await getClient().systemOne({ state: stateJson, questions: QUESTIONS });
    const jevMs = performance.now() - t0;
    return {
      chatId: req.chatId,
      messageIndex: req.messageIndex,
      answers: result.answers as unknown as JudgeAnswers,
      jevMs,
      usage: result.usage,
      mock: false,
      model: result.model,
    };
  } finally {
    release();
  }
}
