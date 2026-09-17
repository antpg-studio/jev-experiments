import { describe, expect, it } from "vitest";
import { addJudgment, emptyAggregate, markShown, recentDecisions, setAssignee } from "./aggregate.ts";
import type { Judgment } from "./resolve.ts";

const judgment = (over: Partial<Judgment> = {}): Judgment => ({
  kind: "decision",
  kindConfidence: 0.9,
  kindProbabilities: {},
  assignee: null,
  assigneeConfidence: 1,
  assigneeUncertain: false,
  assigneeCandidates: [],
  hasDeadline: false,
  deadline: { kind: "none", date: null, label: "" },
  reverses: false,
  blocked: false,
  importance: 1,
  ...over,
});

const utt = (id: number, text = `u${id}`) => ({ id, text, speaker: "Priya Nair" });

describe("addJudgment", () => {
  it("drops chit-chat and plain status updates", () => {
    const r = addJudgment(emptyAggregate(), judgment({ kind: "chit_chat" }), utt(1));
    expect(r.item).toBeNull();
    expect(r.state.items).toHaveLength(0);
    expect(addJudgment(emptyAggregate(), judgment({ kind: "status_update" }), utt(2)).item).toBeNull();
  });

  it("assigns increasing ids and buckets", () => {
    let s = emptyAggregate();
    s = addJudgment(s, judgment({ kind: "action_item", assignee: "Marcus Lee" }), utt(1)).state;
    s = addJudgment(s, judgment({ kind: "risk" }), utt(2)).state;
    expect(s.items.map((x) => [x.id, x.bucket])).toEqual([
      [1, "actions"],
      [2, "risks"],
    ]);
  });

  it("strikes through the most recent live decision when a reversal lands", () => {
    let s = emptyAggregate();
    s = addJudgment(s, judgment(), utt(1, "hold at five")).state;
    s = addJudgment(s, judgment(), utt(2, "ship B")).state;
    const r = addJudgment(s, judgment({ reverses: true }), utt(3, "actually go to twenty-five"));
    const [d1, d2, d3] = r.state.items;
    expect(d1.supersededBy).toBeNull();
    expect(d2.supersededBy).toBe(d3.id);
    expect(d3.supersededBy).toBeNull();
    expect(recentDecisions(r.state.items)).toEqual(["hold at five", "actually go to twenty-five"]);
  });

  it("never supersedes a decision spoken later (out-of-order responses)", () => {
    let s = emptyAggregate();
    s = addJudgment(s, judgment(), utt(5, "later decision")).state;
    const r = addJudgment(s, judgment({ reverses: true }), utt(3, "earlier reversal"));
    expect(r.state.items[0].supersededBy).toBeNull();
  });

  it("does not strike through when the reversal is not a decision", () => {
    let s = emptyAggregate();
    s = addJudgment(s, judgment(), utt(1)).state;
    s = addJudgment(s, judgment({ kind: "open_question", reverses: true }), utt(2)).state;
    expect(s.items[0].supersededBy).toBeNull();
  });
});

describe("setAssignee / markShown", () => {
  it("fixes the owner and clears the uncertainty flag", () => {
    let s = addJudgment(emptyAggregate(), judgment({ kind: "action_item", assignee: null, assigneeUncertain: true }), utt(1)).state;
    s = setAssignee(s, 1, "Dev Okafor");
    expect(s.items[0]).toMatchObject({ assignee: "Dev Okafor", assigneeUncertain: false, assigneeEdited: true });
  });
  it("records the first paint latency only once", () => {
    let s = addJudgment(emptyAggregate(), judgment(), utt(1)).state;
    s = markShown(s, 1, 120);
    s = markShown(s, 1, 900);
    expect(s.items[0].latencyMs).toBe(120);
  });
});
