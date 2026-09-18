import type { Category, Product } from "./catalog.ts";

export const MODEL = "typesafe/jev-1.13";
export const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000;

export const RELEVANCE_LEVELS = [
  "Unrelated to what the shopper asked for",
  "Same general area but not what they asked for",
  "Partially matches; would work in a pinch",
  "Good match for the request",
  "Exactly what they asked for",
] as const;
export const MAX_LEVEL = RELEVANCE_LEVELS.length - 1;

export const INTENTS = ["electronics", "kitchen", "outdoors", "toys", "office", "any"] as const;
export type Intent = (typeof INTENTS)[number];
export const SORTS = ["relevance", "price_low", "price_high", "rating"] as const;
export type SortPreference = (typeof SORTS)[number];

export interface CandidateState {
  id: string;
  title: string;
  description: string;
  category: Category;
  price_usd: number;
  rating: number;
}

export interface JevQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  criteria?: Record<string, string | null> | readonly string[];
}

export interface JevRequest {
  state: { query: string; candidates: CandidateState[] };
  model: string;
  questions: Record<string, JevQuestion>;
}

export interface RelevanceAnswer {
  score: number;
  confidence: number;
  probabilities: number[];
}

export interface QueryJudgment {
  intent: Intent;
  intentConfidence: number;
  intentProbabilities: Record<string, number>;
  wantsCheap: number;
  wantsPremium: number;
  isGift: number;
  sort: SortPreference;
  sortConfidence: number;
  sortProbabilities: Record<string, number>;
}

export interface ParsedAnswers {
  relevance: Map<string, RelevanceAnswer>;
  query: QueryJudgment;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function toCandidateState(p: Product): CandidateState {
  return { id: p.id, title: p.title, description: p.description, category: p.category, price_usd: p.price, rating: p.rating };
}

export function relevanceQuestion(path: string): JevQuestion {
  return {
    type: "score",
    instructions: `How well does the product at \`${path}\` satisfy the shopper's search \`query\`? Judge what the product is for and its stated features against what the shopper wants, including who it is for and any constraint they mention. Sharing a word with the query does not make it a match.`,
    criteria: RELEVANCE_LEVELS,
  };
}

export const QUERY_QUESTIONS: Record<string, JevQuestion> = {
  intent_category: {
    type: "choice",
    instructions: "Which store department is the shopper's `query` looking in?",
    criteria: {
      electronics: "Audio, phones and phone accessories, keyboards, mice, computers, cameras, gadgets",
      kitchen: "Cooking, coffee, drinkware, insulated bottles and tumblers, food storage",
      outdoors: "Hiking, camping, sports, cycling, travel gear, clothing for the outdoors",
      toys: "Children's toys, games, kits and gifts for kids",
      office: "Desks, chairs, stationery, paper, work-from-home furniture and accessories",
      any: "The query does not point to one department",
    },
  },
  wants_cheap: {
    type: "noul",
    instructions: "Does the shopper's `query` ask for a cheap, budget, inexpensive or affordable product?",
    criteria: { true: "The query contains a word meaning low price, such as cheap, budget, affordable, inexpensive, under a dollar amount", false: "No price preference is stated, or the shopper wants something premium" },
  },
  wants_premium: {
    type: "noul",
    instructions: "Does the shopper's `query` ask for a premium, high-end, luxury, professional or best-quality product?",
    criteria: { true: "The query contains a word meaning high quality or high price, such as premium, high-end, best, pro, luxury", false: "No quality tier is stated, or the shopper wants something cheap" },
  },
  is_gift: {
    type: "noul",
    instructions: "Does the shopper's `query` say the product is a gift or present for another person?",
    criteria: { true: "The query mentions a gift, present, or buying for a named person such as a child, friend, mom or coworker", false: "The shopper appears to be buying for themselves or does not say" },
  },
  sort_preference: {
    type: "choice",
    instructions: "How should the results for the shopper's `query` be ordered?",
    criteria: {
      relevance: "No ordering preference is stated; best match first",
      price_low: "The shopper wants cheap or budget options, so lowest price first",
      price_high: "The shopper wants premium or top-tier options, so highest price first",
      rating: "The shopper asks for the best-rated, most reliable or best-reviewed options",
    },
  },
};

export function buildRequest(query: string, candidates: Product[], includeQueryQuestions = true): JevRequest {
  const questions: Record<string, JevQuestion> = {};
  candidates.forEach((_, i) => {
    questions[`rel_${i}`] = relevanceQuestion(`candidates[${i}]`);
  });
  if (includeQueryQuestions) Object.assign(questions, QUERY_QUESTIONS);
  return { state: { query, candidates: candidates.map(toCandidateState) }, model: MODEL, questions };
}

interface RawScore { type: "score"; score: number; confidence: number; probabilities: Record<string, number> }
interface RawChoice { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
interface RawNoul { type: "noul"; noul: number }
type RawAnswer = RawScore | RawChoice | RawNoul;

export interface JevResponse {
  model: string;
  answers: Record<string, RawAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

function isOneOf<T extends string>(set: readonly T[], v: string): v is T {
  return (set as readonly string[]).includes(v);
}

export function parseAnswers(query: string, candidates: Product[], response: JevResponse): ParsedAnswers {
  const relevance = new Map<string, RelevanceAnswer>();
  candidates.forEach((c, i) => {
    const a = response.answers[`rel_${i}`];
    if (a && a.type === "score") {
      const probabilities = RELEVANCE_LEVELS.map((_, lvl) => a.probabilities[String(lvl)] ?? 0);
      relevance.set(c.id, { score: a.score, confidence: a.confidence, probabilities });
    }
  });
  const fallback = heuristicQueryJudgment(query);
  const ic = response.answers.intent_category;
  const sp = response.answers.sort_preference;
  const wc = response.answers.wants_cheap;
  const wp = response.answers.wants_premium;
  const ig = response.answers.is_gift;
  const queryJudgment: QueryJudgment = {
    intent: ic && ic.type === "choice" && isOneOf(INTENTS, ic.choice) ? ic.choice : fallback.intent,
    intentConfidence: ic && ic.type === "choice" ? ic.confidence : fallback.intentConfidence,
    intentProbabilities: ic && ic.type === "choice" ? ic.probabilities : fallback.intentProbabilities,
    wantsCheap: wc && wc.type === "noul" ? wc.noul : fallback.wantsCheap,
    wantsPremium: wp && wp.type === "noul" ? wp.noul : fallback.wantsPremium,
    isGift: ig && ig.type === "noul" ? ig.noul : fallback.isGift,
    sort: sp && sp.type === "choice" && isOneOf(SORTS, sp.choice) ? sp.choice : fallback.sort,
    sortConfidence: sp && sp.type === "choice" ? sp.confidence : fallback.sortConfidence,
    sortProbabilities: sp && sp.type === "choice" ? sp.probabilities : fallback.sortProbabilities,
  };
  return { relevance, query: queryJudgment, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
}

const CHEAP_WORDS = /\b(cheap|budget|affordable|inexpensive|under \$?\d+|low[- ]cost)\b/i;
const PREMIUM_WORDS = /\b(premium|high[- ]end|luxury|best|pro|professional|top[- ]tier)\b/i;
const GIFT_WORDS = /\b(gift|present|for (my|a|an) (\d+ ?(yr|year)[- ]old|kid|son|daughter|mom|dad|friend|wife|husband|coworker|niece|nephew))\b/i;
const RATING_WORDS = /\b(best[- ]rated|top[- ]rated|highly rated|reliable|well[- ]reviewed)\b/i;

export function heuristicQueryJudgment(query: string): QueryJudgment {
  const cheap = CHEAP_WORDS.test(query) ? 0.9 : 0.05;
  const premium = PREMIUM_WORDS.test(query) ? 0.9 : 0.05;
  const gift = GIFT_WORDS.test(query) ? 0.9 : 0.05;
  const sort: SortPreference = RATING_WORDS.test(query) ? "rating" : cheap > 0.5 ? "price_low" : premium > 0.5 ? "price_high" : "relevance";
  const sortProbabilities: Record<string, number> = { relevance: 0, price_low: 0, price_high: 0, rating: 0 };
  sortProbabilities[sort] = 1;
  const intentProbabilities: Record<string, number> = { electronics: 0, kitchen: 0, outdoors: 0, toys: 0, office: 0, any: 1 };
  return { intent: "any", intentConfidence: 0, intentProbabilities, wantsCheap: cheap, wantsPremium: premium, isGift: gift, sort, sortConfidence: 0.5, sortProbabilities };
}

export function estimateCostUsd(inputTokens: number): number {
  return inputTokens * PRICE_PER_INPUT_TOKEN_USD;
}
