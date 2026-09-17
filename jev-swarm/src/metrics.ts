/** Price per input token for jev-1.13 (docs.typesafe.ai/models: $0.042 per Mtok, output free). */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export class Metrics {
  latencies: number[] = [];
  lastLatency = 0;
  requests = 0;
  errors = 0;
  rateLimited = 0;
  inFlight = 0;
  decisions = 0;
  /** decisions that came back from Jev (heuristic-bot decisions are counted in `decisions` only) */
  jevDecisions = 0;
  stale = 0;
  fallbacks = 0;
  inputTokens = 0;
  outputTokens = 0;
  private decisionTimes: number[] = [];
  private tokenEvents: { at: number; tokens: number }[] = [];
  private startedAt: number | null = null;

  recordRequestStart(): void {
    this.inFlight++;
    this.requests++;
  }

  recordResponse(latencyMs: number, inputTokens: number, outputTokens: number, now: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.lastLatency = latencyMs;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 300) this.latencies.shift();
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.tokenEvents.push({ at: now, tokens: inputTokens });
    if (this.startedAt === null) this.startedAt = now;
  }

  recordError(rateLimited: boolean): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.errors++;
    if (rateLimited) this.rateLimited++;
  }

  recordDecision(now: number, fromJev = true): void {
    this.decisions++;
    if (fromJev) this.jevDecisions++;
    this.decisionTimes.push(now);
  }

  tokensPerDecision(): number {
    return this.jevDecisions ? this.inputTokens / this.jevDecisions : 0;
  }

  /** Decisions applied in the trailing `windowMs`, scaled to per second. */
  decisionsPerSec(now: number, windowMs = 5000): number {
    const cutoff = now - windowMs;
    while (this.decisionTimes.length && this.decisionTimes[0] < cutoff) this.decisionTimes.shift();
    const span = Math.min(windowMs, this.startedAt === null ? windowMs : Math.max(1000, now - this.startedAt));
    return (this.decisionTimes.length * 1000) / span;
  }

  tokensPerMin(now: number, windowMs = 30000): number {
    const cutoff = now - windowMs;
    while (this.tokenEvents.length && this.tokenEvents[0].at < cutoff) this.tokenEvents.shift();
    const span = Math.min(windowMs, this.startedAt === null ? windowMs : Math.max(1000, now - this.startedAt));
    const sum = this.tokenEvents.reduce((s, e) => s + e.tokens, 0);
    return (sum * 60000) / span;
  }

  usdPerHour(now: number): number {
    return this.tokensPerMin(now) * 60 * USD_PER_INPUT_TOKEN;
  }

  totalUsd(): number {
    return this.inputTokens * USD_PER_INPUT_TOKEN;
  }

  percentile(p: number): number {
    return percentile(this.latencies, p);
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
