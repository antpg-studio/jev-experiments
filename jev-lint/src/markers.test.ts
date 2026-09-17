import { describe, expect, it } from "vitest";
import { evaluate, pct } from "./eval.ts";
import { heuristicMarker, heuristicScan } from "./heuristics.ts";
import { buildRequest, clusterMarkers, markersFromAnswers, severityFromChoice, THRESHOLDS, type JevAnswer, type LineRef, type Marker } from "./markers.ts";
import { Metrics, percentile } from "./metrics.ts";

const ref = (id: string, line: number, text = "x"): LineRef => ({ id, line, text });

function answers(id: string, nouls: Partial<Record<string, number>>, choice?: { choice: string; confidence: number; probabilities?: Record<string, number> }): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {};
  for (const [k, p] of Object.entries(nouls)) out[`${id}.${k}`] = { type: "noul", noul: p ?? 0 };
  if (choice) out[`${id}.severity`] = { type: "choice", choice: choice.choice, confidence: choice.confidence, probabilities: choice.probabilities ?? {} };
  return out;
}

describe("buildRequest", () => {
  const src = ["import x from 'y';", "", "function f(a: number) {", "  const b = a + 1;", "  return b;", "}", ""].join("\n");

  it("fans out 5 nouls + 1 choice per judged line and carries the function context", () => {
    const built = buildRequest(src, "typescript", [4, 5]);
    expect(built).toBeDefined();
    const q = Object.keys(built!.request.questions);
    expect(q).toHaveLength(12);
    expect(q.filter((k) => k.endsWith(".severity"))).toHaveLength(2);
    expect(built!.request.model).toBe("jev-latest");
    const state = built!.request.state;
    expect(state.language).toBe("typescript");
    expect(state.function_name).toBe("f");
    expect(state.function_source).toContain("4:   const b = a + 1;");
    expect(state.lines_under_review).toEqual([
      { line: 4, text: "  const b = a + 1;" },
      { line: 5, text: "  return b;" },
    ]);
    expect(state.file_imports).toEqual(["import x from 'y';"]);
    expect(state.identifiers).toEqual({ declared: ["f", "a", "b"], used: ["number"] });
  });

  it("skips lines that are not worth judging", () => {
    expect(buildRequest(src, "typescript", [2])).toBeUndefined();
    expect(buildRequest(src, "typescript", [6])).toBeUndefined();
  });

  it("question instructions reference the exact line number", () => {
    const built = buildRequest(src, "typescript", [4])!;
    for (const q of Object.values(built.request.questions)) expect(q.instructions).toContain("line 4");
  });
});

describe("markersFromAnswers", () => {
  it("raises a marker for a strong noul and orders kinds by probability", () => {
    const [m] = markersFromAnswers([ref("c0", 7)], answers("c0", { probable_bug: 0.9, security_risk: 0.1, misleading_name: 0.3 }, { choice: "error", confidence: 0.8 }));
    expect(m.line).toBe(7);
    expect(m.severity).toBe("error");
    expect(m.kinds.map((k) => k.kind)).toEqual(["probable_bug", "misleading_name", "security_risk"]);
    expect(m.message).toBe("probable bug 90% · misleading name 30%");
    expect(m.source).toBe("jev");
  });

  it("stays quiet when nothing is strong", () => {
    expect(markersFromAnswers([ref("c0", 1)], answers("c0", { probable_bug: 0.3 }, { choice: "ignore", confidence: 0.9 }))).toEqual([]);
    expect(markersFromAnswers([ref("c0", 1)], answers("c0", { probable_bug: 0.3 }, { choice: "warning", confidence: 0.4 }))).toEqual([]);
    expect(markersFromAnswers([ref("c0", 1)], answers("c0", { probable_bug: 0.05 }, { choice: "warning", confidence: 0.9 }))).toEqual([]);
  });

  it("ignore + strong noul degrades to info, or warning when the noul is very strong", () => {
    expect(markersFromAnswers([ref("c0", 1)], answers("c0", { dead_or_unreachable: 0.7 }, { choice: "ignore", confidence: 0.6 }))[0].severity).toBe("info");
    expect(markersFromAnswers([ref("c0", 1)], answers("c0", { dead_or_unreachable: 0.9 }, { choice: "ignore", confidence: 0.6 }))[0].severity).toBe("warning");
    expect(markersFromAnswers([ref("c0", 1)], answers("c0", { dead_or_unreachable: 0.9 }, { choice: "info", confidence: 0.6 }))[0].severity).toBe("warning");
  });

  it("a confident warning choice with a moderate noul still raises", () => {
    const [m] = markersFromAnswers([ref("c0", 1)], answers("c0", { performance_smell: 0.4 }, { choice: "warning", confidence: 0.7, probabilities: { warning: 0.7, info: 0.2 } }));
    expect(m.severity).toBe("warning");
    expect(m.severityProbabilities).toEqual({ ignore: 0, info: 0.2, warning: 0.7, error: 0 });
  });

  it("maps several refs independently and tolerates missing answers", () => {
    const a = { ...answers("c0", { probable_bug: 0.95 }, { choice: "error", confidence: 0.9 }), ...answers("c1", { probable_bug: 0.1 }) };
    const ms = markersFromAnswers([ref("c0", 3), ref("c1", 4), ref("c2", 5)], a);
    expect(ms.map((m) => m.line)).toEqual([3]);
  });

  it("severityFromChoice falls back to the most probable option", () => {
    expect(severityFromChoice("error", {})).toBe("error");
    expect(severityFromChoice("???", { info: 0.2, warning: 0.7 })).toBe("warning");
    expect(severityFromChoice("???", {})).toBe("ignore");
  });
});

const mk = (line: number, severity: Marker["severity"], kind: Marker["kinds"][number]["kind"], p: number, source: Marker["source"] = "jev"): Marker => ({
  line,
  severity,
  kinds: [{ kind, p }],
  message: "",
  source,
});

describe("clusterMarkers", () => {
  it("keeps the earliest strong line of a same-kind run and demotes the spill-over", () => {
    const out = clusterMarkers([mk(49, "error", "probable_bug", 0.9), mk(48, "warning", "probable_bug", 0.8)]);
    expect(out.map((m) => [m.line, m.severity])).toEqual([
      [48, "error"],
      [49, "info"],
    ]);
  });

  it("does not merge different kinds, info markers, distant lines, or heuristic markers", () => {
    const out = clusterMarkers([
      mk(1, "error", "security_risk", 0.9),
      mk(2, "error", "probable_bug", 0.9),
      mk(3, "info", "probable_bug", 0.5),
      mk(6, "warning", "probable_bug", 0.7),
      mk(7, "warning", "probable_bug", 0.7, "heuristic"),
    ]);
    expect(out.map((m) => m.severity)).toEqual(["error", "error", "info", "warning", "warning"]);
  });

  it("falls back to the highest probability when nothing clears the noul threshold", () => {
    const out = clusterMarkers([mk(10, "warning", "performance_smell", 0.4), mk(11, "warning", "performance_smell", 0.5)]);
    expect(out.find((m) => m.line === 11)?.severity).toBe("warning");
    expect(out.find((m) => m.line === 10)?.severity).toBe("info");
    expect(THRESHOLDS.noul).toBeGreaterThan(0.5);
  });
});

describe("evaluate", () => {
  const planted = [
    { line: 3, kind: "probable_bug" as const, note: "" },
    { line: 8, kind: "security_risk" as const, note: "" },
    { line: 12, kind: "misleading_name" as const, note: "" },
  ];

  it("computes tp/fp/fn and precision/recall, counting only warning+ markers", () => {
    const ev = evaluate([mk(3, "error", "probable_bug", 0.9), mk(8, "warning", "performance_smell", 0.7), mk(12, "info", "misleading_name", 0.6), mk(20, "warning", "probable_bug", 0.7)], planted);
    expect([ev.tp, ev.fp, ev.fn]).toEqual([2, 1, 1]);
    expect(ev.precision).toBeCloseTo(2 / 3);
    expect(ev.recall).toBeCloseTo(2 / 3);
    expect(ev.f1).toBeCloseTo(2 / 3);
    expect(ev.kindMatches).toBe(1);
    expect(ev.flaggedLines).toEqual([3, 8, 20]);
    expect(ev.missedLines).toEqual([12]);
    expect(ev.falseLines).toEqual([20]);
  });

  it("handles the empty cases without dividing by zero", () => {
    const ev = evaluate([], planted);
    expect(ev.precision).toBeNull();
    expect(ev.recall).toBe(0);
    expect(pct(ev.precision)).toBe("—");
    expect(pct(evaluate([], []).recall)).toBe("—");
    expect(pct(0.856)).toBe("86%");
  });
});

describe("heuristics", () => {
  it("flags the obvious patterns and stays quiet on clean code", () => {
    expect(heuristicMarker(1, 'db.query("SELECT * FROM users WHERE id = " + id)', "typescript")?.kinds[0].kind).toBe("security_risk");
    expect(heuristicMarker(1, 'row := s.db.QueryRow("SELECT name FROM users WHERE id = " + id)', "go")?.kinds[0].kind).toBe("security_risk");
    expect(heuristicMarker(1, "for (let i = 0; i <= items.length; i++) {", "typescript")?.kinds[0].kind).toBe("probable_bug");
    expect(heuristicMarker(1, "if (total = 5000) return true;", "typescript")?.kinds[0].kind).toBe("probable_bug");
    expect(heuristicMarker(1, 'const total = items.reduce((a, b) => a + b, 0);', "typescript")).toBeUndefined();
    expect(heuristicMarker(1, "return users;", "typescript")).toBeUndefined();
  });

  it("scan returns one marker per line, sorted", () => {
    const ms = heuristicScan('const a = 1;\nconst p = eval(input);\nconst k = "abcdefghijk";\nconst apiKey = "sk_live_0123456789";\n', "typescript");
    expect(ms.map((m) => m.line)).toEqual([2, 4]);
    expect(ms.every((m) => m.source === "heuristic")).toBe(true);
  });
});

describe("metrics", () => {
  it("percentile picks nearest-rank values", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([300, 100, 200], 0.5)).toBe(200);
    expect(percentile([300, 100, 200], 0.95)).toBe(300);
    expect(percentile([5], 0.95)).toBe(5);
  });

  it("aggregates tokens, cost and trailing-window rates", () => {
    const m = new Metrics();
    const now = 1_000_000;
    m.record({ at: now - 70_000, ms: 500, questions: 10, inputTokens: 1000, outputTokens: 5 });
    m.record({ at: now - 5_000, ms: 100, questions: 6, inputTokens: 600, outputTokens: 5 });
    m.record({ at: now - 1_000, ms: 200, questions: 6, inputTokens: 400, outputTokens: 5 });
    const s = m.snapshot(now);
    expect(s.requests).toBe(3);
    expect(s.lastMs).toBe(200);
    expect(s.p50).toBe(200);
    expect(s.judgmentsPerMin).toBe(12);
    expect(s.decisionsPerSec).toBeCloseTo(1.2);
    expect(s.inputTokens).toBe(2000);
    expect(s.tokensPerJudgment).toBeCloseTo(2000 / 22);
    expect(s.costUsd).toBeCloseTo(2000 * 42e-9);
    expect(s.costPerHourUsd).toBeCloseTo(1000 * 42e-9 * 60);
  });
});
