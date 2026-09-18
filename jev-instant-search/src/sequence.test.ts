import { describe, expect, it } from "vitest";
import { InFlightLimiter, LatencyStats, SequenceGate } from "./sequence.ts";

describe("SequenceGate", () => {
  it("accepts answers in order", () => {
    const g = new SequenceGate();
    const s0 = g.issue();
    const s1 = g.issue();
    expect(g.accept(s0)).toBe(true);
    expect(g.accept(s1)).toBe(true);
    expect(g.paintedSeq).toBe(1);
    expect(g.discardedCount).toBe(0);
  });

  it("discards a stale answer that arrives after a newer one was painted", () => {
    const g = new SequenceGate();
    const slow = g.issue();
    const fast = g.issue();
    expect(g.accept(fast)).toBe(true);
    expect(g.accept(slow)).toBe(false);
    expect(g.paintedSeq).toBe(fast);
    expect(g.discardedCount).toBe(1);
  });

  it("allows skipping ahead when intermediate keystrokes never answered", () => {
    const g = new SequenceGate();
    g.issue();
    g.issue();
    const s2 = g.issue();
    expect(g.isStale(s2)).toBe(false);
    expect(g.accept(s2)).toBe(true);
    expect(g.accept(0)).toBe(false);
    expect(g.accept(1)).toBe(false);
    expect(g.discardedCount).toBe(2);
  });

  it("rejects the same sequence twice", () => {
    const g = new SequenceGate();
    const s = g.issue();
    expect(g.accept(s)).toBe(true);
    expect(g.accept(s)).toBe(false);
  });
});

describe("LatencyStats", () => {
  it("tracks last / p50 / p95", () => {
    const s = new LatencyStats();
    [120, 150, 170, 160, 900, 140, 155, 165, 145, 150].forEach((v) => s.push(v));
    expect(s.last).toBe(150);
    expect(s.count).toBe(10);
    expect(s.p50).toBe(150);
    expect(s.p95).toBe(900);
    expect(s.percentile(0)).toBe(120);
  });

  it("returns zeros when empty and bounds its window", () => {
    const s = new LatencyStats(3);
    expect(s.p50).toBe(0);
    [1, 2, 3, 100].forEach((v) => s.push(v));
    expect(s.percentile(0)).toBe(2);
  });
});

describe("InFlightLimiter", () => {
  it("caps concurrency, keeps only the newest held request, and runs it when a slot frees", () => {
    const l = new InFlightLimiter(2);
    const started: string[] = [];
    const start = (name: string) => () => { started.push(name); return true; };
    expect(l.run(start("a"))).toBe(true);
    expect(l.run(start("b"))).toBe(true);
    expect(l.run(start("c"))).toBe(false);
    expect(l.run(start("d"))).toBe(false);
    expect(l.inFlight).toBe(2);
    expect(l.supersededCount).toBe(1);
    expect(started).toEqual(["a", "b"]);
    l.done();
    expect(started).toEqual(["a", "b", "d"]);
    expect(l.inFlight).toBe(2);
    l.done();
    l.done();
    expect(l.inFlight).toBe(0);
  });

  it("does not count a declined start as in flight", () => {
    const l = new InFlightLimiter(1);
    l.run(() => true);
    l.run(() => false);
    l.done();
    expect(l.inFlight).toBe(0);
  });
});
