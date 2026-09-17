import { buildBatchRequest, type BatchRequest } from "./perception.ts";
import { applyAnswer, applyDecision, heuristicDecision, parseAgentAnswers, refineHeading, type JevResponse } from "./decide.ts";
import { Metrics } from "./metrics.ts";
import { createWorld, step, type Agent, type World, type WorldOptions } from "./world.ts";

export interface SwarmSettings extends WorldOptions {
  /** ms between decision requests for one agent */
  decisionIntervalMs: number;
  /** agents whose perceptions share one HTTP request */
  agentsPerRequest: number;
  /** cap on concurrent HTTP requests */
  maxInFlight: number;
  /** artificial extra delay applied to every answer, to simulate a slow LLM */
  simulatedDelayMs: number;
  /** deterministic fallback after this long without any applied decision */
  fallbackAfterMs: number;
}

export const DEFAULT_SETTINGS: SwarmSettings = {
  seed: 7,
  agentCount: 32,
  policy: "jev",
  human: true,
  decisionIntervalMs: 400,
  agentsPerRequest: 8,
  maxInFlight: 12,
  simulatedDelayMs: 0,
  fallbackAfterMs: 4000,
};

export type JevFetch = (body: { state: unknown; questions: unknown }) => Promise<JevResponse>;

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super("rate limited");
  }
}

export async function fetchJev(body: { state: unknown; questions: unknown }): Promise<JevResponse> {
  const res = await fetch("/api/jev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429 || res.status === 529) {
    // the token-per-second bucket refills fast; without a Retry-After header pause briefly
    const ra = Number(res.headers.get("retry-after") ?? "0.4");
    throw new RateLimitError(Number.isFinite(ra) ? ra * 1000 : 400);
  }
  if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as JevResponse;
}

const FIXED_DT = 1 / 60;
/** How long a partial batch may wait for more due agents before it is sent anyway. */
export const BATCH_SLACK_MS = 150;

export class Swarm {
  world: World;
  metrics = new Metrics();
  settings: SwarmSettings;
  paused = false;
  private accumulator = 0;
  private lastFrame: number | null = null;
  private startedAt: number | null = null;
  private backoffUntil = 0;
  private fetchImpl: JevFetch;
  private delay: (ms: number) => Promise<void>;

  constructor(settings: Partial<SwarmSettings> = {}, fetchImpl: JevFetch = fetchJev, delay = sleep) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.world = createWorld(this.settings);
    this.fetchImpl = fetchImpl;
    this.delay = delay;
  }

  reset(settings: Partial<SwarmSettings> = {}): void {
    this.settings = { ...this.settings, ...settings };
    this.world = createWorld(this.settings);
    this.metrics = new Metrics();
    this.accumulator = 0;
    this.lastFrame = null;
    this.startedAt = null;
    this.backoffUntil = 0;
  }

  /** Wall-clock ms since the first frame of the current world. */
  elapsedMs(now: number): number {
    return this.startedAt === null ? 0 : now - this.startedAt;
  }

  get human(): Agent | undefined {
    return this.world.agents.find((a) => a.controller === "human");
  }

  /** Advance simulation with a fixed timestep; `now` is a wall-clock ms timestamp. */
  frame(now: number): void {
    if (this.lastFrame === null) this.lastFrame = now;
    if (this.startedAt === null) this.startedAt = now;
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.paused) return;
    this.accumulator += elapsed;
    while (this.accumulator >= FIXED_DT) {
      for (const a of this.world.agents) if (a.alive && a.controller !== "human") refineHeading(this.world, a);
      step(this.world, FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    this.schedule(now);
  }

  /** Decide which agents need a fresh decision and dispatch batched Jev requests. */
  schedule(now: number): void {
    const due: Agent[] = [];
    for (const a of this.world.agents) {
      if (!a.alive || a.controller === "human") continue;
      if (a.controller === "heuristic") {
        if (now - a.lastRequestAt >= this.settings.decisionIntervalMs) {
          a.lastRequestAt = now;
          a.seq++;
          applyDecision(a, { ...heuristicDecision(this.world, a), seq: a.seq }, now);
          this.metrics.recordDecision(now, false);
        }
        continue;
      }
      // deterministic fallback: never stall if the network is slow or failing
      const sinceDecision = now - (a.decision.at || 0);
      if (a.decision.source === "none" || sinceDecision > this.settings.fallbackAfterMs) {
        if (a.decision.source !== "none") this.metrics.fallbacks++;
        applyDecision(a, { ...heuristicDecision(this.world, a), seq: a.decision.seq }, now);
      }
      if (now - a.lastRequestAt >= this.settings.decisionIntervalMs && a.inFlight < 2) due.push(a);
    }
    if (due.length === 0 || now < this.backoffUntil) return;
    // oldest request first so no agent starves
    due.sort((a, b) => a.lastRequestAt - b.lastRequestAt);
    const size = Math.max(1, this.settings.agentsPerRequest);
    while (due.length > 0 && this.metrics.inFlight < this.settings.maxInFlight) {
      // send partial batches only once the oldest member has waited past the slack, so
      // the request rate stays near agents / (interval * batch) instead of one per frame
      if (due.length < size && now - due[0].lastRequestAt < this.settings.decisionIntervalMs + BATCH_SLACK_MS) break;
      const batch = due.splice(0, size);
      for (const a of batch) {
        a.lastRequestAt = now;
        a.seq++;
        a.inFlight++;
      }
      void this.dispatch(batch, now);
    }
  }

  private async dispatch(batch: Agent[], now: number): Promise<void> {
    const seqs = new Map(batch.map((a) => [a.id, a.seq]));
    const world = this.world;
    const req: BatchRequest = buildBatchRequest(world, batch);
    this.metrics.recordRequestStart();
    const t0 = now;
    try {
      const res = await this.fetchImpl({ state: req.state, questions: req.questions });
      const latency = performance.now() - t0;
      if (this.settings.simulatedDelayMs > 0) await this.delay(this.settings.simulatedDelayMs);
      const at = performance.now();
      // answers for a world that has since been reset belong to nobody
      if (world !== this.world) return;
      this.metrics.recordResponse(latency, res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0, at);
      for (const a of batch) {
        a.inFlight = Math.max(0, a.inFlight - 1);
        const parsed = parseAgentAnswers(res.answers ?? {}, a.id, req.targets[a.id] ?? []);
        const r = applyAnswer(this.world, a, seqs.get(a.id) ?? 0, parsed, at);
        if (r.applied) {
          this.metrics.recordDecision(at);
          if (r.reason === "fallback") this.metrics.fallbacks++;
        } else if (r.reason === "stale") this.metrics.stale++;
      }
    } catch (err) {
      if (world !== this.world) return;
      const rl = err instanceof RateLimitError;
      this.metrics.recordError(rl);
      if (rl) this.backoffUntil = performance.now() + Math.min(5000, err.retryAfterMs);
      // agents keep acting on their last decision; schedule() falls back to the heuristic
      // only if no fresh answer arrives within fallbackAfterMs
      for (const a of batch) a.inFlight = Math.max(0, a.inFlight - 1);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
