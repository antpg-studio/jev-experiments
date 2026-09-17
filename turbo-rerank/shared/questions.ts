import type { CandidateJudgment, RelevanceLevel } from "./types.ts";

/** Ordered Score levels. The index of each level is the numeric relevance. */
export const RELEVANCE_LEVELS = [
  "Irrelevant: the passage is about a different subject; it does not help answer the query at all.",
  "Tangential: the passage is in the same general area or shares vocabulary with the query, but it does not address what the query is actually asking.",
  "Partially answers: the passage addresses the thing the query asks about but is missing the specific detail the query wants, or covers only part of the question.",
  "Directly answers: the passage contains the specific information the query asks for; a reader would be satisfied after reading it.",
] as const;

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: readonly [string, string, ...string[]];
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export type Question = ScoreQuestion | NoulQuestion;

export interface RerankState {
  [key: string]: string | Record<string, string>;
  query: string;
  candidates: Record<string, string>;
}

export const EXISTS_QUESTION_ID = "answer_exists_in_candidates";

/** Short, prefix-free keys for candidates so the model can reference `candidates.c07` unambiguously. */
export function candidateKey(index: number): string {
  return `c${String(index + 1).padStart(2, "0")}`;
}

export function relevanceQuestionId(key: string): string {
  return `relevance_${key}`;
}

/**
 * Builds one request: state = {query, candidates} and one Score question per candidate
 * plus one Noul asking whether any candidate answers the query.
 */
export function buildRerankRequest(query: string, passages: { id: string; text: string }[]) {
  const candidates: Record<string, string> = {};
  const keyToId: Record<string, string> = {};
  const questions: Record<string, Question> = {};
  passages.forEach((p, i) => {
    const key = candidateKey(i);
    candidates[key] = p.text;
    keyToId[key] = p.id;
    questions[relevanceQuestionId(key)] = {
      type: "score",
      instructions: `How well does the documentation passage \`candidates.${key}\` answer the search query \`query\`? Judge only this passage on its own; ignore the other candidates.`,
      criteria: RELEVANCE_LEVELS,
    };
  });
  questions[EXISTS_QUESTION_ID] = {
    type: "noul",
    instructions: "Does at least one of the passages in `candidates` directly answer the search query `query`?",
    criteria: {
      true: "At least one candidate passage contains the specific information the query asks for.",
      false: "No candidate passage answers the query; the closest ones are only on a related topic.",
    },
  };
  const state: RerankState = { query, candidates };
  return { state, questions, keyToId };
}

export interface RawScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface RawNoulAnswer {
  type: "noul";
  noul: number;
}

export type RawAnswer = RawScoreAnswer | RawNoulAnswer;

function argmaxLevel(probabilities: Record<string, number>): RelevanceLevel {
  let best: RelevanceLevel = 0;
  let bestP = -1;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      bestP = p;
      best = Number(k) as RelevanceLevel;
    }
  }
  return best;
}

/** Turns raw answers back into judgments keyed by real passage id. */
export function parseRerankAnswers(
  answers: Record<string, RawAnswer>,
  keyToId: Record<string, string>,
): { judgments: CandidateJudgment[]; answerExists: number } {
  const judgments: CandidateJudgment[] = [];
  for (const [key, id] of Object.entries(keyToId)) {
    const a = answers[relevanceQuestionId(key)];
    if (!a || a.type !== "score") {
      judgments.push({ id, relevance: 0, level: 0, confidence: 0, probabilities: {} });
      continue;
    }
    judgments.push({
      id,
      relevance: a.score,
      level: argmaxLevel(a.probabilities),
      confidence: a.confidence,
      probabilities: a.probabilities,
    });
  }
  const exists = answers[EXISTS_QUESTION_ID];
  return { judgments, answerExists: exists && exists.type === "noul" ? exists.noul : 0 };
}
