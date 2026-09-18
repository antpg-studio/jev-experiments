import { describe, expect, it } from "vitest";
import { findSpans, regexOnlyFlags } from "./spans";

describe("findSpans", () => {
  it("locates keys, emails, phones, money and dates with correct offsets", () => {
    const draft = "key sk-live-4f9a2c7e1b8d6a3f0c5e9b2d7a1f4c8e, mail jane@example.com, call 555-123-4567, $2,000 by Friday";
    const spans = findSpans(draft);
    const kinds = spans.map((s) => s.kind);
    expect(kinds).toEqual(["key", "email", "phone", "money", "date"]);
    for (const s of spans) expect(draft.slice(s.start, s.end)).toBe(s.text);
    expect(spans.map((s) => s.id)).toEqual(["span_0", "span_1", "span_2", "span_3", "span_4"]);
  });

  it("does not return overlapping spans and caps at 8", () => {
    const draft = Array.from({ length: 12 }, (_, i) => `$${i}0`).join(" ");
    const spans = findSpans(draft);
    expect(spans).toHaveLength(8);
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
  });

  it("finds GitHub, AWS, Slack and JWT-style tokens", () => {
    expect(findSpans("ghp_abcdefghijklmnopqrstuvwxyz0123").map((s) => s.kind)).toEqual(["key"]);
    expect(findSpans("AKIAABCDEFGHIJKLMNOP").map((s) => s.kind)).toEqual(["key"]);
    expect(findSpans("xoxb-1234567890-abcdefghij").map((s) => s.kind)).toEqual(["key"]);
    expect(findSpans("password: hunter2hunter2").map((s) => s.kind)).toEqual(["key"]);
  });

  it("returns nothing for plain prose", () => {
    expect(findSpans("Good news, v2.3 is out! Ping me if anything looks off.")).toEqual([]);
  });

  it("regex-only DLP flags only key/email/phone", () => {
    const spans = findSpans("sk-live-4f9a2c7e1b8d6a3f0c5e9b2d7a1f4c8e $500 by Friday jane@example.com");
    expect(regexOnlyFlags(spans).map((s) => s.kind)).toEqual(["key", "email"]);
  });
});
