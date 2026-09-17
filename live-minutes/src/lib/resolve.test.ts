import { describe, expect, it } from "vitest";
import { bucketFor, resolveJudgment, ASSIGNEE_CONFIDENCE } from "./resolve.ts";
import type { JudgeAnswers } from "./types.ts";
import { MEETING } from "../data/transcript.ts";

function answers(over: Partial<{ [K in keyof JudgeAnswers]: Partial<JudgeAnswers[K]> }> = {}): JudgeAnswers {
  const base: JudgeAnswers = {
    kind: { type: "choice", choice: "action_item", probabilities: { action_item: 0.9, status_update: 0.1 }, confidence: 0.9 },
    assignee: { type: "choice", choice: "Marcus Lee", probabilities: { "Marcus Lee": 0.8, unassigned: 0.2 }, confidence: 0.8 },
    has_deadline: { type: "noul", noul: 0.9 },
    deadline_kind: { type: "choice", choice: "specific_date", probabilities: { specific_date: 0.9 }, confidence: 0.9 },
    reverses_earlier_decision: { type: "noul", noul: 0.05 },
    is_blocked: { type: "noul", noul: 0.1 },
    importance: { type: "score", score: 2, legend: {}, probabilities: {}, confidence: 0.7 },
  };
  return {
    kind: { ...base.kind, ...over.kind },
    assignee: { ...base.assignee, ...over.assignee },
    has_deadline: { ...base.has_deadline, ...over.has_deadline },
    deadline_kind: { ...base.deadline_kind, ...over.deadline_kind },
    reverses_earlier_decision: { ...base.reverses_earlier_decision, ...over.reverses_earlier_decision },
    is_blocked: { ...base.is_blocked, ...over.is_blocked },
    importance: { ...base.importance, ...over.importance },
  };
}

describe("resolveJudgment", () => {
  it("resolves a confident action item with a date", () => {
    const j = resolveJudgment(answers(), "Marcus, send it by tomorrow", "Priya Nair", MEETING);
    expect(j.kind).toBe("action_item");
    expect(j.assignee).toBe("Marcus Lee");
    expect(j.assigneeUncertain).toBe(false);
    expect(j.deadline.date).toBe("2026-09-18");
    expect(j.reverses).toBe(false);
    expect(j.blocked).toBe(false);
  });

  it("maps speaker_themself to the speaker", () => {
    const j = resolveJudgment(
      answers({ assignee: { choice: "speaker_themself", probabilities: { speaker_themself: 0.95 }, confidence: 0.95 } }),
      "I'll take that",
      "Sofia Alvarez",
      MEETING,
    );
    expect(j.assignee).toBe("Sofia Alvarez");
    expect(j.assigneeCandidates[0]).toEqual({ name: "Sofia Alvarez", p: 0.95 });
  });

  it("gates uncertain assignees behind the ? chip", () => {
    const low = ASSIGNEE_CONFIDENCE - 0.1;
    const j = resolveJudgment(
      answers({ assignee: { choice: "Dev Okafor", probabilities: { "Dev Okafor": low, "Marcus Lee": 1 - low }, confidence: low } }),
      "Someone should grab that",
      "Priya Nair",
      MEETING,
    );
    expect(j.assigneeUncertain).toBe(true);
    expect(j.assignee).toBe("Dev Okafor");
    const un = resolveJudgment(answers({ assignee: { choice: "unassigned", confidence: 0.9 } }), "someone should", "Priya Nair", MEETING);
    expect(un.assignee).toBeNull();
    expect(un.assigneeUncertain).toBe(true);
  });

  it("never assigns owners to non-tasks", () => {
    const j = resolveJudgment(answers({ kind: { choice: "decision", confidence: 0.8 } }), "let's ship Friday", "Priya Nair", MEETING);
    expect(j.assignee).toBeNull();
    expect(j.assigneeUncertain).toBe(false);
  });

  it("requires both has_deadline and a non-none kind for a deadline", () => {
    const noHas = resolveJudgment(answers({ has_deadline: { noul: 0.2 } }), "by tomorrow", "Priya Nair", MEETING);
    expect(noHas.hasDeadline).toBe(false);
    expect(noHas.deadline.kind).toBe("none");
    const noneKind = resolveJudgment(answers({ deadline_kind: { choice: "none" } }), "by tomorrow", "Priya Nair", MEETING);
    expect(noneKind.hasDeadline).toBe(false);
  });
});

describe("bucketFor", () => {
  const j = (kind: string, blocked = false) =>
    resolveJudgment(answers({ kind: { choice: kind }, is_blocked: { noul: blocked ? 0.9 : 0.1 } }), "x", "Priya Nair", MEETING);
  it("routes kinds to lists", () => {
    expect(bucketFor(j("action_item"))).toBe("actions");
    expect(bucketFor(j("decision"))).toBe("decisions");
    expect(bucketFor(j("open_question"))).toBe("questions");
    expect(bucketFor(j("risk"))).toBe("risks");
    expect(bucketFor(j("chit_chat"))).toBeNull();
  });
  it("surfaces blocked status updates as risks", () => {
    expect(bucketFor(j("status_update"))).toBeNull();
    expect(bucketFor(j("status_update", true))).toBe("risks");
  });
});
