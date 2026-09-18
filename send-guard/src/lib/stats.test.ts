import { describe, expect, it } from "vitest";
import { histogram, percentile, summarize } from "./stats";

describe("stats", () => {
  it("computes nearest-rank percentiles", () => {
    const v = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    expect(percentile(v, 50)).toBe(500);
    expect(percentile(v, 95)).toBe(1000);
    expect(percentile([], 50)).toBe(0);
  });

  it("summarizes latencies and judgments per second", () => {
    const s = summarize([100, 200], [10, 10]);
    expect(s.count).toBe(2);
    expect(s.mean).toBe(150);
    expect(s.judgmentsPerSecond).toBeCloseTo((20 / 300) * 1000);
    expect(summarize([], []).p50).toBe(0);
  });

  it("buckets a histogram and clamps outliers into the last bucket", () => {
    const h = histogram([10, 60, 70, 999], 50, 200);
    expect(h.map((b) => b.count)).toEqual([1, 2, 0, 1]);
    expect(h[3]).toEqual({ from: 150, to: 200, count: 1 });
  });
});
