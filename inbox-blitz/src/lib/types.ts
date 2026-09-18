export const CATEGORIES = [
  "billing",
  "bug",
  "feature_request",
  "sales_lead",
  "security",
  "legal_privacy",
  "spam_marketing",
  "internal",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const URGENCY_LEVELS = ["Can wait a week", "This week", "Today", "Right now"] as const;
export const SENTIMENT_LEVELS = ["Friendly", "Neutral", "Frustrated", "Furious"] as const;

export interface Email {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  threadId?: string;
  /** Present on hand-written fixtures designed to defeat keyword rules. */
  trap?: string;
}

/** The raw, reusable judgment data returned for one email. */
export interface Judgment {
  category: Category;
  categoryConfidence: number;
  categoryProbabilities: Record<string, number>;
  needsReply: number;
  urgency: number; // 0..3 probability-weighted
  urgencyConfidence: number;
  sentiment: number; // 0..3 probability-weighted
  sentimentConfidence: number;
  isPhishingOrScam: number;
  mentionsChurnOrCancel: number;
  asksForRefund: number;
}

export interface JudgmentResult {
  id: string;
  judgment: Judgment;
  /** Milliseconds measured server-side around the TypeSafe HTTP round trip. */
  latencyMs: number;
  inputTokens: number;
  retries: number;
}

export type StreamEvent =
  | { type: "start"; total: number; concurrency: number; mock: boolean; model: string }
  | ({ type: "result" } & JudgmentResult)
  | { type: "error"; id: string; message: string }
  | { type: "done"; elapsedMs: number };

/** One email judged against a free-text intent ("customers threatening to cancel"). */
export interface MatchResult {
  id: string;
  /** Probability that the email fits the intent, 0..1. */
  match: number;
  latencyMs: number;
  inputTokens: number;
  retries: number;
}

export type LabelStreamEvent =
  | { type: "start"; total: number; concurrency: number; mock: boolean; model: string; intent: string }
  | ({ type: "match" } & MatchResult)
  | { type: "error"; id: string; message: string }
  | { type: "done"; elapsedMs: number };
