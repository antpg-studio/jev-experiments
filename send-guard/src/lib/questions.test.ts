import { describe, expect, it } from "vitest";
import { buildRequestBody, CORE_QUESTION_IDS } from "./questions";
import { findSpans } from "./spans";

describe("buildRequestBody", () => {
  it("puts the ten core judgments plus one speculative noul per span into a single request", () => {
    const draft = "we'll refund $500 by Friday, contact jane@example.com";
    const spans = findSpans(draft);
    const body = buildRequestBody({ channel: { name: "#customer-acme", audience: "external_customer" }, draft, spans });
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(body.questions)).toEqual([...CORE_QUESTION_IDS, ...spans.map((s) => s.id)]);
    expect(body.state.spans).toHaveLength(spans.length);
    expect(body.state.spans[0]).not.toHaveProperty("start");
    for (const q of Object.values(body.questions)) {
      expect(["noul", "choice", "score"]).toContain(q.type);
      if (q.type === "score") expect(q.criteria.length).toBeGreaterThanOrEqual(2);
      if (q.type === "choice") expect(Object.keys(q.criteria)).toEqual(["send", "warn", "block"]);
    }
  });
});
