import { describe, expect, it } from "vitest";
import type { ChoiceResponse } from "@typesafe-ai/sdk";
import {
  AUTO_FILL_CONFIDENCE,
  gateMacro,
  latencyStats,
  percentile,
  queueBadges,
  queuePriority,
  refundEligibleByPolicy,
  topOptions,
} from "./engine.ts";
import type { JudgeAnswers } from "./questions.ts";

function choice(probabilities: Record<string, number>, confidence: number): ChoiceResponse {
  const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: "choice", choice, confidence, probabilities };
}

describe("refundEligibleByPolicy", () => {
  it("is decided by plan or tenure, never by the model", () => {
    expect(refundEligibleByPolicy({ plan: "pro", tenure_months: 1 })).toBe(true);
    expect(refundEligibleByPolicy({ plan: "business", tenure_months: 0 })).toBe(true);
    expect(refundEligibleByPolicy({ plan: "free", tenure_months: 11 })).toBe(false);
    expect(refundEligibleByPolicy({ plan: "starter", tenure_months: 12 })).toBe(true);
  });
});

describe("gateMacro", () => {
  it("auto-fills only when confidence clears the threshold", () => {
    const sure = gateMacro(choice({ a: 0.95, b: 0.04, none: 0.01 }, 0.95));
    expect(sure).toMatchObject({ kind: "auto", macroId: "a" });
    const unsure = gateMacro(choice({ a: 0.45, b: 0.4, none: 0.15 }, AUTO_FILL_CONFIDENCE - 0.1));
    expect(unsure.kind).toBe("options");
    if (unsure.kind === "options") {
      expect(unsure.top.map((o) => o.id)).toEqual(["a", "b"]);
    }
  });

  it("reports none when no macro fits, regardless of confidence", () => {
    const none = gateMacro(choice({ none: 0.9, a: 0.1 }, 0.9));
    expect(none.kind).toBe("none");
  });

  it("ranks options by probability", () => {
    const top = topOptions(choice({ a: 0.1, b: 0.6, c: 0.3 }, 0.6), 2);
    expect(top.map((o) => o.id)).toEqual(["b", "c"]);
  });
});

describe("latency stats", () => {
  it("computes nearest-rank percentiles", () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });

  it("summarises samples", () => {
    const st = latencyStats([300, 100, 200]);
    expect(st).toMatchObject({ count: 3, min: 100, max: 300, p50: 200, mean: 200 });
    expect(latencyStats([]).count).toBe(0);
  });
});

describe("queue badges", () => {
  const answers: JudgeAnswers = {
    best_macro: choice({ escalate_to_supervisor: 0.9, none: 0.1 }, 0.9),
    intent: choice({ cancellation_threat: 0.9, other: 0.1 }, 0.9),
    churn_risk: { type: "score", score: 2.8, confidence: 0.8, legend: {}, probabilities: {} },
    frustration: { type: "score", score: 2.1, confidence: 0.8, legend: {}, probabilities: {} },
    needs_escalation_to_human_supervisor: { type: "noul", noul: 0.91 },
    customer_requests_refund: { type: "noul", noul: 0.2 },
    contains_regulatory_request: { type: "noul", noul: 0.05 },
    agent_should_apologize_first: { type: "noul", noul: 0.9 },
    resolution_likely_this_session: { type: "noul", noul: 0.1 },
  };

  it("thresholds nouls at 0.5 and passes scores through", () => {
    const b = queueBadges(answers);
    expect(b).toMatchObject({ escalate: true, regulatory: false, refundRequested: false, churn: 2.8 });
  });

  it("orders escalations ahead of everything else", () => {
    const hot = queuePriority(queueBadges(answers));
    const calm = queuePriority({ churn: 0.2, frustration: 0.1, escalate: false, regulatory: false, refundRequested: false });
    expect(hot).toBeGreaterThan(calm);
    expect(queuePriority(undefined)).toBe(0);
  });
});
