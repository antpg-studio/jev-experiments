import type { Accuracy } from "../shared/types.ts";

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Fixed-size ring of latency samples with cheap percentile queries. */
export class LatencyWindow {
  private samples: number[] = [];
  constructor(private size = 500) {}
  push(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }
  get last(): number {
    return this.samples[this.samples.length - 1] ?? 0;
  }
  get count(): number {
    return this.samples.length;
  }
  percentiles(): { p50: number; p95: number; p99: number } {
    const s = [...this.samples].sort((a, b) => a - b);
    return { p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99) };
  }
}

/** Counts timestamps inside a sliding window to compute a rate per second. */
export class RateMeter {
  private stamps: number[] = [];
  constructor(private windowMs = 5000) {}
  mark(now = Date.now(), n = 1): void {
    for (let i = 0; i < n; i++) this.stamps.push(now);
    this.prune(now);
  }
  perSecond(now = Date.now()): number {
    this.prune(now);
    return (this.stamps.length * 1000) / this.windowMs;
  }
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] < cutoff) i++;
    if (i) this.stamps.splice(0, i);
  }
}

export class Confusion {
  tp = 0;
  fp = 0;
  fn = 0;
  tn = 0;
  record(predicted: boolean, truth: boolean): void {
    if (predicted && truth) this.tp++;
    else if (predicted && !truth) this.fp++;
    else if (!predicted && truth) this.fn++;
    else this.tn++;
  }
  snapshot(): Accuracy {
    const precision = this.tp + this.fp ? this.tp / (this.tp + this.fp) : 0;
    const recall = this.tp + this.fn ? this.tp / (this.tp + this.fn) : 0;
    return { tp: this.tp, fp: this.fp, fn: this.fn, tn: this.tn, precision, recall };
  }
}
