import type { Judgment } from "./jev.ts";

// Policy lives in code. Raw probabilities are stored once per message; these
// filters are re-evaluated whenever a slider moves, without touching the API.

export interface Thresholds {
  modAttention: number;
  harassment: number;
  question: number;
  spoiler: number;
}

export const defaultThresholds: Thresholds = { modAttention: 0.6, harassment: 0.5, question: 0.8, spoiler: 0.8 };

export function inModQueue(j: Judgment, t: Thresholds): boolean {
  return j.needs_mod_attention >= t.modAttention || j.harassment >= t.harassment;
}

export function modReason(j: Judgment, t: Thresholds): "harassment" | "scam" | "spoiler" | "review" {
  if (j.harassment >= t.harassment) return "harassment";
  if (j.spam_or_scam >= 0.5) return "scam";
  if (j.spoiler >= 0.5) return "spoiler";
  return "review";
}

export function isStreamerQuestion(j: Judgment, t: Thresholds): boolean {
  return j.question_for_streamer >= t.question && j.harassment < t.harassment && j.spam_or_scam < 0.5;
}

export function isSpoiler(j: Judgment, t: Thresholds): boolean {
  return j.spoiler >= t.spoiler;
}
