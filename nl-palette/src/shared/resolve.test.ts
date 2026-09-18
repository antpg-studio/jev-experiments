import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { QUESTION_IDS, type Answer } from "./questions.ts";
import { CONFIDENCE_GATE, describeArg, previewLabel, resolveAnswers } from "./resolve.ts";

function answers(top: string, topP: number, extra: Record<string, Answer> = {}): Record<string, Answer> {
  const probabilities: Record<string, number> = {};
  const rest = (1 - topP) / (COMMANDS.length - 1);
  for (const c of COMMANDS) probabilities[c.id] = c.id === top ? topP : rest;
  return {
    [QUESTION_IDS.command]: { type: "choice", choice: top, confidence: topP, probabilities },
    ...extra,
  };
}

describe("resolveAnswers", () => {
  it("ranks by probability and fills only the relevant argument slot", () => {
    const res = resolveAnswers(
      answers("change_font_size", 0.9, {
        font_size_delta: { type: "choice", choice: "+2", confidence: 0.8, probabilities: { "-4": 0.05, "-2": 0.05, "+2": 0.8, "+4": 0.1 } },
        theme: { type: "choice", choice: "dark", confidence: 0.5, probabilities: { dark: 0.5, light: 0.5, sepia: 0, high_contrast: 0 } },
      }),
    );
    expect(res.ranked[0].command.id).toBe("change_font_size");
    expect(res.ranked[0].arg).toBe("+2");
    expect(previewLabel(res.ranked[0])).toBe("Change Font Size by +2 pt");
    expect(res.gate).toBe("confident");
    const sidebar = res.ranked.find((r) => r.command.id === "toggle_sidebar");
    expect(sidebar?.arg).toBeUndefined();
  });

  it("gates low confidence", () => {
    const res = resolveAnswers(answers("toggle_sidebar", CONFIDENCE_GATE - 0.01));
    expect(res.gate).toBe("uncertain");
    expect(res.wantsConfirmation).toBe(false);
  });

  it("wants confirmation for destructive commands", () => {
    const res = resolveAnswers(answers("delete_note", 0.95));
    expect(res.wantsConfirmation).toBe(true);
  });

  it("wants confirmation when Jev thinks the request is destructive", () => {
    const res = resolveAnswers(answers("toggle_sidebar", 0.95, { [QUESTION_IDS.isDestructive]: { type: "noul", noul: 0.8 } }));
    expect(res.wantsConfirmation).toBe(true);
    expect(res.destructiveProbability).toBe(0.8);
  });

  it("limits the list to topN", () => {
    expect(resolveAnswers(answers("undo", 0.7), 3).ranked).toHaveLength(3);
  });

  it("throws without a command answer", () => {
    expect(() => resolveAnswers({})).toThrow();
  });
});

describe("describeArg", () => {
  it("formats each slot", () => {
    expect(describeArg("font_size_delta", "-4")).toBe("by -4 pt");
    expect(describeArg("theme", "high_contrast")).toBe("to high contrast");
    expect(describeArg("heading_level", "3")).toBe("to H3");
    expect(describeArg("export_format", "plain_text")).toBe("as PLAIN TEXT");
  });
});
