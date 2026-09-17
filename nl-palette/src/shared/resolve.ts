import { COMMAND_BY_ID, type ArgSlot, type Command } from "./commands.ts";
import { QUESTION_IDS, type Answer, type ChoiceAnswer } from "./questions.ts";

export interface RankedCommand {
  command: Command;
  probability: number;
  /** Argument value chosen for this command's slot, if it has one. */
  arg?: string;
  argProbability?: number;
}

export type Gate = "confident" | "uncertain";

export interface Resolution {
  ranked: RankedCommand[];
  confidence: number;
  /** confident → single highlighted action; uncertain → show top-3 and require an explicit pick. */
  gate: Gate;
  destructiveProbability: number;
  /** Computed in code: destructive command, or Jev believes the request discards work. */
  wantsConfirmation: boolean;
}

export const CONFIDENCE_GATE = 0.55;
export const DESTRUCTIVE_GATE = 0.5;

function choiceAnswer(answers: Record<string, Answer>, id: string): ChoiceAnswer | null {
  const a = answers[id];
  return a && a.type === "choice" ? a : null;
}

export function describeArg(slot: ArgSlot, value: string): string {
  switch (slot) {
    case "font_size_delta":
      return `by ${value} pt`;
    case "theme":
      return `to ${value.replace("_", " ")}`;
    case "heading_level":
      return `to H${value}`;
    case "export_format":
      return `as ${value.replace("_", " ").toUpperCase()}`;
  }
}

/** Label shown for a ranked command, e.g. "Change Font Size by +2 pt". */
export function previewLabel(r: RankedCommand): string {
  if (r.command.arg && r.arg) return `${r.command.title} ${describeArg(r.command.arg, r.arg)}`;
  return r.command.title;
}

/**
 * Turns one Jev response into a ranked, argument-filled list. Only the
 * argument slot that belongs to each command is read; the other speculative
 * answers are ignored.
 */
export function resolveAnswers(answers: Record<string, Answer>, topN = 8): Resolution {
  const cmd = choiceAnswer(answers, QUESTION_IDS.command);
  if (!cmd) throw new Error("missing command answer");

  const ranked: RankedCommand[] = Object.entries(cmd.probabilities)
    .map(([id, probability]) => ({ id, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, topN)
    .flatMap(({ id, probability }) => {
      const command = COMMAND_BY_ID.get(id);
      if (!command) return [];
      const entry: RankedCommand = { command, probability };
      if (command.arg) {
        const slot = choiceAnswer(answers, command.arg);
        if (slot) {
          entry.arg = slot.choice;
          entry.argProbability = slot.probabilities[slot.choice];
        }
      }
      return [entry];
    });

  const destructiveAnswer = answers[QUESTION_IDS.isDestructive];
  const destructiveProbability = destructiveAnswer?.type === "noul" ? destructiveAnswer.noul : 0;
  const top = ranked[0];
  const confidence = cmd.confidence;
  const gate: Gate = confidence >= CONFIDENCE_GATE ? "confident" : "uncertain";
  const wantsConfirmation = Boolean(top?.command.destructive) || destructiveProbability >= DESTRUCTIVE_GATE;

  return { ranked, confidence, gate, destructiveProbability, wantsConfirmation };
}
