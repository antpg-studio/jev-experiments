import { describe, expect, it } from "vitest";
import { createGenerator, mulberry32, type Category } from "./generator.ts";

describe("generator", () => {
  it("is deterministic for the same seed", () => {
    const a = createGenerator(42);
    const b = createGenerator(42);
    const xs = Array.from({ length: 500 }, () => a.next());
    const ys = Array.from({ length: 500 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it("differs across seeds", () => {
    const a = createGenerator(1);
    const b = createGenerator(2);
    const xs = Array.from({ length: 50 }, () => a.next().text);
    const ys = Array.from({ length: 50 }, () => b.next().text);
    expect(xs).not.toEqual(ys);
  });

  it("numbers messages sequentially with stable ids", () => {
    const g = createGenerator(7);
    const m1 = g.next();
    const m2 = g.next();
    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
    expect(m1.id).toBe("7-1");
  });

  it("fills templates and covers every category and several languages", () => {
    const g = createGenerator(3);
    const seen = new Set<Category>();
    const langs = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const m = g.next();
      expect(m.text).not.toMatch(/\{(emote|game|user)\}/);
      expect(m.text.length).toBeGreaterThan(0);
      seen.add(m.category);
      langs.add(m.lang);
    }
    expect(seen.size).toBe(9);
    expect(langs.size).toBeGreaterThanOrEqual(8);
  });

  it("mulberry32 yields values in [0,1) and repeats per seed", () => {
    const r1 = mulberry32(99);
    const r2 = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(r2()).toBe(v);
    }
  });
});
