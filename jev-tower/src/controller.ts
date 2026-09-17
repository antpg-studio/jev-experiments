import type { Aircraft, Instruction, Mode } from "./types.ts";
import { INSTRUCTION_COOLDOWN_S } from "./types.ts";
import type { Sim } from "./engine.ts";
import { FIX_MAP } from "./world.ts";
import { ruleCandidates, urgencyFor } from "./rules.ts";
import { resolves, selectValidInstruction, validateInstruction } from "./validate.ts";
import { LatencyStats, USD_PER_INPUT_TOKEN, buildRequest, callJev, candidateState, isStale, parseAnswers, type CandidateState, type ParsedAnswer } from "./jev.ts";

export interface Telemetry {
  latency: LatencyStats;
  requests: number;
  inFlight: number;
  stale: number;
  errors: number;
  lastError: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  decisionTimes: number[];
  model: string | null;
}

export function newTelemetry(): Telemetry {
  return {
    latency: new LatencyStats(),
    requests: 0,
    inFlight: 0,
    stale: 0,
    errors: 0,
    lastError: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    decisionTimes: [],
    model: null,
  };
}

export function decisionsPerSecond(t: Telemetry, nowMs: number, windowMs = 10_000): number {
  const cutoff = nowMs - windowMs;
  while (t.decisionTimes.length && t.decisionTimes[0] < cutoff) t.decisionTimes.shift();
  return t.decisionTimes.length / (windowMs / 1000);
}

export const SLOW_LLM_DELAY_MS = 2500;
const ASK_INTERVAL_MS = 1000;
const RULES_REEVAL_S = 5;
const MAX_IN_FLIGHT = 4;
const MIN_CONFIDENCE = 0.15;
/** Within this many seconds of a predicted loss, an instruction must measurably push the loss out to be accepted. */
const URGENT_S = 60;

interface Pending {
  seq: number;
  simTime: number;
  ids: number[];
}

export interface ControllerOptions {
  /** Wall clock in ms; injectable for tests. */
  now?: () => number;
  slowDelayMs?: number;
  /** Transport for Jev requests; injectable for tests and headless runs. */
  call?: typeof callJev;
}

/**
 * Drives one control policy against the sim. `tick` is called once per sim tick; network answers arrive
 * asynchronously and are applied on arrival if they are not stale.
 */
export class Controller {
  private seq = 0;
  private lastApplied = new Map<number, number>();
  private lastAsked = new Map<number, number>();
  private lastRuled = new Map<number, number>();
  private disposed = false;
  private abort = new AbortController();

  private readonly now: () => number;
  private readonly slowDelayMs: number;
  private readonly call: typeof callJev;

  constructor(
    readonly mode: Mode,
    private readonly sim: Sim,
    readonly telemetry: Telemetry,
    opts: ControllerOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.slowDelayMs = opts.slowDelayMs ?? SLOW_LLM_DELAY_MS;
    this.call = opts.call ?? callJev;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
  }

  tick(): void {
    if (this.disposed) return;
    if (this.mode === "rules") this.tickRules();
    else if (this.mode === "jev") this.tickJev();
    else this.tickSlow();
  }

  private eligibleSoon(ac: Aircraft): boolean {
    return this.sim.t - ac.instructionAt >= INSTRUCTION_COOLDOWN_S - 2;
  }

  private tickRules(): void {
    const t0 = this.now();
    for (const ac of this.sim.candidates()) {
      const others = this.sim.aircraft.filter((o) => o.id !== ac.id);
      const mine = this.sim.conflictsOf(ac.id);
      const tLoss = mine.length ? Math.min(...mine.map((c) => c.tLoss)) : null;
      this.setJudgement(ac.id, urgencyFor(tLoss), tLoss === null && ac.vectorHdg === null ? 1 : 0);
      if (this.sim.t - ac.instructionAt < INSTRUCTION_COOLDOWN_S) continue;
      if (this.sim.t - (this.lastRuled.get(ac.id) ?? -Infinity) < RULES_REEVAL_S) continue;
      const pick = this.pickRule(ac, others);
      if (pick) {
        this.lastRuled.set(ac.id, this.sim.t);
        this.sim.apply(ac.id, pick, "rules");
        this.telemetry.decisionTimes.push(this.now());
      }
    }
    this.telemetry.latency.push(this.now() - t0);
  }

  private tickJev(): void {
    if (this.telemetry.inFlight >= MAX_IN_FLIGHT) return;
    const nowMs = this.now();
    const ask = this.sim.candidates().filter((ac) => {
      const last = this.lastAsked.get(ac.id) ?? -Infinity;
      return nowMs - last >= ASK_INTERVAL_MS && this.eligibleSoon(ac);
    });
    if (ask.length === 0) return;
    void this.send(ask, 0);
  }

  private tickSlow(): void {
    if (this.telemetry.inFlight > 0) return;
    // A chat-style LLM agent handles one aircraft per call, most urgent first.
    const byUrgency = this.sim
      .candidates()
      .filter((ac) => this.eligibleSoon(ac))
      .map((ac) => {
        const mine = this.sim.conflictsOf(ac.id);
        return { ac, tLoss: mine.length ? Math.min(...mine.map((c) => c.tLoss)) : Infinity };
      })
      .sort((a, b) => a.tLoss - b.tLoss);
    if (byUrgency.length === 0) return;
    void this.send([byUrgency[0].ac], this.slowDelayMs);
  }

  private async send(aircraft: Aircraft[], extraDelayMs: number): Promise<void> {
    const byId = this.sim.byId();
    const states: CandidateState[] = aircraft.map((ac) => candidateState(ac, this.sim.conflicts, byId, this.sim.t, FIX_MAP));
    const pending: Pending = { seq: ++this.seq, simTime: this.sim.t, ids: aircraft.map((a) => a.id) };
    const started = this.now();
    for (const id of pending.ids) this.lastAsked.set(id, started);
    this.telemetry.inFlight++;
    this.telemetry.requests++;
    try {
      const resp = await this.call(buildRequest(states), this.abort.signal);
      if (extraDelayMs > 0) await new Promise((r) => setTimeout(r, extraDelayMs));
      if (this.disposed) return;
      const latency = this.now() - started;
      this.telemetry.latency.push(latency);
      this.telemetry.model = resp.model;
      this.telemetry.inputTokens += resp.usage.input_tokens;
      this.telemetry.outputTokens += resp.usage.output_tokens;
      this.telemetry.costUsd += resp.usage.input_tokens * USD_PER_INPUT_TOKEN;
      const parsed = parseAnswers(resp, states.length);
      parsed.forEach((answer, i) => this.consume(pending, pending.ids[i], answer));
    } catch (err) {
      if (this.disposed) return;
      this.telemetry.errors++;
      this.telemetry.lastError = err instanceof Error ? err.message : String(err);
      // Deterministic fallback so the sector never goes unattended.
      for (const id of pending.ids) this.fallbackToRules(id);
    } finally {
      this.telemetry.inFlight = Math.max(0, this.telemetry.inFlight - 1);
    }
  }

  private consume(pending: Pending, id: number, answer: ParsedAnswer): void {
    if (isStale(pending.seq, this.lastApplied.get(id), pending.simTime, this.sim.t)) {
      this.telemetry.stale++;
      return;
    }
    const ac = this.sim.find(id);
    if (!ac) return;
    this.lastApplied.set(id, pending.seq);
    this.setJudgement(id, answer.urgency, answer.handoff);
    if (this.sim.t - ac.instructionAt < INSTRUCTION_COOLDOWN_S) return;
    if (answer.choice === null || answer.confidence < MIN_CONFIDENCE) {
      this.fallbackToRules(id);
      return;
    }
    const others = this.sim.aircraft.filter((o) => o.id !== id);
    const worst = this.sim.conflictsOf(id).sort((x, y) => x.tLoss - y.tLoss)[0];
    const urgentWith = worst && worst.tLoss < URGENT_S ? (worst.a === id ? worst.b : worst.a) : null;
    const sel = selectValidInstruction(answer.probabilities, (i) => {
      const v = validateInstruction(ac, i, others, this.sim.t, FIX_MAP);
      if (!v.ok || urgentWith === null) return v;
      return resolves(ac, i, urgentWith, others, this.sim.t, FIX_MAP) ? v : { ok: false, reason: "no_gain" };
    });
    const note = sel.fellBack && answer.choice !== sel.instruction ? `(Jev chose ${answer.choice}: ${sel.rejected[answer.choice] ?? "invalid"})` : undefined;
    this.sim.apply(id, sel.instruction, this.mode, note);
    this.telemetry.decisionTimes.push(this.now());
  }

  /** First valid rule candidate that actually resolves the worst conflict; null when nothing helps. */
  private pickRule(ac: Aircraft, others: Aircraft[]): Instruction | null {
    const ranked = ruleCandidates(ac, this.sim.conflicts, this.sim.byId());
    const valid = ranked.filter((i) => validateInstruction(ac, i, others, this.sim.t, FIX_MAP).ok);
    if (valid.length === 0) return null;
    const worst = this.sim.conflictsOf(ac.id).sort((x, y) => x.tLoss - y.tLoss)[0];
    if (!worst) return valid[0];
    const otherId = worst.a === ac.id ? worst.b : worst.a;
    return valid.find((i) => i !== "maintain" && resolves(ac, i, otherId, others, this.sim.t, FIX_MAP)) ?? null;
  }

  private fallbackToRules(id: number): void {
    const ac = this.sim.find(id);
    if (!ac || this.sim.t - ac.instructionAt < INSTRUCTION_COOLDOWN_S) return;
    const others = this.sim.aircraft.filter((o) => o.id !== id);
    const pick = this.pickRule(ac, others);
    if (!pick) return;
    this.sim.apply(id, pick, "rules", pick === "maintain" ? undefined : "(heuristic fallback)");
    this.telemetry.decisionTimes.push(this.now());
  }

  private setJudgement(id: number, urgency: number, handoff: number): void {
    const i = this.sim.aircraft.findIndex((a) => a.id === id);
    if (i >= 0) this.sim.aircraft[i] = { ...this.sim.aircraft[i], urgency, handoff };
  }
}
