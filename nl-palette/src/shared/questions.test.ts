import { describe, expect, it } from "vitest";
import { ARG_SLOTS, COMMANDS, argOptions } from "./commands.ts";
import { buildQuestions, QUESTION_IDS } from "./questions.ts";

describe("buildQuestions", () => {
  const q = buildQuestions();

  it("asks one command choice with a criterion per command", () => {
    const cmd = q[QUESTION_IDS.command];
    expect(cmd.type).toBe("choice");
    if (cmd.type !== "choice") return;
    expect(Object.keys(cmd.criteria).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
    for (const c of COMMANDS) expect(cmd.criteria[c.id]).toContain(c.title);
  });

  it("asks every argument slot speculatively in the same request", () => {
    for (const slot of ARG_SLOTS) {
      const sq = q[slot];
      expect(sq.type).toBe("choice");
      if (sq.type !== "choice") return;
      expect(Object.keys(sq.criteria).sort()).toEqual([...argOptions(slot)].sort());
    }
  });

  it("asks a destructive noul", () => {
    expect(q[QUESTION_IDS.isDestructive].type).toBe("noul");
  });

  it("uses closed argument sets for every command with a slot", () => {
    for (const c of COMMANDS) if (c.arg) expect(ARG_SLOTS).toContain(c.arg);
    expect(COMMANDS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });
});
