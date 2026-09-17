import type { ChoiceResponse, ScoreResponse } from "@typesafe-ai/sdk";
import type { CustomerProfile, JudgeAnswers } from "./questions.ts";

/** Refund policy lives in code, not in the model: Pro/Business, or any plan after 12 months. */
export function refundEligibleByPolicy(customer: Pick<CustomerProfile, "plan" | "tenure_months">): boolean {
  if (customer.plan === "pro" || customer.plan === "business") return true;
  return customer.tenure_months >= 12;
}

/** Choice confidence above which the copilot fills the reply box without asking. */
export const AUTO_FILL_CONFIDENCE = 0.6;
/** Noul probability treated as "yes" for badges. */
export const YES = 0.5;
/** Score (0..3) at which a queue row lights up. */
export const CHURN_ALERT = 1.5;

export interface RankedOption {
  id: string;
  probability: number;
}

export function topOptions(answer: ChoiceResponse, n = 3): RankedOption[] {
  return Object.entries(answer.probabilities)
    .map(([id, probability]) => ({ id, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, n);
}

export type MacroSuggestion =
  | { kind: "auto"; macroId: string; confidence: number; top: RankedOption[] }
  | { kind: "options"; confidence: number; top: RankedOption[] }
  | { kind: "none"; confidence: number; top: RankedOption[] };

export function gateMacro(answer: ChoiceResponse, threshold = AUTO_FILL_CONFIDENCE): MacroSuggestion {
  const top = topOptions(answer, 3);
  if (answer.choice === "none") return { kind: "none", confidence: answer.confidence, top };
  if (answer.confidence >= threshold) {
    return { kind: "auto", macroId: answer.choice, confidence: answer.confidence, top };
  }
  return { kind: "options", confidence: answer.confidence, top: top.filter((o) => o.id !== "none") };
}

export function scoreLabel(answer: ScoreResponse): string {
  const idx = Math.round(answer.score);
  const legend = answer.legend as Record<string, unknown>;
  const raw = legend[String(idx)];
  return typeof raw === "string" ? raw : String(idx);
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
}

export function latencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) return { count: 0, p50: 0, p95: 0, min: 0, max: 0, mean: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
  };
}

export interface QueueBadges {
  churn: number;
  frustration: number;
  escalate: boolean;
  regulatory: boolean;
  refundRequested: boolean;
}

export function queueBadges(answers: JudgeAnswers): QueueBadges {
  return {
    churn: answers.churn_risk.score,
    frustration: answers.frustration.score,
    escalate: answers.needs_escalation_to_human_supervisor.noul >= YES,
    regulatory: answers.contains_regulatory_request.noul >= YES,
    refundRequested: answers.customer_requests_refund.noul >= YES,
  };
}

/** Priority used to order the supervisor queue: escalations first, then churn, then frustration. */
export function queuePriority(b: QueueBadges | undefined): number {
  if (!b) return 0;
  return (b.escalate ? 100 : 0) + (b.regulatory ? 20 : 0) + b.churn * 10 + b.frustration;
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.round(ms)} ms`;
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
