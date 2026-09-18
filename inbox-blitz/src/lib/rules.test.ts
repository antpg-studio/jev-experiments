import { describe, expect, it } from "vitest";
import { EMAILS, generateEmails } from "../data/emails";
import { TRAPS } from "../data/traps";
import { agreement, classifyRules, DIMENSIONS, disagreements, type RuleVerdict } from "./rules";
import type { Email, Judgment } from "./types";

const email = (over: Partial<Email>): Email => ({
  id: "t1",
  from: "Test Person",
  fromEmail: "test.person@example.com",
  subject: "",
  body: "",
  receivedAt: "2026-09-17T10:00:00Z",
  ...over,
});

const trap = (subject: string): Email => {
  const t = TRAPS.find((x) => x.subject === subject);
  if (!t) throw new Error(`no trap "${subject}"`);
  return email(t);
};

describe("keyword rules baseline", () => {
  it("classifies obvious cases the way a keyword classifier would", () => {
    expect(classifyRules(email({ subject: "Charged twice", body: "I see two charges on my invoice." })).category).toBe("billing");
    expect(classifyRules(email({ subject: "Login broken", body: "The page shows a 500 error." })).category).toBe("bug");
    expect(classifyRules(email({ fromEmail: "jules.park@northwind.cloud", body: "standup moved" })).category).toBe("internal");
    expect(classifyRules(email({ body: "Unsubscribe here. 50% off!" })).needsReply).toBe(false);
  });

  it("falls for the sarcasm / negation traps (this is the point of the demo)", () => {
    // "not urgent at all ... just kidding, prod is down" → rules read the literal words
    expect(classifyRules(trap("not urgent at all")).urgency).toBe(0);
    // refund mentioned inside a newsletter → rules think it's a refund request
    expect(classifyRules(trap("New: automated refund workflows, plus 3 more September features")).asksForRefund).toBe(true);
    // "I'm NOT cancelling" → keyword hit on "cancel"
    expect(classifyRules(trap("Question about my invoice (I'm NOT cancelling!)")).mentionsChurnOrCancel).toBe(true);
    // marketing copy borrowing urgent words
    expect(classifyRules(trap("ASAP: 70% off ends at midnight!!!")).urgency).toBe(3);
  });
});

describe("disagreements / agreement", () => {
  const rule: RuleVerdict = { category: "billing", needsReply: true, urgency: 2, sentiment: 1, isPhishingOrScam: false, mentionsChurnOrCancel: false, asksForRefund: true };
  const jev: Judgment = {
    category: "billing",
    categoryConfidence: 0.99,
    categoryProbabilities: { billing: 0.99 },
    needsReply: 0.9,
    urgency: 2.4,
    urgencyConfidence: 0.8,
    sentiment: 1.2,
    sentimentConfidence: 0.8,
    isPhishingOrScam: 0.01,
    mentionsChurnOrCancel: 0.02,
    asksForRefund: 0.95,
  };

  it("reports no disagreement when values match within a score step", () => {
    expect(disagreements(rule, jev)).toEqual([]);
  });

  it("names each differing dimension", () => {
    const j = { ...jev, category: "bug" as const, urgency: 0.5, isPhishingOrScam: 0.7 };
    expect(disagreements(rule, j)).toEqual(["category", "urgency", "isPhishingOrScam"]);
  });

  it("aggregates per-dimension and overall agreement", () => {
    const a = agreement([
      { rule, judgment: jev },
      { rule, judgment: { ...jev, category: "bug", asksForRefund: 0.1 } },
    ]);
    expect(a.compared).toBe(2);
    expect(a.fullyAgree).toBe(1);
    expect(a.perDimension.category).toBe(0.5);
    expect(a.perDimension.asksForRefund).toBe(0.5);
    expect(a.perDimension.urgency).toBe(1);
    expect(a.overall).toBeCloseTo((DIMENSIONS.length * 2 - 2) / (DIMENSIONS.length * 2));
  });

  it("is empty-safe", () => {
    const a = agreement([]);
    expect(a.overall).toBe(0);
    expect(a.compared).toBe(0);
  });
});

describe("seeded fixture", () => {
  it("has exactly 500 unique emails and is deterministic", () => {
    expect(EMAILS).toHaveLength(500);
    expect(new Set(EMAILS.map((e) => e.id)).size).toBe(500);
    expect(generateEmails()).toEqual(EMAILS);
    expect(generateEmails(1)).not.toEqual(EMAILS);
  });

  it("includes every hand-written trap and some threads", () => {
    for (const t of TRAPS) expect(EMAILS.some((e) => e.subject === t.subject && e.trap === t.trap)).toBe(true);
    expect(EMAILS.filter((e) => e.threadId).length).toBeGreaterThan(10);
  });
});
