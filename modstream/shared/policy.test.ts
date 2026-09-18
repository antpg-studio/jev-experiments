import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, decide, emptyScore, isBlocking, scoreVerdict } from "./policy.ts";
import { wordListMatch } from "./wordlist.ts";
import { percentile, Rolling } from "./stats.ts";
import { allFixtureLines, generateLine, makeRng, makeUsers } from "./corpus.ts";
import type { Judgment } from "./types.ts";

const base: Judgment = {
  action: "allow",
  actionProbabilities: { allow: 0.97, hide: 0.01, timeout_user: 0.01, escalate_to_human: 0.01 },
  actionConfidence: 0.97,
  harassment: 0.02,
  scam_or_phishing: 0.01,
  self_harm_risk: 0.01,
  spam: 0.03,
  is_obfuscated_slur_or_evasion: 0.02,
  severity: 0.1,
  severityConfidence: 0.9,
};
const j = (over: Partial<Judgment>): Judgment => ({ ...base, ...over });

describe("decide", () => {
  it("allows ordinary chat", () => {
    expect(decide(base, DEFAULT_THRESHOLDS).decision).toBe("allow");
  });
  it("routes self-harm to care before anything else, even with a timeout signal", () => {
    const r = decide(j({ self_harm_risk: 0.9, harassment: 0.95, action: "timeout_user" }), DEFAULT_THRESHOLDS);
    expect(r.decision).toBe("care");
  });
  it("times out obfuscated slurs", () => {
    const r = decide(j({ is_obfuscated_slur_or_evasion: 0.94, harassment: 0.98, severity: 3, action: "timeout_user" }), DEFAULT_THRESHOLDS);
    expect(r.decision).toBe("timeout_user");
    expect(r.reason).toMatch(/obfuscated/);
  });
  it("hides scams without a timeout", () => {
    const r = decide(j({ scam_or_phishing: 0.99, action: "hide", actionConfidence: 0.99, severity: 2 }), DEFAULT_THRESHOLDS);
    expect(r.decision).toBe("hide");
    expect(r.reason).toMatch(/scam/);
  });
  it("sends low-confidence non-allow choices to review", () => {
    const r = decide(j({ action: "hide", actionConfidence: 0.34, harassment: 0.5 }), DEFAULT_THRESHOLDS);
    expect(r.decision).toBe("review");
  });
  it("sends explicit escalations to review", () => {
    const r = decide(j({ action: "escalate_to_human", actionConfidence: 0.9 }), DEFAULT_THRESHOLDS);
    expect(r.decision).toBe("review");
  });
  it("re-applies thresholds without new inference", () => {
    const soft = j({ spam: 0.7, action: "allow", actionConfidence: 0.8 });
    expect(decide(soft, DEFAULT_THRESHOLDS).decision).toBe("hide");
    expect(decide(soft, { ...DEFAULT_THRESHOLDS, hide: 0.8 }).decision).toBe("allow");
  });
  it("treats a missing judgment as review", () => {
    expect(decide(null, DEFAULT_THRESHOLDS).decision).toBe("review");
  });
});

describe("scoreVerdict", () => {
  it("counts catches and false positives, ignoring self-harm", () => {
    const acc = emptyScore();
    scoreVerdict(acc, "scam", true);
    scoreVerdict(acc, "harassment", false);
    scoreVerdict(acc, "ok", true);
    scoreVerdict(acc, "ok", false);
    scoreVerdict(acc, "self_harm", true);
    expect(acc).toEqual({ harmfulTotal: 2, caught: 1, wronglyBlocked: 1, cleanTotal: 2 });
  });
  it("isBlocking covers hide/timeout/care", () => {
    expect(isBlocking("hide")).toBe(true);
    expect(isBlocking("care")).toBe(true);
    expect(isBlocking("allow")).toBe(false);
    expect(isBlocking("review")).toBe(false);
  });
});

describe("wordListMatch", () => {
  it("catches literal terms", () => {
    expect(wordListMatch("kys already")).toBe("kys");
    expect(wordListMatch("Free giftcards here")).toBe("free");
  });
  it("misses leetspeak evasion", () => {
    expect(wordListMatch("k1ll yours3lf")).toBeNull();
    expect(wordListMatch("what a f@g")).toBeNull();
  });
  it("wrongly flags innocent gamer chat", () => {
    expect(wordListMatch("this boss is killing me")).toBe("kill");
    expect(wordListMatch("i died to that jump")).toBe("die");
    expect(wordListMatch("my aim is trash today lol")).toBe("trash");
    expect(wordListMatch("wait is there a free weekend on steam?")).toBe("free");
  });
});

describe("stats", () => {
  it("percentile picks nearest-rank", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
  });
  it("Rolling keeps only the last N", () => {
    const r = new Rolling(3);
    [1, 2, 3, 4].forEach((n) => r.push(n));
    expect([...r.values()]).toEqual([2, 3, 4]);
  });
});

describe("corpus", () => {
  it("is deterministic for a seed", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    const users = makeUsers(50, makeRng(1));
    expect(generateLine(a, users)).toEqual(generateLine(b, users));
  });
  it("generates 1000 unique usernames", () => {
    const users = makeUsers(1000, makeRng(3));
    expect(new Set(users.map((u) => u.name)).size).toBe(1000);
  });
  it("fixture contains bait the word list blocks and evasions it misses", () => {
    const lines = allFixtureLines();
    const fp = lines.filter((l) => l.truth === "ok" && wordListMatch(l.text));
    const miss = lines.filter((l) => l.truth === "slur_evasion" && !wordListMatch(l.text));
    expect(fp.length).toBeGreaterThan(0);
    expect(miss.length).toBeGreaterThan(0);
  });
});
