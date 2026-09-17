import { describe, expect, it } from "vitest";
import { generateCatalog } from "./catalog.ts";
import { createIndex, MAX_PER_TYPE, processTerm, search, stem, TOP_K } from "./retriever.ts";

const catalog = generateCatalog();
const index = createIndex(catalog);
const byId = new Map(catalog.map((p) => [p.id, p]));

describe("retriever", () => {
  it("returns at most TOP_K hits, normalized to the top score", () => {
    const hits = search(index, byId, "headphones");
    expect(hits.length).toBe(TOP_K);
    expect(hits[0].norm).toBe(1);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
      expect(hits[i].norm).toBeLessThanOrEqual(1);
      expect(hits[i].norm).toBeGreaterThan(0);
    }
  });

  it("returns nothing for an empty query", () => {
    expect(search(index, byId, "")).toEqual([]);
    expect(search(index, byId, "   ")).toEqual([]);
  });

  it("matches prefixes while typing", () => {
    const hits = search(index, byId, "keyb");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.slice(0, 5).every((h) => /keyboard/i.test(h.product.title))).toBe(true);
  });

  it("is fast enough for a keystroke budget", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) search(index, byId, "cheap headphones that dont leak sound");
    const perQuery = (performance.now() - t0) / 20;
    expect(perQuery).toBeLessThan(25);
  });

  it("stems so 'hike' reaches 'hiking' and never returns more than MAX_PER_TYPE of one product type", () => {
    expect(stem("hiking")).toBe(stem("hike"));
    expect(stem("leaks")).toBe(stem("leaking"));
    expect(processTerm("the")).toBeNull();
    const hits = search(index, byId, "something to keep coffee hot on a hike");
    const perType = new Map<string, number>();
    for (const h of hits) perType.set(h.product.type, (perType.get(h.product.type) ?? 0) + 1);
    expect(Math.max(...perType.values())).toBeLessThanOrEqual(MAX_PER_TYPE);
    expect(perType.size).toBeGreaterThanOrEqual(3);
    expect(hits.some((h) => h.product.type === "Vacuum Bottle")).toBe(true);
  });

  it("is deterministic", () => {
    const a = search(index, byId, "gift for a 6 yr old who likes space").map((h) => h.product.id);
    const b = search(index, byId, "gift for a 6 yr old who likes space").map((h) => h.product.id);
    expect(a).toEqual(b);
  });
});
