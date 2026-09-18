import { describe, expect, it } from "vitest";
import { buildState, heuristicJudgment, parseJudgment, questions } from "./jev.ts";
import { defaultThresholds, inModQueue, isSpoiler, isStreamerQuestion, modReason } from "./policy.ts";
import { createGenerator } from "./generator.ts";

const sample = {
  model: "jev-1.13.0",
  answers: {
    harassment: { type: "noul", noul: 0.02 },
    spam_or_scam: { type: "noul", noul: 0.04 },
    spoiler: { type: "noul", noul: 0.16 },
    question_for_streamer: { type: "noul", noul: 0.91 },
    needs_mod_attention: { type: "noul", noul: 0.1 },
    positive_hype: { type: "noul", noul: 0.27 },
    language: { type: "choice", choice: "spanish", confidence: 0.93, probabilities: { spanish: 0.93, english: 0.05, other: 0.02 } },
  },
  usage: { input_tokens: 515, output_tokens: 200 },
};

describe("Jev request/response", () => {
  it("asks all seven judgments with the language choice covering 8 languages + other", () => {
    expect(Object.keys(questions).sort()).toEqual(["harassment", "language", "needs_mod_attention", "positive_hype", "question_for_streamer", "spam_or_scam", "spoiler"]);
    expect(Object.keys(questions.language.criteria)).toHaveLength(9);
    expect(questions.language.criteria).toHaveProperty("other");
  });

  it("builds state with the stream context and the message", () => {
    const m = createGenerator(1).next();
    const s = buildState(m);
    expect(s.message.text).toBe(m.text);
    expect(s.message.user).toBe(m.user);
    expect(s.stream.game).toBeTruthy();
  });

  it("parses a full response into a Judgment", () => {
    const j = parseJudgment(sample);
    expect(j.question_for_streamer).toBe(0.91);
    expect(j.language).toBe("spanish");
    expect(j.languageConfidence).toBe(0.93);
    expect(j.inputTokens).toBe(515);
    expect(j.source).toBe("jev");
  });

  it("is defensive about missing or malformed answers", () => {
    const j = parseJudgment({ answers: { harassment: { type: "noul", noul: 7 }, language: { type: "choice", choice: "klingon", confidence: 0.4, probabilities: {} } } });
    expect(j.harassment).toBe(1);
    expect(j.spoiler).toBe(0);
    expect(j.language).toBe("other");
    expect(j.inputTokens).toBe(0);
  });
});

describe("heuristic fallback", () => {
  it("flags obvious scams and harassment, passes hype", () => {
    expect(heuristicJudgment("free vbucks at free-vbucks-gift[.]com").spam_or_scam).toBeGreaterThan(0.5);
    expect(heuristicJudgment("kys trash streamer").harassment).toBeGreaterThan(0.5);
    expect(heuristicJudgment("LETS GOOOO").harassment).toBeLessThan(0.5);
    expect(heuristicJudgment("what mouse do you use?").question_for_streamer).toBeGreaterThan(0.5);
    expect(heuristicJudgment("マウスは何を使ってますか？").language).toBe("japanese");
    expect(heuristicJudgment("hi").source).toBe("heuristic");
  });
});

describe("threshold policy", () => {
  const j = parseJudgment(sample);
  it("re-filters stored probabilities without re-querying", () => {
    expect(isStreamerQuestion(j, defaultThresholds)).toBe(true);
    expect(isStreamerQuestion(j, { ...defaultThresholds, question: 0.95 })).toBe(false);
    expect(inModQueue(j, defaultThresholds)).toBe(false);
    expect(inModQueue(j, { ...defaultThresholds, modAttention: 0.1 })).toBe(true);
    expect(isSpoiler(j, defaultThresholds)).toBe(false);
    expect(isSpoiler(j, { ...defaultThresholds, spoiler: 0.1 })).toBe(true);
  });

  it("puts harassment above the mod-attention bar and names the reason", () => {
    const hostile = { ...j, harassment: 0.8, needs_mod_attention: 0.2 };
    expect(inModQueue(hostile, defaultThresholds)).toBe(true);
    expect(modReason(hostile, defaultThresholds)).toBe("harassment");
    expect(modReason({ ...j, needs_mod_attention: 0.9, spam_or_scam: 0.8 }, defaultThresholds)).toBe("scam");
    expect(modReason({ ...j, needs_mod_attention: 0.9 }, defaultThresholds)).toBe("review");
    expect(isStreamerQuestion({ ...j, harassment: 0.9 }, defaultThresholds)).toBe(false);
  });
});
