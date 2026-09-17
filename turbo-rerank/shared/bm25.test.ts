import { describe, expect, it } from "vitest";
import { Bm25Index, stem, tokenize } from "./bm25.ts";

describe("tokenize", () => {
  it("lowercases, strips punctuation and stopwords", () => {
    expect(tokenize("The Deploys, are FAILING!")).toEqual(["deploy", "fail"]);
  });
  it("stems common suffixes", () => {
    expect(stem("policies")).toBe("policy");
    expect(stem("deployed")).toBe("deploy");
    expect(stem("rotations")).toBe("rotation");
    expect(stem("access")).toBe("access");
  });
});

describe("Bm25Index", () => {
  const docs = [
    { id: "a", text: "on-call rotation schedule for the platform team" },
    { id: "b", text: "secret rotation happens every ninety days; rotation is automated" },
    { id: "c", text: "parental leave policy" },
    { id: "d", text: "rotation rotation rotation rotation rotation rotation rotation rotation rotation" },
  ];
  const index = new Bm25Index(docs);

  it("returns only matching docs, best first", () => {
    const hits = index.search("parental leave");
    expect(hits.map((h) => h.id)).toEqual(["c"]);
  });

  it("rewards rare terms over frequent ones", () => {
    const hits = index.search("on-call rotation");
    expect(hits[0].id).toBe("a");
  });

  it("saturates term frequency", () => {
    const hits = index.search("rotation");
    const d = hits.find((h) => h.id === "d")!;
    const b = hits.find((h) => h.id === "b")!;
    expect(d.score).toBeLessThan(b.score * 2);
  });

  it("respects k", () => {
    expect(index.search("rotation", 2)).toHaveLength(2);
  });

  it("returns nothing for an empty query", () => {
    expect(index.search("")).toEqual([]);
  });
});
