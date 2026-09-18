/** Jev 1.13 list price: $0.042 per million input tokens; output tokens are free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface RunStats {
  processed: number;
  total: number;
  errors: number;
  elapsedMs: number;
  perSecond: number;
  p50: number;
  p95: number;
  meanLatency: number;
  inputTokens: number;
  costUsd: number;
  judgments: number;
}

export const QUESTIONS_PER_EMAIL = 7;

export function computeStats(latencies: number[], inputTokens: number, elapsedMs: number, total: number, errors: number): RunStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const processed = latencies.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    processed,
    total,
    errors,
    elapsedMs,
    perSecond: elapsedMs > 0 ? processed / (elapsedMs / 1000) : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    meanLatency: processed ? sum / processed : 0,
    inputTokens,
    costUsd: inputTokens * USD_PER_INPUT_TOKEN,
    judgments: processed * QUESTIONS_PER_EMAIL,
  };
}

/** Incremental accumulator so the HUD can update per streamed result without re-sorting everything. */
export class LatencyTracker {
  private lat: number[] = [];
  tokens = 0;
  errors = 0;
  add(latencyMs: number, tokens: number) {
    this.lat.push(latencyMs);
    this.tokens += tokens;
  }
  stats(elapsedMs: number, total: number): RunStats {
    return computeStats(this.lat, this.tokens, elapsedMs, total, this.errors);
  }
  reset() {
    this.lat = [];
    this.tokens = 0;
    this.errors = 0;
  }
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
