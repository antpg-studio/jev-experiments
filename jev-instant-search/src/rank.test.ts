import { describe, expect, it } from "vitest";
import type { Product } from "./catalog.ts";
import { heuristicQueryJudgment, type ParsedAnswers, type QueryJudgment, type RelevanceAnswer } from "./jev.ts";
import { combine, DEFAULT_WEIGHTS, GATE, lexicalOnly } from "./rank.ts";
import type { LexicalHit } from "./retriever.ts";

function product(id: string, price: number, rating: number, description = "A product."): Product {
  return { id, title: `Item ${id}`, description, category: "electronics", price, rating, attributes: {} } as Product;
}

function hit(p: Product, norm: number): LexicalHit {
  return { product: p, score: norm * 10, norm };
}

function rel(score: number): RelevanceAnswer {
  const probabilities = [0, 0, 0, 0, 0];
  probabilities[Math.round(score)] = 1;
  return { score, confidence: 0.9, probabilities };
}

const A = product("a", 10, 4.0);
const B = product("b", 50, 4.8, "Great gift for kids ages 6+.");
const C = product("c", 200, 3.2);
const hits = [hit(A, 1), hit(B, 0.6), hit(C, 0.3)];

function answers(relevance: Record<string, number>, q: Partial<QueryJudgment> = {}): ParsedAnswers {
  return {
    relevance: new Map(Object.entries(relevance).map(([id, s]) => [id, rel(s)])),
    query: { ...heuristicQueryJudgment(""), ...q },
    model: "test",
    inputTokens: 0,
    outputTokens: 0,
  };
}

describe("lexicalOnly", () => {
  it("orders by lexical score with no relevance data", () => {
    const r = lexicalOnly(hits);
    expect(r.items.map((i) => i.product.id)).toEqual(["a", "b", "c"]);
    expect(r.items[0].relevance).toBeNull();
    expect(r.appliedSort).toBe("relevance");
  });
});

describe("combine", () => {
  it("lets Jev relevance override lexical order", () => {
    const r = combine(hits, answers({ a: 1, b: 2, c: 4 }), DEFAULT_WEIGHTS);
    expect(r.items.map((i) => i.product.id)).toEqual(["c", "b", "a"]);
  });

  it("weights are adjustable: zero relevance weight restores lexical order", () => {
    const w = { ...DEFAULT_WEIGHTS, relevance: 0, relevanceFloor: 0 };
    const r = combine(hits, answers({ a: 1, b: 2, c: 4 }), w);
    expect(r.items.map((i) => i.product.id)).toEqual(["a", "b", "c"]);
  });

  it("pushes items below the relevance floor to the bottom", () => {
    const r = combine(hits, answers({ a: 0, b: 3, c: 3 }), DEFAULT_WEIGHTS);
    expect(r.items.at(-1)!.product.id).toBe("a");
    expect(r.items.at(-1)!.belowFloor).toBe(true);
    expect(r.items[0].belowFloor).toBe(false);
  });

  it("applies cheap preference only above the noul gate", () => {
    const equal = { a: 3, b: 3, c: 3 };
    const on = combine(hits, answers(equal, { wantsCheap: GATE.noul + 0.1 }), { ...DEFAULT_WEIGHTS, lexical: 0 });
    expect(on.filters.cheap).toBe(true);
    expect(on.items[0].product.id).toBe("a");
    expect(on.items[0].bonuses.price).toBeGreaterThan(on.items[2].bonuses.price);
    const off = combine(hits, answers(equal, { wantsCheap: GATE.noul - 0.1 }), DEFAULT_WEIGHTS);
    expect(off.filters.cheap).toBe(false);
    expect(off.items.every((i) => i.bonuses.price === 0)).toBe(true);
  });

  it("applies premium preference toward the expensive end", () => {
    const r = combine(hits, answers({ a: 3, b: 3, c: 3 }, { wantsPremium: 0.95 }), { ...DEFAULT_WEIGHTS, lexical: 0 });
    expect(r.filters.premium).toBe(true);
    expect(r.items[0].product.id).toBe("c");
  });

  it("applies a gift bonus to giftable descriptions", () => {
    const r = combine(hits, answers({ a: 3, b: 3, c: 3 }, { isGift: 0.9 }), { ...DEFAULT_WEIGHTS, lexical: 0 });
    expect(r.filters.gift).toBe(true);
    expect(r.items[0].product.id).toBe("b");
    expect(r.items[0].bonuses.gift).toBeGreaterThan(0);
  });

  it("applies category bonus only when intent is confident and not 'any'", () => {
    const kitchen = { ...product("k", 30, 4), category: "kitchen" as const };
    const mixed = [hit(A, 0.5), hit(kitchen, 0.5)];
    const eq = { a: 3, k: 3 };
    const yes = combine(mixed, answers(eq, { intent: "kitchen", intentConfidence: 0.8, intentProbabilities: { kitchen: 0.8 } }), DEFAULT_WEIGHTS);
    expect(yes.items[0].product.id).toBe("k");
    expect(yes.filters.intent).toBe("kitchen");
    const low = combine(mixed, answers(eq, { intent: "kitchen", intentConfidence: 0.2 }), DEFAULT_WEIGHTS);
    expect(low.filters.intent).toBeNull();
    const any = combine(mixed, answers(eq, { intent: "any", intentConfidence: 0.9 }), DEFAULT_WEIGHTS);
    expect(any.filters.intent).toBeNull();
  });

  it("applies inferred sort only above the sort gate and only when enabled", () => {
    const eq = { a: 3, b: 3, c: 3 };
    const byPrice = combine(hits, answers(eq, { sort: "price_high", sortConfidence: 0.8 }), DEFAULT_WEIGHTS);
    expect(byPrice.appliedSort).toBe("price_high");
    expect(byPrice.items.map((i) => i.product.id)).toEqual(["c", "b", "a"]);
    const byRating = combine(hits, answers(eq, { sort: "rating", sortConfidence: 0.8 }), DEFAULT_WEIGHTS);
    expect(byRating.items.map((i) => i.product.id)).toEqual(["b", "a", "c"]);
    const unsure = combine(hits, answers(eq, { sort: "price_high", sortConfidence: GATE.sort - 0.1 }), DEFAULT_WEIGHTS);
    expect(unsure.appliedSort).toBe("relevance");
    const disabled = combine(hits, answers(eq, { sort: "price_high", sortConfidence: 0.9 }), { ...DEFAULT_WEIGHTS, applySort: false });
    expect(disabled.appliedSort).toBe("relevance");
  });

  it("sorts within relevance bands so a cheap poor match cannot outrank a good one", () => {
    const r = combine(hits, answers({ a: 2.2, b: 3.9, c: 3.6 }, { sort: "price_low", sortConfidence: 0.9 }), DEFAULT_WEIGHTS);
    expect(r.items.map((i) => i.product.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps sort from resurrecting below-floor items", () => {
    const r = combine(hits, answers({ a: 4, b: 4, c: 0 }, { sort: "price_high", sortConfidence: 0.9 }), DEFAULT_WEIGHTS);
    expect(r.items.map((i) => i.product.id)).toEqual(["b", "a", "c"]);
  });

  it("is deterministic on ties", () => {
    const eq = answers({ a: 3, b: 3, c: 3 });
    const tie = [hit(A, 0.5), hit(B, 0.5), hit(C, 0.5)];
    expect(combine(tie, eq, DEFAULT_WEIGHTS).items.map((i) => i.product.id)).toEqual(["a", "b", "c"]);
  });
});
