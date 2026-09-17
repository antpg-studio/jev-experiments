import { describe, expect, it } from "vitest";
import { evaluateKeyword, isKeywordActionItem } from "./keyword.ts";
import { fmtClock, fmtMs, percentile, summarize } from "./stats.ts";
import { createLimiter } from "./queue.ts";
import { createSegmenter, splitSentences } from "./segment.ts";
import { TRANSCRIPT } from "../data/transcript.ts";

describe("keyword baseline", () => {
  it("flags commitment keywords and misses implicit commitments", () => {
    expect(isKeywordActionItem("I'll send the doc")).toBe(true);
    expect(isKeywordActionItem("Marcus, take the migration.")).toBe(false);
    expect(isKeywordActionItem("Okay, upsell impression event, this week.")).toBe(false);
  });
  it("computes miss rate and precision", () => {
    const r = evaluateKeyword([
      { text: "I will do it", isAction: true },
      { text: "Sure, mine.", isAction: true },
      { text: "We should be fine", isAction: false },
      { text: "Morning", isAction: false },
    ]);
    expect(r).toMatchObject({ total: 2, truePositives: 1, falseNegatives: 1, falsePositives: 1, missRate: 0.5, precision: 0.5 });
  });
  it("misses a substantial share of the fixture's labelled action items", () => {
    const r = evaluateKeyword(TRANSCRIPT.map((u) => ({ text: u.text, isAction: u.truth.kind === "action_item" })));
    expect(r.total).toBe(50);
    expect(r.missRate).toBeGreaterThan(0.25);
  });
});

describe("fixture", () => {
  it("is a 12-minute, 180-utterance, 4-speaker meeting", () => {
    expect(TRANSCRIPT).toHaveLength(180);
    expect(TRANSCRIPT.at(-1)?.endsAt).toBe(720);
    expect(new Set(TRANSCRIPT.map((u) => u.speaker)).size).toBe(4);
    for (let i = 1; i < TRANSCRIPT.length; i++) expect(TRANSCRIPT[i].endsAt).toBeGreaterThan(TRANSCRIPT[i - 1].endsAt);
  });
  it("contains at least one reversed decision and one blocker", () => {
    expect(TRANSCRIPT.some((u) => u.truth.reverses)).toBe(true);
    expect(TRANSCRIPT.some((u) => u.truth.blocked)).toBe(true);
  });
});

describe("stats", () => {
  it("nearest-rank percentiles", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
    expect(summarize([300, 100, 200])).toEqual({ n: 3, p50: 200, p95: 300, max: 300, mean: 200 });
  });
  it("formats", () => {
    expect(fmtMs(87.4)).toBe("87 ms");
    expect(fmtMs(1234)).toBe("1.23 s");
    expect(fmtClock(725.9)).toBe("12:05");
  });
});

describe("createLimiter", () => {
  it("never exceeds the concurrency limit and preserves results", async () => {
    const lim = createLimiter(3);
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, i) =>
      lim.run(async () => {
        peak = Math.max(peak, lim.active);
        await new Promise((r) => setTimeout(r, 5));
        return i;
      }),
    );
    expect(lim.active).toBe(3);
    expect(lim.queued).toBe(7);
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
    expect(lim.active).toBe(0);
  });
  it("releases the slot when a task rejects", async () => {
    const lim = createLimiter(1);
    await expect(lim.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await lim.run(async () => "ok")).toBe("ok");
  });
});

describe("sentence segmentation", () => {
  it("splits on terminal punctuation and keeps abbreviations together", () => {
    expect(splitSentences("We ship Friday. Marcus takes the migration, e.g. the column. Okay?")).toEqual({
      complete: ["We ship Friday.", "Marcus takes the migration, e.g. the column.", "Okay?"],
      rest: "",
    });
  });
  it("holds back an unterminated fragment until more text arrives", () => {
    const seg = createSegmenter();
    expect(seg.push("I'll have the specs")).toEqual([]);
    expect(seg.pending).toBe("I'll have the specs");
    expect(seg.push("by Monday. Also the")).toEqual(["I'll have the specs by Monday."]);
    expect(seg.flush()).toEqual(["Also the."]);
    expect(seg.pending).toBe("");
  });
  it("drops sentences shorter than the minimum word count", () => {
    expect(createSegmenter(3).push("Okay. Sounds good to me.")).toEqual(["Sounds good to me."]);
  });
});
