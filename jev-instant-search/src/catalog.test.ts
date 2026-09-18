import { describe, expect, it } from "vitest";
import { CATALOG_SIZE, CATEGORIES, catalogFingerprint, generateCatalog } from "./catalog.ts";

describe("catalog", () => {
  const a = generateCatalog();
  const b = generateCatalog();

  it("is deterministic for the same seed", () => {
    expect(a.length).toBe(CATALOG_SIZE);
    expect(catalogFingerprint(a)).toBe(catalogFingerprint(b));
    expect(JSON.stringify(a.slice(0, 50))).toBe(JSON.stringify(b.slice(0, 50)));
  });

  it("changes with a different seed", () => {
    expect(catalogFingerprint(generateCatalog(CATALOG_SIZE, 1))).not.toBe(catalogFingerprint(a));
  });

  it("has unique ids, valid categories, and sane prices/ratings", () => {
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
    for (const p of a) {
      expect(CATEGORIES).toContain(p.category);
      expect(p.price).toBeGreaterThan(0);
      expect(p.rating).toBeGreaterThanOrEqual(1);
      expect(p.rating).toBeLessThanOrEqual(5);
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it("covers every category with hundreds of products", () => {
    for (const c of CATEGORIES) expect(a.filter((p) => p.category === c).length).toBeGreaterThan(500);
  });
});
