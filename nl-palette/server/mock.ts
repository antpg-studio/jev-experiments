import { COMMANDS, argOptions, ARG_SLOTS } from "../src/shared/commands.ts";
import { fuzzyRank } from "../src/shared/fuzzy.ts";
import { QUESTION_IDS, type Answer } from "../src/shared/questions.ts";

/**
 * Offline stand-in used only when MOCK=1: derives a fake probability
 * distribution from fuzzy scores so the UI can be exercised without a key.
 * The UI labels every result from this path as MOCK.
 */
export function mockAnswers(query: string): Record<string, Answer> {
  const ranked = fuzzyRank(query, COMMANDS);
  const weights = ranked.map((r) => Math.exp(r.score / 8));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const probabilities: Record<string, number> = {};
  ranked.forEach((r, i) => (probabilities[r.command.id] = weights[i] / total));
  const top = ranked[0]?.command.id ?? COMMANDS[0].id;
  const answers: Record<string, Answer> = {
    [QUESTION_IDS.command]: { type: "choice", choice: top, probabilities, confidence: probabilities[top] ?? 0 },
    [QUESTION_IDS.isDestructive]: { type: "noul", noul: /delete|remove|close|discard/i.test(query) ? 0.9 : 0.05 },
  };
  for (const slot of ARG_SLOTS) {
    const options = argOptions(slot);
    const p = 1 / options.length;
    answers[slot] = { type: "choice", choice: options[0], probabilities: Object.fromEntries(options.map((o) => [o, p])), confidence: 0 };
  }
  return answers;
}
