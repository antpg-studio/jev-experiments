import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";
import { intersect, isMatch, pending, labelName, pickColor, sortByMatch, summarize, type IntentLabel } from "./labels";
import type { MatchResult } from "./types";

const m = (id: string, match: number): MatchResult => ({ id, match, latencyMs: 100, inputTokens: 10, retries: 0 });

function label(id: string, matches: MatchResult[]): IntentLabel {
  return {
    id,
    intent: id,
    name: id,
    color: pickColor(0),
    phase: "done",
    matches: new Map(matches.map((x) => [x.id, x])),
    errors: new Map(),
    stats: computeStats([], 0, 0, 0, 0, 1),
  };
}

describe("labelName", () => {
  it("strips filler and capitalises", () => {
    expect(labelName("emails from customers who are threatening to cancel")).toBe("Threatening to cancel");
    expect(labelName("anyone asking for a refund")).toBe("Asking for a refund");
    expect(labelName("phishing or a scam!")).toBe("Phishing or a scam");
  });
  it("truncates long intents on a word boundary", () => {
    const n = labelName("production is completely down and nobody on the team can log in anymore", 28);
    expect(n.endsWith("…")).toBe(true);
    expect(n.length).toBeLessThanOrEqual(29);
  });
  it("never returns an empty name", () => {
    expect(labelName("customers")).toBe("Customers");
  });
});

describe("summarize", () => {
  it("buckets matches into sure / borderline / rejected", () => {
    const s = summarize([m("a", 0.95), m("b", 0.6), m("c", 0.1), m("d", 0.5)]);
    expect(s.judged).toBe(4);
    expect(s.matched).toBe(3);
    expect(s.sure).toBe(1);
    expect(s.borderline).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(4);
    expect(s.histogram[9]).toBe(1);
    expect(s.histogram[1]).toBe(1);
  });
});

describe("filtering", () => {
  const churn = label("churn", [m("a", 0.9), m("b", 0.7), m("c", 0.2)]);
  const refund = label("refund", [m("a", 0.8), m("b", 0.3), m("c", 0.9)]);

  it("isMatch uses the 0.5 threshold and treats unjudged as no", () => {
    expect(isMatch(m("x", 0.5))).toBe(true);
    expect(isMatch(m("x", 0.49))).toBe(false);
    expect(isMatch(undefined)).toBe(false);
  });
  it("intersect ANDs labels", () => {
    expect(intersect(["a", "b", "c", "d"], [churn])).toEqual(["a", "b"]);
    expect(intersect(["a", "b", "c", "d"], [churn, refund])).toEqual(["a"]);
    expect(intersect(["a", "b"], [])).toEqual(["a", "b"]);
  });
  it("pending keeps unjudged ids and drops ruled-out ones", () => {
    expect(pending(["a", "b", "c", "d"], [churn])).toEqual(["a", "b", "d"]);
    expect(pending(["a", "b", "c", "d"], [churn, refund])).toEqual(["a", "d"]);
  });
  it("sortByMatch orders by combined probability, stable on ties", () => {
    const rows = [{ id: "c" }, { id: "b" }, { id: "a" }, { id: "z" }];
    expect(sortByMatch(rows, [churn]).map((r) => r.id)).toEqual(["a", "b", "c", "z"]);
    expect(sortByMatch(rows, [churn, refund]).map((r) => r.id)).toEqual(["a", "b", "c", "z"]);
    expect(sortByMatch(rows, []).map((r) => r.id)).toEqual(["c", "b", "a", "z"]);
  });
});

describe("stats with one question per email", () => {
  it("counts one judgment per processed email", () => {
    expect(computeStats([100, 120], 50, 1000, 500, 0, 1).judgments).toBe(2);
    expect(computeStats([100, 120], 50, 1000, 500, 0).judgments).toBe(14);
  });
});
