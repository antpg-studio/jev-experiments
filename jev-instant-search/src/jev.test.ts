import { describe, expect, it } from "vitest";
import { generateCatalog } from "./catalog.ts";
import { buildRequest, estimateCostUsd, heuristicQueryJudgment, MODEL, parseAnswers, RELEVANCE_LEVELS, type JevResponse } from "./jev.ts";

const catalog = generateCatalog();
const cands = catalog.slice(0, 30);

describe("buildRequest", () => {
  it("builds one Score question per candidate plus 5 query-level questions", () => {
    const req = buildRequest("cheap headphones", cands);
    expect(req.model).toBe(MODEL);
    expect(req.state.query).toBe("cheap headphones");
    expect(req.state.candidates.length).toBe(30);
    const ids = Object.keys(req.questions);
    expect(ids.filter((k) => k.startsWith("rel_")).length).toBe(30);
    expect(ids).toEqual(expect.arrayContaining(["intent_category", "wants_cheap", "wants_premium", "is_gift", "sort_preference"]));
    expect(req.questions.rel_0.type).toBe("score");
    expect(req.questions.rel_0.criteria).toHaveLength(RELEVANCE_LEVELS.length);
    expect(req.questions.rel_7.instructions).toContain("candidates[7]");
    expect(req.questions.intent_category.type).toBe("choice");
    expect(req.questions.wants_cheap.type).toBe("noul");
    expect(Object.keys(req.questions.sort_preference.criteria as Record<string, string>).sort()).toEqual(["price_high", "price_low", "rating", "relevance"]);
  });

  it("does not leak fields Jev does not need", () => {
    const c = buildRequest("x", cands).state.candidates[0];
    expect(Object.keys(c).sort()).toEqual(["category", "description", "id", "price_usd", "rating", "title"]);
  });
});

function fakeResponse(overrides: Partial<JevResponse["answers"]> = {}): JevResponse {
  const answers: JevResponse["answers"] = {};
  cands.forEach((_, i) => {
    answers[`rel_${i}`] = { type: "score", score: i % 5, confidence: 0.8, probabilities: { [String(i % 5)]: 0.8, "0": 0.2 } };
  });
  Object.assign(answers, {
    intent_category: { type: "choice", choice: "electronics", confidence: 0.7, probabilities: { electronics: 0.7, any: 0.3 } },
    wants_cheap: { type: "noul", noul: 0.92 },
    wants_premium: { type: "noul", noul: 0.03 },
    is_gift: { type: "noul", noul: 0.1 },
    sort_preference: { type: "choice", choice: "price_low", confidence: 0.66, probabilities: { price_low: 0.66, relevance: 0.34 } },
  }, overrides);
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 6691, output_tokens: 0 } };
}

describe("parseAnswers", () => {
  it("maps rel_N back to product ids with ordered probability arrays", () => {
    const parsed = parseAnswers("cheap headphones", cands, fakeResponse());
    expect(parsed.relevance.size).toBe(30);
    const r = parsed.relevance.get(cands[3].id)!;
    expect(r.score).toBe(3);
    expect(r.probabilities).toHaveLength(5);
    expect(r.probabilities[3]).toBe(0.8);
    expect(r.probabilities[1]).toBe(0);
    expect(parsed.query.intent).toBe("electronics");
    expect(parsed.query.wantsCheap).toBe(0.92);
    expect(parsed.query.sort).toBe("price_low");
    expect(parsed.inputTokens).toBe(6691);
    expect(parsed.model).toBe("jev-1.13.0");
  });

  it("falls back to heuristics for missing or malformed query answers", () => {
    const res = fakeResponse({ intent_category: { type: "choice", choice: "garden", confidence: 0.9, probabilities: {} } });
    delete res.answers.wants_cheap;
    delete res.answers.sort_preference;
    const parsed = parseAnswers("cheap headphones", cands, res);
    expect(parsed.query.intent).toBe("any");
    expect(parsed.query.wantsCheap).toBe(0.9);
    expect(parsed.query.sort).toBe("price_low");
  });

  it("skips candidates without a score answer", () => {
    const res = fakeResponse();
    delete res.answers.rel_0;
    const parsed = parseAnswers("x", cands, res);
    expect(parsed.relevance.has(cands[0].id)).toBe(false);
    expect(parsed.relevance.size).toBe(29);
  });
});

describe("heuristicQueryJudgment", () => {
  it("detects cheap / premium / gift / rating cues", () => {
    expect(heuristicQueryJudgment("cheap headphones").wantsCheap).toBeGreaterThan(0.5);
    expect(heuristicQueryJudgment("cheap headphones").sort).toBe("price_low");
    expect(heuristicQueryJudgment("premium espresso machine").wantsPremium).toBeGreaterThan(0.5);
    expect(heuristicQueryJudgment("premium espresso machine").sort).toBe("price_high");
    expect(heuristicQueryJudgment("gift for a 6 yr old who likes space").isGift).toBeGreaterThan(0.5);
    expect(heuristicQueryJudgment("best rated tent").sort).toBe("rating");
    const plain = heuristicQueryJudgment("quiet keyboard for open office");
    expect(plain.wantsCheap).toBeLessThan(0.5);
    expect(plain.isGift).toBeLessThan(0.5);
    expect(plain.sort).toBe("relevance");
    expect(plain.intent).toBe("any");
  });
});

describe("estimateCostUsd", () => {
  it("uses the published input-token price", () => {
    expect(estimateCostUsd(1_000_000)).toBeCloseTo(0.042);
    expect(estimateCostUsd(6691) * 1000).toBeCloseTo(0.281, 3);
  });
});
