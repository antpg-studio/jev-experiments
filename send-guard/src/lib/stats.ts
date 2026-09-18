export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  judgmentsPerSecond: number;
}

export function summarize(latencies: number[], judgments: number[]): Summary {
  const count = latencies.length;
  if (count === 0) return { count: 0, p50: 0, p95: 0, min: 0, max: 0, mean: 0, judgmentsPerSecond: 0 };
  const totalMs = latencies.reduce((a, b) => a + b, 0);
  const totalJudgments = judgments.reduce((a, b) => a + b, 0);
  return {
    count,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    min: Math.min(...latencies),
    max: Math.max(...latencies),
    mean: totalMs / count,
    judgmentsPerSecond: totalMs > 0 ? (totalJudgments / totalMs) * 1000 : 0,
  };
}

export interface Bucket {
  from: number;
  to: number;
  count: number;
}

export function histogram(values: number[], bucketMs: number, maxMs: number): Bucket[] {
  const n = Math.ceil(maxMs / bucketMs);
  const buckets: Bucket[] = Array.from({ length: n }, (_, i) => ({ from: i * bucketMs, to: (i + 1) * bucketMs, count: 0 }));
  for (const v of values) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(v / bucketMs)));
    buckets[i].count++;
  }
  return buckets;
}
