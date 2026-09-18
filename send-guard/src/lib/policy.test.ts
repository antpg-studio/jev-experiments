import { describe, expect, it } from "vitest";
import { chipState, decide, toneLabel, worse } from "./policy";
import type { Answer, Span } from "./types";

const n = (v: number): Answer => ({ type: "noul", noul: v });
const s = (v: number): Answer => ({ type: "score", score: v, legend: {}, probabilities: {}, confidence: 0.9 });
const c = (v: string): Answer => ({ type: "choice", choice: v, probabilities: {}, confidence: 0.9 });

const clean = (): Record<string, Answer> => ({
  contains_secret_or_credential: n(0.02),
  contains_customer_pii: n(0.03),
  makes_binding_commitment: n(0.05),
  discloses_confidential_internal_info: n(0.02),
  tone: s(0.4),
  is_appropriate_for_audience: n(0.95),
  is_incomplete_or_cut_off: n(0.05),
  contains_hedging_that_undermines: n(0.03),
  legal_or_compliance_risk: s(0.1),
  should_block_send: c("send"),
});

describe("decide", () => {
  it("sends a clean message", () => {
    expect(decide(clean(), "external_customer", [])).toEqual({ verdict: "send", reason: "Looks good", culpritSpanIds: [] });
  });

  it("blocks a credential regardless of audience and names the reason", () => {
    const a = { ...clean(), contains_secret_or_credential: n(0.97) };
    expect(decide(a, "internal", []).verdict).toBe("block");
    expect(decide(a, "internal", []).reason).toContain("credential");
  });

  it("warns on a commitment, and Jev's verdict can escalate but not downgrade", () => {
    const a = { ...clean(), makes_binding_commitment: n(0.9) };
    expect(decide(a, "external_customer", []).verdict).toBe("warn");
    expect(decide({ ...a, should_block_send: c("block") }, "external_customer", []).verdict).toBe("block");
    expect(decide({ ...clean(), contains_secret_or_credential: n(0.9), should_block_send: c("send") }, "internal", []).verdict).toBe("block");
  });

  it("treats a confidential leak as a block only for external audiences", () => {
    const a = { ...clean(), discloses_confidential_internal_info: n(0.95) };
    expect(decide(a, "external_customer", []).verdict).toBe("block");
    expect(decide(a, "public", []).verdict).toBe("block");
    expect(decide(a, "internal", []).verdict).toBe("send");
  });

  it("hostile tone blocks externally and warns internally", () => {
    const a = { ...clean(), tone: s(2.8) };
    expect(decide(a, "external_customer", []).verdict).toBe("block");
    expect(decide(a, "internal", []).verdict).toBe("warn");
    expect(decide({ ...clean(), tone: s(1.9) }, "internal", []).verdict).toBe("warn");
  });

  it("collects culprit spans above threshold", () => {
    const spans: Span[] = [
      { id: "span_0", kind: "money", text: "$4", start: 0, end: 2 },
      { id: "span_1", kind: "email", text: "a@b.co", start: 3, end: 9 },
    ];
    const a = { ...clean(), span_0: n(0.8), span_1: n(0.2) };
    expect(decide(a, "external_customer", spans).culpritSpanIds).toEqual(["span_0"]);
  });
});

describe("chip helpers", () => {
  it("maps tone scores to labels", () => {
    expect(toneLabel(0.2)).toBe("warm");
    expect(toneLabel(1.4)).toBe("neutral");
    expect(toneLabel(2.9)).toBe("hostile");
  });
  it("colours chips by severity", () => {
    expect(chipState("contains_secret_or_credential", { contains_secret_or_credential: n(0.9) })).toBe("bad");
    expect(chipState("makes_binding_commitment", { makes_binding_commitment: n(0.9) })).toBe("warn");
    expect(chipState("is_appropriate_for_audience", { is_appropriate_for_audience: n(0.1) })).toBe("bad");
    expect(chipState("tone", {})).toBe("pending");
  });
  it("worse() orders send < warn < block", () => {
    expect(worse("send", "warn")).toBe("warn");
    expect(worse("block", "warn")).toBe("block");
  });
});
