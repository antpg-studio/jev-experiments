// Small numeric helpers for the top strip and the histogram. Pure, no DOM.

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export class Ring {
  private buf: number[];
  private i = 0;
  private n = 0;
  constructor(private cap: number) {
    this.buf = Array.from({ length: cap }, () => 0);
  }
  push(v: number) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }
  get size() {
    return this.n;
  }
  values(): number[] {
    return this.n < this.cap ? this.buf.slice(0, this.n) : this.buf.slice();
  }
  sorted(): number[] {
    return this.values().sort((a, b) => a - b);
  }
  last(): number {
    return this.n === 0 ? 0 : this.buf[(this.i - 1 + this.cap) % this.cap];
  }
}

/** Weighted events-per-second over a sliding window, from timestamps in ms. */
export class RateMeter {
  private marks: { t: number; w: number }[] = [];
  private sum = 0;
  constructor(private windowMs = 2000) {}
  mark(now: number, weight = 1) {
    if (weight <= 0) return;
    this.marks.push({ t: now, w: weight });
    this.sum += weight;
  }
  rate(now: number): number {
    const cutoff = now - this.windowMs;
    let drop = 0;
    while (drop < this.marks.length && this.marks[drop].t < cutoff) this.sum -= this.marks[drop++].w;
    if (drop) this.marks.splice(0, drop);
    return (this.sum * 1000) / this.windowMs;
  }
}

/** Log-spaced latency buckets from 25 ms to ~6.4 s; the last bucket is open-ended. */
export const HIST_EDGES = [0, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200, 4800, 6400];

export function histogram(values: readonly number[], edges: readonly number[] = HIST_EDGES): number[] {
  const bins = Array.from({ length: edges.length }, () => 0);
  for (const v of values) {
    let b = edges.length - 1;
    for (let i = 1; i < edges.length; i++) {
      if (v < edges[i]) {
        b = i - 1;
        break;
      }
    }
    bins[b]++;
  }
  return bins;
}

export function costPerHourUsd(tokensPerSec: number, usdPerToken: number): number {
  return tokensPerSec * 3600 * usdPerToken;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMs(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}`;
}

/** 7,447,923 -> "7.45M", 12,088 -> "12.1k" */
export function fmtCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return fmtInt(n);
}
