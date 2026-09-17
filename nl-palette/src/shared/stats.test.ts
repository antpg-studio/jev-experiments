import { describe, expect, it } from "vitest";
import { mean, percentile, summarize } from "./stats.ts";

describe("stats", () => {
  it("handles empty input", () => {
    expect(mean([])).toBe(0);
    expect(percentile([], 50)).toBe(0);
    expect(summarize([]).count).toBe(0);
  });
  it("computes mean and percentiles", () => {
    const v = [100, 200, 300, 400, 500];
    expect(mean(v)).toBe(300);
    expect(percentile(v, 50)).toBe(300);
    expect(percentile(v, 0)).toBe(100);
    expect(percentile(v, 100)).toBe(500);
    expect(percentile(v, 95)).toBe(480);
  });
  it("summarizes", () => {
    const s = summarize([3, 1, 2]);
    expect(s).toEqual({ count: 3, mean: 2, p50: 2, p95: 2.9, min: 1, max: 3 });
  });
});
