import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, HUMAN_CONFIDENCE, lane, needsHuman, priority, rank } from "./priority";
import type { Judgment } from "./types";

const base: Judgment = {
  category: "bug",
  categoryConfidence: 0.95,
  categoryProbabilities: { bug: 0.95, other: 0.05 },
  needsReply: 0.9,
  urgency: 1,
  urgencyConfidence: 0.9,
  sentiment: 1,
  sentimentConfidence: 0.9,
  isPhishingOrScam: 0.01,
  mentionsChurnOrCancel: 0.02,
  asksForRefund: 0.01,
};

const j = (over: Partial<Judgment>): Judgment => ({ ...base, ...over });

describe("priority", () => {
  it("is monotonic in urgency and anger", () => {
    const calm = priority(j({ urgency: 0, sentiment: 0 }), DEFAULT_WEIGHTS);
    const hot = priority(j({ urgency: 3, sentiment: 3 }), DEFAULT_WEIGHTS);
    expect(hot).toBeGreaterThan(calm);
    expect(hot - calm).toBeCloseTo(DEFAULT_WEIGHTS.urgency + DEFAULT_WEIGHTS.sentiment);
  });

  it("uses fractional scores and probabilities directly", () => {
    const a = priority(j({ urgency: 1.5, mentionsChurnOrCancel: 0.5 }), DEFAULT_WEIGHTS);
    const b = priority(j({ urgency: 1.5, mentionsChurnOrCancel: 0.0 }), DEFAULT_WEIGHTS);
    expect(a - b).toBeCloseTo(0.5 * DEFAULT_WEIGHTS.churn);
  });

  it("penalises spam but not phishing that is categorised as spam", () => {
    const spam = priority(j({ category: "spam_marketing", needsReply: 0 }), DEFAULT_WEIGHTS);
    const phish = priority(j({ category: "spam_marketing", needsReply: 0, isPhishingOrScam: 1 }), DEFAULT_WEIGHTS);
    expect(spam).toBeLessThan(0);
    expect(phish).toBeGreaterThan(spam + DEFAULT_WEIGHTS.spamPenalty);
  });

  it("changes ranking when weights change, with no new judgments", () => {
    const refund = { judgment: j({ asksForRefund: 1, urgency: 0 }), receivedAt: "2026-09-17T10:00:00Z" };
    const urgent = { judgment: j({ urgency: 3 }), receivedAt: "2026-09-17T09:00:00Z" };
    expect(rank([refund, urgent], DEFAULT_WEIGHTS)[0]).toBe(urgent);
    expect(rank([refund, urgent], { ...DEFAULT_WEIGHTS, refund: 100 })[0]).toBe(refund);
  });

  it("puts unjudged rows last and breaks ties by recency", () => {
    const old = { judgment: base, receivedAt: "2026-09-17T09:00:00Z" };
    const recent = { judgment: base, receivedAt: "2026-09-17T10:00:00Z" };
    const pending = { receivedAt: "2026-09-17T11:00:00Z" };
    expect(rank([pending, old, recent], DEFAULT_WEIGHTS)).toEqual([recent, old, pending]);
  });
});

describe("lanes", () => {
  it("routes low-confidence categories to the human lane", () => {
    expect(needsHuman(j({ categoryConfidence: HUMAN_CONFIDENCE - 0.01 }))).toBe(true);
    expect(lane(j({ categoryConfidence: 0.5 }))).toBe("human");
    expect(lane(j({ categoryConfidence: 0.9 }))).toBe("priority");
  });

  it("surfaces phishing even when the category is spam or uncertain", () => {
    expect(lane(j({ category: "spam_marketing", categoryConfidence: 0.4, isPhishingOrScam: 0.8 }))).toBe("priority");
  });

  it("separates spam and FYI from the priority queue", () => {
    expect(lane(j({ category: "spam_marketing", needsReply: 0.1 }))).toBe("spam");
    expect(lane(j({ needsReply: 0.1, urgency: 0.4 }))).toBe("fyi");
    expect(lane(j({ needsReply: 0.1, urgency: 2 }))).toBe("priority");
  });
});
