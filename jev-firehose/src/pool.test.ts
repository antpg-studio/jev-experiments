import { describe, expect, it } from "vitest";
import { JudgePool, type Completed, type Transport, type TransportResult } from "./pool.ts";
import { HIST_EDGES, RateMeter, Ring, costPerHourUsd, histogram, percentile } from "./stats.ts";

const okAnswers = {
  harassment: { type: "noul", noul: 0.1 },
  spam_or_scam: { type: "noul", noul: 0.1 },
  spoiler: { type: "noul", noul: 0.1 },
  question_for_streamer: { type: "noul", noul: 0.1 },
  needs_mod_attention: { type: "noul", noul: 0.1 },
  positive_hype: { type: "noul", noul: 0.9 },
  language: { type: "choice", choice: "english", confidence: 0.99, probabilities: { english: 0.99 } },
};

function deferredTransport() {
  const calls: { id: string; resolve: (r: TransportResult) => void }[] = [];
  const transport: Transport = (item) => new Promise((resolve) => calls.push({ id: item.id, resolve }));
  const ok = (call: (typeof calls)[number]) => call.resolve({ id: call.id, ok: true, ms: 120, answers: okAnswers, usage: { input_tokens: 500, output_tokens: 10 } });
  return { calls, transport, ok };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("JudgePool accounting", () => {
  it("releases queued messages up to maxInFlight and refills as answers land", async () => {
    const t = deferredTransport();
    const done: Completed[] = [];
    const pool = new JudgePool(t.transport, (c) => done.push(c), { maxInFlight: 8 });
    for (let i = 0; i < 20; i++) pool.enqueue(`m${i}`, "hi", {});
    let s = pool.snapshot();
    expect(s.inFlight).toBe(8);
    expect(s.backlog).toBe(12);
    expect(t.calls.map((c) => c.id)).toEqual(Array.from({ length: 8 }, (_, i) => `m${i}`));

    // a slow m0 must not hold up m3
    t.ok(t.calls[3]);
    await flush();
    s = pool.snapshot();
    expect(done.map((d) => d.id)).toEqual(["m3"]);
    expect(s.judged).toBe(1);
    expect(s.inputTokens).toBe(500);
    expect(s.inFlight).toBe(8);
    expect(s.backlog).toBe(11);
    expect(t.calls).toHaveLength(9);
    expect(done[0].apiMs).toBe(120);
    expect(done[0].judgment.source).toBe("jev");
  });

  it("falls back to the heuristic on failed items and transport errors", async () => {
    const done: Completed[] = [];
    const failing: Transport = async (it) => (it.id === "a" ? { id: it.id, ok: false, ms: 50, error: "529" } : { id: it.id, ok: true, ms: 50, answers: okAnswers });
    const pool = new JudgePool(failing, (c) => done.push(c), { maxInFlight: 2 });
    pool.enqueue("a", "kys trash streamer", {});
    pool.enqueue("b", "gg", {});
    await flush();
    expect(done.map((d) => d.judgment.source)).toEqual(["heuristic", "jev"]);
    expect(done[0].judgment.harassment).toBeGreaterThan(0.5);
    expect(pool.snapshot()).toMatchObject({ judged: 1, failed: 1, fallback: 1, inFlight: 0, backlog: 0 });

    const boom: Transport = async () => {
      throw new Error("network");
    };
    const pool2 = new JudgePool(boom, (c) => done.push(c), { maxInFlight: 4 });
    pool2.enqueue("c", "hello", {});
    await flush();
    expect(pool2.snapshot()).toMatchObject({ failed: 1, fallback: 1, inFlight: 0 });
  });

  it("sheds old or excess backlog to the heuristic and discards stale answers", async () => {
    let now = 0;
    const t = deferredTransport();
    const done: Completed[] = [];
    const pool = new JudgePool(t.transport, (c) => done.push(c), { maxInFlight: 1, maxQueueAgeMs: 1000, maxBacklog: 3 }, () => now);
    for (let i = 0; i < 6; i++) pool.enqueue(`m${i}`, "hello", {});
    // m0 in flight; m1..m5 queued but the cap is 3, so the oldest two are shed
    expect(pool.snapshot()).toMatchObject({ inFlight: 1, backlog: 3, fallback: 2 });
    now = 1500;
    expect(pool.shedStale()).toBe(3);
    expect(pool.snapshot().backlog).toBe(0);
    expect(done.filter((d) => d.judgment.source === "heuristic")).toHaveLength(5);

    pool.reset();
    t.ok(t.calls[0]);
    await flush();
    expect(pool.snapshot().stale).toBe(1);
  });

  it("holds results for the simulated slow-LLM delay", async () => {
    const t = deferredTransport();
    const done: Completed[] = [];
    let delayed = 0;
    const pool = new JudgePool(t.transport, (c) => done.push(c), { maxInFlight: 1, simulatedDelayMs: 2000 }, () => 0, async (ms) => {
      delayed = ms;
    });
    pool.enqueue("x", "hi", {});
    t.ok(t.calls[0]);
    await flush();
    expect(delayed).toBe(2000);
    expect(done).toHaveLength(1);
  });
});

describe("stats", () => {
  it("percentiles on sorted data", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([], 50)).toBe(0);
  });
  it("ring buffer keeps the last N", () => {
    const r = new Ring(3);
    [1, 2, 3, 4].forEach((v) => r.push(v));
    expect(r.sorted()).toEqual([2, 3, 4]);
    expect(r.last()).toBe(4);
  });
  it("rate meter windows events", () => {
    const m = new RateMeter(1000);
    m.mark(0, 10);
    m.mark(500, 10);
    expect(m.rate(900)).toBe(20);
    expect(m.rate(1200)).toBe(10);
  });
  it("histogram buckets and cost", () => {
    const h = histogram([10, 30, 120, 9999]);
    expect(h[0]).toBe(1);
    expect(h[1]).toBe(1);
    expect(h[4]).toBe(1);
    expect(h[HIST_EDGES.length - 1]).toBe(1);
    expect(costPerHourUsd(100_000, 0.042 / 1e6)).toBeCloseTo(15.12);
  });
});
