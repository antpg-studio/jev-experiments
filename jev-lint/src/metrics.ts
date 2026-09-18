// Latency / throughput / cost bookkeeping. Pure data + math.

/** USD per input token: $42 per billion tokens (docs.typesafe.ai/models). Output tokens are free. */
export const USD_PER_INPUT_TOKEN = 42 / 1e9;

export interface Sample {
  at: number;
  ms: number;
  questions: number;
  inputTokens: number;
  outputTokens: number;
}

export interface MetricsSnapshot {
  requests: number;
  failures: number;
  lastMs: number | null;
  p50: number | null;
  p95: number | null;
  /** questions answered in the trailing 60 s */
  judgmentsPerMin: number;
  /** questions answered per second over the trailing 10 s */
  decisionsPerSec: number;
  inputTokens: number;
  outputTokens: number;
  tokensPerJudgment: number | null;
  costUsd: number;
  /** extrapolated from the trailing-60 s spend */
  costPerHourUsd: number;
  inFlight: number;
}

export function percentile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

export class Metrics {
  private samples: Sample[] = [];
  failures = 0;
  inFlight = 0;
  private totalQuestions = 0;
  private totalIn = 0;
  private totalOut = 0;
  private readonly keep: number;

  constructor(keep = 500) {
    this.keep = keep;
  }

  record(s: Sample): void {
    this.samples.push(s);
    if (this.samples.length > this.keep) this.samples.shift();
    this.totalQuestions += s.questions;
    this.totalIn += s.inputTokens;
    this.totalOut += s.outputTokens;
  }

  snapshot(now = Date.now()): MetricsSnapshot {
    const recent = this.samples.filter((s) => now - s.at <= 60_000);
    const recentQ = recent.reduce((n, s) => n + s.questions, 0);
    const recentTokens = recent.reduce((n, s) => n + s.inputTokens, 0);
    const last10 = recent.filter((s) => now - s.at <= 10_000).reduce((n, s) => n + s.questions, 0);
    const ms = this.samples.map((s) => s.ms);
    const last = this.samples.at(-1);
    return {
      requests: this.samples.length,
      failures: this.failures,
      lastMs: last ? last.ms : null,
      p50: percentile(ms, 0.5),
      p95: percentile(ms, 0.95),
      judgmentsPerMin: recentQ,
      decisionsPerSec: last10 / 10,
      inputTokens: this.totalIn,
      outputTokens: this.totalOut,
      tokensPerJudgment: this.totalQuestions > 0 ? this.totalIn / this.totalQuestions : null,
      costUsd: this.totalIn * USD_PER_INPUT_TOKEN,
      costPerHourUsd: recentTokens * USD_PER_INPUT_TOKEN * 60,
      inFlight: this.inFlight,
    };
  }

  reset(): void {
    this.samples = [];
    this.failures = 0;
    this.totalQuestions = 0;
    this.totalIn = 0;
    this.totalOut = 0;
  }
}

export function fmtMs(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}`;
}

export function fmtUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(3)}`;
}
