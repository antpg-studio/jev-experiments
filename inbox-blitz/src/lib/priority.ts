import type { Judgment } from "./types";

/** Slider-driven weights. All ranking is plain arithmetic over the raw judgments. */
export interface Weights {
  urgency: number;
  sentiment: number;
  churn: number;
  refund: number;
  phishing: number;
  needsReply: number;
  spamPenalty: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  urgency: 40,
  sentiment: 20,
  churn: 25,
  refund: 10,
  phishing: 30,
  needsReply: 15,
  spamPenalty: 40,
};

export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  urgency: "Urgency",
  sentiment: "Anger",
  churn: "Churn risk",
  refund: "Refund ask",
  phishing: "Phishing",
  needsReply: "Needs reply",
  spamPenalty: "Spam penalty",
};

/** Below this the category is not trusted; the email goes to the human lane. */
export const HUMAN_CONFIDENCE = 0.7;

/**
 * Priority in [0, ~100]. Urgency/sentiment are 0..3 scores, normalised to 0..1;
 * the nouls are already 0..1 probabilities.
 */
export function priority(j: Judgment, w: Weights): number {
  const isSpam = j.category === "spam_marketing" ? 1 : 0;
  return (
    (j.urgency / 3) * w.urgency +
    (j.sentiment / 3) * w.sentiment +
    j.mentionsChurnOrCancel * w.churn +
    j.asksForRefund * w.refund +
    j.isPhishingOrScam * w.phishing +
    j.needsReply * w.needsReply -
    isSpam * (1 - j.isPhishingOrScam) * w.spamPenalty
  );
}

export function needsHuman(j: Judgment): boolean {
  return j.categoryConfidence < HUMAN_CONFIDENCE;
}

export type Lane = "priority" | "human" | "spam" | "fyi";

/** Which lane an email lands in once judged. Pure policy, easy to change. */
export function lane(j: Judgment): Lane {
  if (j.isPhishingOrScam >= 0.5) return "priority"; // phishing is surfaced for the security team, not buried
  if (needsHuman(j)) return "human";
  if (j.category === "spam_marketing") return "spam";
  if (j.needsReply < 0.5 && j.urgency < 1) return "fyi";
  return "priority";
}

export function rank<T extends { judgment?: Judgment; receivedAt: string }>(items: T[], w: Weights): T[] {
  return [...items].sort((a, b) => {
    const pa = a.judgment ? priority(a.judgment, w) : -Infinity;
    const pb = b.judgment ? priority(b.judgment, w) : -Infinity;
    if (pb !== pa) return pb - pa;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}
