import { describe, expect, it } from "vitest";
import type { Answer, JevResponse } from "./decide.ts";
import { Metrics, percentile } from "./metrics.ts";
import { BATCH_SLACK_MS, RateLimitError, Swarm, type JevFetch } from "./swarm.ts";

type Body = { state: unknown; questions: Record<string, { criteria?: Record<string, string | null> }> };

function respond(body: Body, move = "N"): JevResponse {
  const answers: Record<string, Answer> = {};
  for (const id of Object.keys(body.questions)) {
    if (id.endsWith(".move")) answers[id] = { type: "choice", choice: move, confidence: 0.7, probabilities: { [move]: 0.7 } };
    else if (id.endsWith(".boost")) answers[id] = { type: "noul", noul: 0.1 };
    else answers[id] = { type: "choice", choice: "none", confidence: 0.9, probabilities: {} };
  }
  return { model: "jev-test", answers, usage: { input_tokens: 100 * Object.keys(body.questions).length / 3, output_tokens: 0 } };
}

/** A fetch whose responses resolve only when the test says so. */
function controlledFetch() {
  const pending: { body: Body; resolve: (r: JevResponse) => void; reject: (e: Error) => void }[] = [];
  const fetch: JevFetch = (body) =>
    new Promise((resolve, reject) => pending.push({ body: body as Body, resolve, reject }));
  return { fetch, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Swarm scheduler", () => {
  it("batches due Jev agents into fixed-size requests and caps in-flight requests", () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 32, agentsPerRequest: 8, maxInFlight: 3 }, fetch);
    s.frame(0);
    expect(pending).toHaveLength(3);
    expect(s.metrics.inFlight).toBe(3);
    for (const p of pending) expect(Object.keys(p.body.questions)).toHaveLength(24);
    const requested = s.world.agents.filter((a) => a.inFlight > 0);
    expect(requested).toHaveLength(24);
    expect(requested.every((a) => a.seq === 1)).toBe(true);
    // agents without a decision yet still move: deterministic fallback applied immediately
    expect(s.world.agents.filter((a) => a.controller === "jev").every((a) => a.decision.source === "heuristic")).toBe(true);
  });

  it("applies answers asynchronously and keeps acting on the last decision meanwhile", async () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 4, human: false, agentsPerRequest: 4 }, fetch);
    s.frame(0);
    expect(pending).toHaveLength(1);
    const a = s.world.agents[0];
    const headingBefore = a.heading;
    s.frame(16);
    s.frame(32);
    expect(a.heading).toBe(headingBefore);
    pending[0].resolve(respond(pending[0].body, "SE"));
    await flush();
    expect(a.heading).toBe("SE");
    expect(a.decision).toMatchObject({ seq: 1, source: "jev" });
    expect(a.inFlight).toBe(0);
    expect(s.metrics.decisions).toBe(4);
    expect(s.metrics.inputTokens).toBe(400);
    expect(s.metrics.inFlight).toBe(0);
    expect(s.metrics.latencies).toHaveLength(1);
  });

  it("discards a late answer when a newer one has already been applied", async () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 1, human: false, decisionIntervalMs: 100, agentsPerRequest: 1 }, fetch);
    const a = s.world.agents[0];
    s.frame(0);
    s.frame(150);
    expect(pending).toHaveLength(2);
    expect(a.seq).toBe(2);
    pending[1].resolve(respond(pending[1].body, "E"));
    await flush();
    expect(a.heading).toBe("E");
    pending[0].resolve(respond(pending[0].body, "W"));
    await flush();
    expect(a.heading).toBe("E");
    expect(s.metrics.stale).toBe(1);
    expect(s.metrics.decisions).toBe(1);
  });

  it("never lets an agent have more than two requests in flight", () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 1, human: false, decisionIntervalMs: 100 }, fetch);
    for (let t = 0; t < 2000; t += 100) s.frame(t);
    expect(pending).toHaveLength(2);
  });

  it("holds a partial batch until the oldest due agent has waited past the slack", () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 3, human: false, decisionIntervalMs: 100, agentsPerRequest: 8 }, fetch);
    s.frame(0);
    expect(pending).toHaveLength(1); // first round goes out immediately
    s.frame(100);
    s.frame(100 + BATCH_SLACK_MS - 1);
    expect(pending).toHaveLength(1);
    s.frame(100 + BATCH_SLACK_MS);
    expect(pending).toHaveLength(2);
    expect(Object.keys(pending[1].body.questions)).toHaveLength(9);
  });

  it("keeps the last decision when a request fails and backs off on rate limits", async () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 2, human: false, agentsPerRequest: 2 }, fetch);
    s.frame(0);
    const a = s.world.agents[0];
    a.decision = { ...a.decision, source: "jev", move: "hold", at: 0 };
    pending[0].reject(new Error("boom"));
    await flush();
    expect(s.metrics.errors).toBe(1);
    expect(a.decision).toMatchObject({ source: "jev", move: "hold" });
    expect(s.world.agents.every((x) => x.inFlight === 0)).toBe(true);

    s.frame(1000);
    expect(pending).toHaveLength(2);
    pending[1].reject(new RateLimitError(60_000));
    await flush();
    expect(s.metrics.rateLimited).toBe(1);
    s.frame(2000);
    expect(pending).toHaveLength(2);
  });

  it("re-applies a deterministic fallback when a decision goes stale for too long", () => {
    const { fetch } = controlledFetch();
    const s = new Swarm({ agentCount: 1, human: false, fallbackAfterMs: 500 }, fetch);
    const a = s.world.agents[0];
    s.frame(0);
    a.decision = { ...a.decision, source: "jev", move: "hold", at: 0, seq: 1 };
    a.heading = "hold";
    s.frame(300);
    expect(a.heading).toBe("hold");
    s.frame(600);
    expect(a.heading).not.toBe("hold");
    expect(a.decision.source).toBe("heuristic");
    expect(a.decision.seq).toBe(1);
    expect(s.metrics.fallbacks).toBe(1);
  });

  it("drives heuristic bots entirely in code without network", () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 8, human: false, policy: "heuristic" }, fetch);
    for (let t = 0; t < 3000; t += 16) s.frame(t);
    expect(pending).toHaveLength(0);
    expect(s.metrics.requests).toBe(0);
    expect(s.metrics.decisions).toBeGreaterThan(8);
    expect(s.world.agents.every((a) => a.decision.source === "heuristic")).toBe(true);
  });

  it("delays answer application when a slow LLM is simulated", async () => {
    const { fetch, pending } = controlledFetch();
    let waited = 0;
    const s = new Swarm({ agentCount: 1, human: false, simulatedDelayMs: 2500 }, fetch, async (ms) => {
      waited += ms;
    });
    s.frame(0);
    pending[0].resolve(respond(pending[0].body, "E"));
    await flush();
    expect(waited).toBe(2500);
    expect(s.world.agents[0].heading).toBe("E");
  });

  it("reset rebuilds the same deterministic world and ignores answers from the old one", async () => {
    const { fetch, pending } = controlledFetch();
    const s = new Swarm({ agentCount: 6, agentsPerRequest: 6 }, fetch);
    const snapshot = s.world.agents.map((a) => [a.x, a.y]);
    for (let t = 0; t < 1000; t += 16) s.frame(t);
    expect(s.elapsedMs(1000)).toBe(1000);
    s.reset();
    expect(s.world.agents.map((a) => [a.x, a.y])).toEqual(snapshot);
    expect(s.metrics.requests).toBe(0);
    expect(s.elapsedMs(5000)).toBe(0);
    pending[0].resolve(respond(pending[0].body, "E"));
    await flush();
    expect(s.metrics.decisions).toBe(0);
    expect(s.metrics.stale).toBe(0);
    expect(s.world.agents.every((a) => a.decision.source === "none")).toBe(true);
  });
});

describe("Metrics", () => {
  it("computes percentiles, rates and cost from usage tokens", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([300, 100, 200], 50)).toBe(200);
    expect(percentile([300, 100, 200], 95)).toBe(300);
    const m = new Metrics();
    m.recordRequestStart();
    m.recordRequestStart();
    expect(m.inFlight).toBe(2);
    m.recordResponse(120, 5_000, 0, 1000);
    m.recordResponse(180, 5_000, 0, 2000);
    expect(m.inFlight).toBe(0);
    expect(m.lastLatency).toBe(180);
    expect(m.percentile(50)).toBe(120);
    for (let i = 0; i < 10; i++) m.recordDecision(2000);
    expect(m.decisionsPerSec(2000)).toBe(10);
    expect(m.tokensPerDecision()).toBe(1000);
    for (let i = 0; i < 10; i++) m.recordDecision(2000, false);
    expect(m.decisionsPerSec(2000)).toBe(20);
    expect(m.tokensPerDecision()).toBe(1000);
    expect(m.tokensPerMin(2000)).toBe(600_000);
    expect(m.usdPerHour(2000)).toBeCloseTo(600_000 * 60 * 0.042e-6, 8);
    expect(m.totalUsd()).toBeCloseTo(10_000 * 0.042e-6, 10);
    expect(m.decisionsPerSec(20_000)).toBe(0);
  });
});
