import { describe, expect, it } from "vitest";
import { mean, mergeRanking, percentile, splitBatches } from "./rerank.ts";
import { buildRerankRequest, candidateKey, EXISTS_QUESTION_ID, parseRerankAnswers, RELEVANCE_LEVELS } from "./questions.ts";
import type { Passage } from "./types.ts";

const passages: Passage[] = ["a", "b", "c"].map((id) => ({
  id,
  doc: "d",
  title: id,
  kind: "handbook",
  text: `passage ${id}`,
}));
const byId = new Map(passages.map((p) => [p.id, p]));

describe("buildRerankRequest", () => {
  it("creates one score question per candidate plus the existence noul", () => {
    const { state, questions, keyToId } = buildRerankRequest("q", passages);
    expect(Object.keys(questions)).toHaveLength(4);
    expect(questions[EXISTS_QUESTION_ID].type).toBe("noul");
    expect(state.candidates[candidateKey(0)]).toBe("passage a");
    expect(keyToId[candidateKey(2)]).toBe("c");
    const q = questions[`relevance_${candidateKey(1)}`];
    expect(q.type).toBe("score");
    if (q.type === "score") expect(q.criteria).toEqual([...RELEVANCE_LEVELS]);
  });
});

describe("parseRerankAnswers", () => {
  it("maps answers back to passage ids and picks the argmax level", () => {
    const { keyToId } = buildRerankRequest("q", passages);
    const { judgments, answerExists } = parseRerankAnswers(
      {
        relevance_c01: { type: "score", score: 0.4, probabilities: { "0": 0.7, "1": 0.2, "2": 0.1, "3": 0 }, confidence: 0.6 },
        relevance_c02: { type: "score", score: 2.8, probabilities: { "0": 0, "1": 0.05, "2": 0.1, "3": 0.85 }, confidence: 0.9 },
        [EXISTS_QUESTION_ID]: { type: "noul", noul: 0.93 },
      },
      keyToId,
    );
    expect(answerExists).toBe(0.93);
    expect(judgments.find((j) => j.id === "b")).toMatchObject({ relevance: 2.8, level: 3 });
    expect(judgments.find((j) => j.id === "a")).toMatchObject({ level: 0 });
    expect(judgments.find((j) => j.id === "c")).toMatchObject({ relevance: 0, confidence: 0 });
  });
});

describe("mergeRanking", () => {
  it("orders by relevance and breaks ties with BM25 rank", () => {
    const hits = [
      { id: "a", score: 3 },
      { id: "b", score: 2 },
      { id: "c", score: 1 },
    ];
    const ranked = mergeRanking(
      hits,
      [
        { id: "a", relevance: 1.0, level: 1, confidence: 0.5, probabilities: {} },
        { id: "b", relevance: 2.9, level: 3, confidence: 0.9, probabilities: {} },
        { id: "c", relevance: 1.0, level: 1, confidence: 0.5, probabilities: {} },
      ],
      byId,
    );
    expect(ranked.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(ranked.map((r) => r.jevRank)).toEqual([1, 2, 3]);
    expect(ranked[0].bm25Rank).toBe(2);
  });
});

describe("helpers", () => {
  it("splitBatches distributes items", () => {
    expect(splitBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2, 3], [4, 5]]);
    expect(splitBatches([1, 2], 5)).toEqual([[1], [2]]);
    expect(splitBatches([], 3)).toEqual([]);
  });
  it("percentile and mean", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([], 95)).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
  });
});
