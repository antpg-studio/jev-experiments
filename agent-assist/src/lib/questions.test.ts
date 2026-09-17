import { describe, expect, it } from "vitest";
import { MACROS, MACRO_SUMMARIES, fillMacro, macroById } from "../data/macros.ts";
import { SCRIPTS, totalMessages } from "../data/scripts.ts";
import { CONVERSATION_WINDOW, buildQuestions, buildState, windowConversation } from "./questions.ts";
import type { Message } from "./questions.ts";

describe("question builders", () => {
  const q = buildQuestions(MACRO_SUMMARIES);

  it("asks all nine judgments in one request", () => {
    expect(Object.keys(q).sort()).toEqual(
      [
        "agent_should_apologize_first",
        "best_macro",
        "churn_risk",
        "contains_regulatory_request",
        "customer_requests_refund",
        "frustration",
        "intent",
        "needs_escalation_to_human_supervisor",
        "resolution_likely_this_session",
      ].sort(),
    );
  });

  it("offers every macro id plus none as a choice", () => {
    const ids = Object.keys(q.best_macro.criteria).sort();
    expect(ids).toEqual([...MACROS.map((m) => m.id), "none"].sort());
    expect(MACROS).toHaveLength(12);
  });

  it("uses four ordered levels for both scores", () => {
    expect(q.churn_risk.criteria).toHaveLength(4);
    expect(q.frustration.criteria).toHaveLength(4);
  });
});

describe("state construction", () => {
  it("windows the conversation to the last six messages and strips the customer's name", () => {
    const conversation: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? "agent" : "customer",
      text: `m${i}`,
    }));
    expect(windowConversation(conversation)).toHaveLength(CONVERSATION_WINDOW);
    const state = buildState(
      { conversation, customer: { name: "Jane Doe", plan: "pro", tenure_months: 3, prior_tickets: 1 } },
      MACRO_SUMMARIES,
    );
    expect(state.conversation[0]?.text).toBe("m4");
    expect(state.customer).toEqual({ plan: "pro", tenure_months: 3, prior_tickets: 1 });
    expect("name" in state.customer).toBe(false);
    expect(state.catalog_of_macros).toHaveLength(12);
  });
});

describe("fixtures", () => {
  it("has eight scripted chats with forty customer messages", () => {
    expect(SCRIPTS).toHaveLength(8);
    expect(totalMessages()).toBe(40);
    expect(new Set(SCRIPTS.map((s) => s.id)).size).toBe(8);
  });

  it("fills macro templates with the customer's first name", () => {
    const m = macroById("guided_walkthrough")!;
    expect(fillMacro(m, "Harold Pemberton")).toContain("Harold");
    expect(fillMacro(m, "Harold Pemberton")).not.toContain("{name}");
  });
});
