import { describe, expect, it, vi } from "vitest";
import {
  backoffMs,
  JevClient,
  JevHttpError,
  mapWithConcurrency,
  MissingApiKeyError,
  parseHunkJudgment,
  parseMessageJudgment,
  riskLevelFor,
  type SystemOneResponse,
} from "../src/jev.ts";

const okResponse = (answers: SystemOneResponse["answers"]): SystemOneResponse => ({
  model: "jev-latest",
  answers,
  usage: { input_tokens: 10, output_tokens: 2 },
});

const fullAnswers = (): SystemOneResponse["answers"] => ({
  risk: { type: "score", score: 3.7, legend: {}, probabilities: {}, confidence: 0.8 },
  kind: { type: "choice", choice: "feature", probabilities: { feature: 0.9 }, confidence: 0.9 },
  leaks_secret_or_token: { type: "noul", noul: 0.1 },
  logs_sensitive_data: { type: "noul", noul: 0.2 },
  disables_or_skips_tests: { type: "noul", noul: 0.0 },
  destructive_data_change: { type: "noul", noul: 0.95 },
  changes_public_api_shape: { type: "noul", noul: 0.3 },
  leftover_debug_or_temp: { type: "noul", noul: 0.4 },
  hardcoded_env_specific_value: { type: "noul", noul: 0.05 },
  offending_line: { type: "choice", choice: "L2", probabilities: {}, confidence: 0.7 },
});

describe("JevClient", () => {
  it("requires an API key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    try {
      expect(() => new JevClient({ apiKey: undefined, fetchImpl: fetch })).toThrow(MissingApiKeyError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("posts state + questions with bearer auth and measures latency", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), init: init! };
      return new Response(JSON.stringify(okResponse(fullAnswers())), { status: 200 });
    }) as typeof fetch;
    const client = new JevClient({ apiKey: "test-key", fetchImpl });
    const r = await client.systemOne({ a: 1 }, { q: { type: "noul", instructions: "x" } });
    expect(seen!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(seen!.init.body as string)).toEqual({ state: { a: 1 }, model: "jev-latest", questions: { q: { type: "noul", instructions: "x" } } });
    expect(r.attempts).toBe(1);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("retries 429/529 with backoff and counts retries", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      if (calls === 2) return new Response("overloaded", { status: 529 });
      return new Response(JSON.stringify(okResponse(fullAnswers())), { status: 200 });
    }) as typeof fetch;
    const client = new JevClient({ apiKey: "k", fetchImpl });
    const r = await client.systemOne({}, {});
    expect(r.attempts).toBe(3);
    expect(client.retries).toBe(2);
  });

  it("does not retry 4xx client errors", async () => {
    const fetchImpl = (async () => new Response("bad request", { status: 400 })) as typeof fetch;
    const client = new JevClient({ apiKey: "k", fetchImpl });
    await expect(client.systemOne({}, {})).rejects.toBeInstanceOf(JevHttpError);
  });
});

describe("backoffMs", () => {
  it("honours retry-after and grows exponentially otherwise", () => {
    expect(backoffMs(1, "2")).toBe(2000);
    expect(backoffMs(1, "99")).toBe(10_000);
    const a1 = backoffMs(1, null);
    const a3 = backoffMs(3, null);
    expect(a1).toBeGreaterThanOrEqual(200);
    expect(a1).toBeLessThan(300);
    expect(a3).toBeGreaterThanOrEqual(800);
    expect(backoffMs(10, null)).toBeLessThan(4_100);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the limit and preserves order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 3, 2, 4, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 2;
    });
    expect(out).toEqual([10, 2, 6, 4, 8, 12, 14]);
    expect(peak).toBe(3);
  });
});

describe("parseHunkJudgment", () => {
  it("maps answers to a typed judgment", () => {
    const state = { file: "a.ts", language: "typescript", change_type: "modification" as const, hunk: "+x\n+y", added_lines: { L1: "x", L2: "y" } };
    const j = parseHunkJudgment("a.ts#0", state, { response: okResponse(fullAnswers()), latencyMs: 123, attempts: 1 });
    expect(j).toMatchObject({ hunkId: "a.ts#0", risk: 3.7, riskLevel: "dangerous", kind: "feature", offendingLineIndex: 1, latencyMs: 123, inputTokens: 10 });
    expect(j.findings.destructive_data_change).toBe(0.95);
  });

  it("ignores an out-of-range offending line and unknown kinds", () => {
    const answers = fullAnswers();
    answers.offending_line = { type: "choice", choice: "L9", probabilities: {}, confidence: 0.5 };
    answers.kind = { type: "choice", choice: "mystery", probabilities: {}, confidence: 0.5 };
    const state = { file: "a.ts", language: "typescript", change_type: "modification" as const, hunk: "+x", added_lines: { L1: "x" } };
    const j = parseHunkJudgment("a.ts#0", state, { response: okResponse(answers), latencyMs: 1, attempts: 1 });
    expect(j.offendingLineIndex).toBeNull();
    expect(j.kind).toBe("chore");
  });

  it("throws on a malformed answer set", () => {
    const state = { file: "a.ts", language: "typescript", change_type: "modification" as const, hunk: "", added_lines: {} };
    expect(() => parseHunkJudgment("a.ts#0", state, { response: okResponse({}), latencyMs: 1, attempts: 1 })).toThrow(/risk/);
  });
});

describe("parseMessageJudgment / riskLevelFor", () => {
  it("maps quality scores to levels", () => {
    const m = parseMessageJudgment({
      response: okResponse({
        message_matches_changes: { type: "noul", noul: 0.12 },
        message_quality: { type: "score", score: 2.6, legend: {}, probabilities: {}, confidence: 0.7 },
      }),
      latencyMs: 90,
      attempts: 1,
    });
    expect(m).toMatchObject({ matchesChanges: 0.12, qualityLevel: "excellent", latencyMs: 90 });
  });
  it("rounds risk to the nearest level and clamps", () => {
    expect(riskLevelFor(0.2)).toBe("cosmetic");
    expect(riskLevelFor(1.6)).toBe("moderate");
    expect(riskLevelFor(3.5)).toBe("dangerous");
    expect(riskLevelFor(9)).toBe("dangerous");
  });
});
