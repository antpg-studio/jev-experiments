import { describe, expect, it } from "vitest";
import { evaluate, evaluateHunk, evaluateMessage, percentile, quoteOffendingLines, summariseFiles } from "../src/policy.ts";
import { FINDING_IDS, type FindingId, type Hunk, type HunkJudgment, type MessageJudgment } from "../src/types.ts";

function hunk(id: string, adds: string[]): Hunk {
  const lines = adds.map((text, i) => ({ kind: "add" as const, text, newLine: 10 + i, oldLine: undefined }));
  return {
    id,
    file: id.split("#")[0]!,
    oldFile: id.split("#")[0]!,
    language: "typescript",
    oldStart: 10,
    oldCount: 0,
    newStart: 10,
    newCount: adds.length,
    header: "",
    lines,
    text: adds.map((a) => "+" + a).join("\n"),
    isNewFile: false,
    isDeletedFile: false,
  };
}

function judgment(hunkId: string, overrides: Partial<HunkJudgment> & { p?: Partial<Record<FindingId, number>> } = {}): HunkJudgment {
  const findings = {} as Record<FindingId, number>;
  for (const id of FINDING_IDS) findings[id] = overrides.p?.[id] ?? 0.02;
  const { p: _p, ...rest } = overrides;
  return {
    hunkId,
    risk: 1,
    riskLevel: "low",
    riskConfidence: 0.9,
    kind: "bugfix",
    kindConfidence: 0.9,
    findings,
    offendingLineIndex: null,
    latencyMs: 150,
    inputTokens: 100,
    outputTokens: 10,
    attempts: 1,
    ...rest,
  };
}

describe("evaluateHunk", () => {
  it("passes a benign hunk", () => {
    const h = hunk("a.ts#0", ["const x = 1;"]);
    expect(evaluateHunk(h, judgment(h.id), { strict: false })).toEqual([]);
  });

  it("blocks a secret above the block threshold and quotes the offending line", () => {
    const h = hunk("a.ts#0", ["const a = 1;", 'const KEY = "sk_live_abc";']);
    const f = evaluateHunk(h, judgment(h.id, { p: { leaks_secret_or_token: 0.91 }, offendingLineIndex: 1 }), { strict: false });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "leaks_secret_or_token", severity: "block", line: 11, quoted: ['+const KEY = "sk_live_abc";'] });
  });

  it("only warns on a secret between report and block thresholds", () => {
    const h = hunk("a.ts#0", ["x"]);
    const f = evaluateHunk(h, judgment(h.id, { p: { leaks_secret_or_token: 0.6 } }), { strict: false });
    expect(f.map((x) => x.severity)).toEqual(["warn"]);
  });

  it("warn-only findings become blocks under --strict", () => {
    const h = hunk("t.test.ts#0", ["it.skip('x', () => {})"]);
    const j = judgment(h.id, { p: { disables_or_skips_tests: 0.95 } });
    expect(evaluateHunk(h, j, { strict: false })[0]?.severity).toBe("warn");
    expect(evaluateHunk(h, j, { strict: true })[0]?.severity).toBe("block");
  });

  it("blocks on dangerous risk even without a named finding", () => {
    const h = hunk("auth.ts#0", ['if (token === "letmein") return admin;']);
    const f = evaluateHunk(h, judgment(h.id, { risk: 3.8, riskLevel: "dangerous" }), { strict: false });
    expect(f).toEqual([expect.objectContaining({ id: "risk", severity: "block", label: "dangerous risk change" })]);
  });

  it("warns on moderate risk with no named finding, but not when a finding already exists", () => {
    const h = hunk("a.ts#0", ["x"]);
    expect(evaluateHunk(h, judgment(h.id, { risk: 2.6, riskLevel: "moderate" }), { strict: false })).toHaveLength(1);
    const withFinding = evaluateHunk(
      h,
      judgment(h.id, { risk: 2.6, riskLevel: "moderate", p: { leftover_debug_or_temp: 0.8 } }),
      { strict: false },
    );
    expect(withFinding.map((f) => f.id)).toEqual(["leftover_debug_or_temp"]);
  });

  it("high risk blocks only under --strict", () => {
    const h = hunk("a.ts#0", ["x"]);
    const j = judgment(h.id, { risk: 3.0, riskLevel: "high" });
    expect(evaluateHunk(h, j, { strict: false })[0]?.severity).toBe("warn");
    expect(evaluateHunk(h, j, { strict: true })[0]?.severity).toBe("block");
  });

  it("sorts blocking findings before warnings, then by probability", () => {
    const h = hunk("a.ts#0", ["x"]);
    const f = evaluateHunk(
      h,
      judgment(h.id, { p: { leftover_debug_or_temp: 0.99, destructive_data_change: 0.75, hardcoded_env_specific_value: 0.55 } }),
      { strict: false },
    );
    expect(f.map((x) => x.id)).toEqual(["destructive_data_change", "leftover_debug_or_temp", "hardcoded_env_specific_value"]);
  });
});

describe("quoteOffendingLines", () => {
  it("falls back to the first added lines when Jev picked none", () => {
    const h = hunk("a.ts#0", ["one", "two", "three", "four"]);
    expect(quoteOffendingLines(h, judgment(h.id)).quoted).toEqual(["+one", "+two", "+three"]);
  });

  it("quotes deleted lines for a pure deletion", () => {
    const h = hunk("a.ts#0", []);
    h.lines = [{ kind: "del", text: "gone", newLine: undefined, oldLine: 3 }];
    expect(quoteOffendingLines(h, judgment(h.id))).toEqual({ quoted: ["-gone"], line: undefined });
  });
});

describe("evaluateMessage", () => {
  const msg = (matches: number): MessageJudgment => ({
    matchesChanges: matches,
    quality: 1,
    qualityLevel: "vague",
    qualityConfidence: 0.8,
    latencyMs: 120,
    inputTokens: 50,
    outputTokens: 5,
  });
  it("is silent when the message matches or is absent", () => {
    expect(evaluateMessage(null, { strict: false })).toEqual([]);
    expect(evaluateMessage(msg(0.8), { strict: false })).toEqual([]);
  });
  it("warns on mismatch, blocks under --strict", () => {
    expect(evaluateMessage(msg(0.05), { strict: false })[0]).toMatchObject({ id: "message_mismatch", severity: "warn", probability: 0.95 });
    expect(evaluateMessage(msg(0.05), { strict: true })[0]?.severity).toBe("block");
  });
});

describe("evaluate / summariseFiles", () => {
  it("aggregates verdicts and per-file summaries", () => {
    const hs = [hunk("a.ts#0", ["x"]), hunk("a.ts#1", ["y"]), hunk("b.ts#0", ["z"])];
    const js = [
      judgment("a.ts#0", { p: { destructive_data_change: 0.9 }, risk: 3.9, riskLevel: "dangerous", kind: "feature" }),
      judgment("a.ts#1", { p: { leftover_debug_or_temp: 0.7 }, kind: "chore" }),
      judgment("b.ts#0", { risk: 0.2, riskLevel: "cosmetic", kind: "docs" }),
    ];
    const r = evaluate(hs, js, null, { strict: false });
    expect(r.verdict).toBe("block");
    expect(r.blocking).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    const s = summariseFiles(hs, js, r.findings);
    expect(s.map((x) => x.file)).toEqual(["a.ts", "b.ts"]);
    expect(s[0]).toMatchObject({ hunks: 2, maxRisk: 3.9, findings: 3, blocking: 2, kinds: ["feature", "chore"] });
    expect(s[1]).toMatchObject({ hunks: 1, findings: 0, blocking: 0 });
  });

  it("returns pass when nothing is flagged and warn when only warnings", () => {
    const hs = [hunk("a.ts#0", ["x"])];
    expect(evaluate(hs, [judgment("a.ts#0")], null, { strict: false }).verdict).toBe("pass");
    expect(evaluate(hs, [judgment("a.ts#0", { p: { changes_public_api_shape: 0.9 } })], null, { strict: false }).verdict).toBe("warn");
  });
});

describe("percentile", () => {
  it("computes nearest-rank percentiles", () => {
    const s = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
    expect(percentile(s, 50)).toBe(140);
    expect(percentile(s, 95)).toBe(190);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([], 50)).toBe(0);
  });
});
