import { describe, expect, it } from "vitest";
import { LatencyTracker, computeStats, fmtMs, fmtUsd, percentile, QUESTIONS_PER_EMAIL, USD_PER_INPUT_TOKEN } from "./stats";

describe("percentile", () => {
  it("handles empty and single-element inputs", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([42], 95)).toBe(42);
  });

  it("uses nearest-rank on a sorted array", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 100)).toBe(100);
  });
});

describe("computeStats", () => {
  it("derives throughput, cost and judgment count from measured inputs", () => {
    const s = computeStats([100, 300, 200, 150], 4000, 2000, 10, 1);
    expect(s.processed).toBe(4);
    expect(s.total).toBe(10);
    expect(s.errors).toBe(1);
    expect(s.perSecond).toBe(2);
    expect(s.p50).toBe(150);
    expect(s.p95).toBe(300);
    expect(s.meanLatency).toBe(187.5);
    expect(s.costUsd).toBeCloseTo(4000 * USD_PER_INPUT_TOKEN, 12);
    expect(s.judgments).toBe(4 * QUESTIONS_PER_EMAIL);
  });

  it("does not divide by zero before the first result", () => {
    const s = computeStats([], 0, 0, 500, 0);
    expect(s.perSecond).toBe(0);
    expect(s.meanLatency).toBe(0);
    expect(s.p95).toBe(0);
  });
});

describe("LatencyTracker", () => {
  it("accumulates and resets", () => {
    const t = new LatencyTracker();
    t.add(120, 1000);
    t.add(180, 1200);
    t.errors = 1;
    const s = t.stats(1000, 3);
    expect(s.processed).toBe(2);
    expect(s.inputTokens).toBe(2200);
    expect(s.errors).toBe(1);
    t.reset();
    expect(t.stats(1000, 3).processed).toBe(0);
    expect(t.tokens).toBe(0);
  });
});

describe("formatting", () => {
  it("formats ms and usd", () => {
    expect(fmtMs(0)).toBe("0 ms");
    expect(fmtMs(161.4)).toBe("161 ms");
    expect(fmtMs(4120)).toBe("4.12 s");
    expect(fmtUsd(0.0256)).toBe("$0.03");
    expect(fmtUsd(0.0004)).toBe("$0.0004");
  });
});
