import type { Answer, Audience, Span, Verdict } from "./types";
import { CORE_QUESTION_IDS, TONE_LEVELS, type CoreQuestionId } from "./questions";

export interface Decision {
  verdict: Verdict;
  reason: string;
  /** Span ids Jev marked as culprits (noul >= SPAN_THRESHOLD). */
  culpritSpanIds: string[];
}

export const THRESHOLDS = {
  noul: 0.6,
  span: 0.55,
  toneCurt: 1.6,
  toneHostile: 2.5,
  legalWarn: 1.4,
  legalBlock: 2.5,
} as const;

const RANK: Record<Verdict, number> = { send: 0, warn: 1, block: 2 };
export const worse = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);

export function noulOf(answers: Record<string, Answer>, id: string): number {
  const a = answers[id];
  return a && a.type === "noul" ? a.noul : 0;
}
export function scoreOf(answers: Record<string, Answer>, id: string): number {
  const a = answers[id];
  return a && a.type === "score" ? a.score : 0;
}
export function choiceOf(answers: Record<string, Answer>, id: string): string | null {
  const a = answers[id];
  return a && a.type === "choice" ? a.choice : null;
}

export const toneLabel = (s: number): (typeof TONE_LEVELS)[number] =>
  TONE_LEVELS[Math.min(TONE_LEVELS.length - 1, Math.max(0, Math.round(s)))];

/**
 * Policy lives in code. Jev supplies the judgments; these rules decide the button colour.
 * Hard rules (block) always win over Jev's overall verdict; Jev's verdict can still escalate.
 */
export function decide(answers: Record<string, Answer>, audience: Audience, spans: Span[]): Decision {
  const external = audience !== "internal";
  const reasons: Array<[Verdict, string]> = [];

  if (noulOf(answers, "contains_secret_or_credential") >= THRESHOLDS.noul) reasons.push(["block", "contains a credential"]);
  if (noulOf(answers, "contains_customer_pii") >= THRESHOLDS.noul)
    reasons.push([external ? "block" : "warn", external ? "customer PII to an external audience" : "customer PII"]);
  if (external && noulOf(answers, "discloses_confidential_internal_info") >= THRESHOLDS.noul)
    reasons.push(["block", "leaks confidential internal info"]);
  const tone = scoreOf(answers, "tone");
  if (tone >= THRESHOLDS.toneHostile) reasons.push([external ? "block" : "warn", "hostile tone"]);
  else if (tone >= THRESHOLDS.toneCurt) reasons.push(["warn", "curt tone"]);
  if (noulOf(answers, "makes_binding_commitment") >= THRESHOLDS.noul) reasons.push(["warn", "makes a binding commitment"]);
  const legal = scoreOf(answers, "legal_or_compliance_risk");
  if (legal >= THRESHOLDS.legalBlock) reasons.push(["block", "severe legal/compliance risk"]);
  else if (legal >= THRESHOLDS.legalWarn) reasons.push(["warn", "legal/compliance risk"]);
  if (noulOf(answers, "is_appropriate_for_audience") > 0 && noulOf(answers, "is_appropriate_for_audience") < 1 - THRESHOLDS.noul)
    reasons.push(["warn", "doesn't fit this audience"]);
  if (noulOf(answers, "is_incomplete_or_cut_off") >= THRESHOLDS.noul) reasons.push(["warn", "looks unfinished"]);
  if (noulOf(answers, "contains_hedging_that_undermines") >= THRESHOLDS.noul) reasons.push(["warn", "hedging undermines the message"]);

  const jev = choiceOf(answers, "should_block_send");
  if (jev === "block" || jev === "warn") reasons.push([jev, jev === "block" ? "Jev: must not be sent" : "Jev: review before sending"]);

  let verdict: Verdict = "send";
  for (const [v] of reasons) verdict = worse(verdict, v);
  const top = reasons.filter(([v]) => v === verdict).map(([, r]) => r);
  const reason = verdict === "send" ? "Looks good" : top.slice(0, 2).join(" · ");

  const culpritSpanIds = spans.filter((s) => noulOf(answers, s.id) >= THRESHOLDS.span).map((s) => s.id);
  return { verdict, reason, culpritSpanIds };
}

export type ChipState = "ok" | "warn" | "bad" | "pending";

/** Colour for one judgment chip. */
export function chipState(id: CoreQuestionId, answers: Record<string, Answer>): ChipState {
  const a = answers[id];
  if (!a) return "pending";
  switch (id) {
    case "tone": {
      const s = scoreOf(answers, id);
      return s >= THRESHOLDS.toneHostile ? "bad" : s >= THRESHOLDS.toneCurt ? "warn" : "ok";
    }
    case "legal_or_compliance_risk": {
      const s = scoreOf(answers, id);
      return s >= THRESHOLDS.legalBlock ? "bad" : s >= THRESHOLDS.legalWarn ? "warn" : "ok";
    }
    case "should_block_send": {
      const c = choiceOf(answers, id);
      return c === "block" ? "bad" : c === "warn" ? "warn" : "ok";
    }
    case "is_appropriate_for_audience":
      return noulOf(answers, id) >= THRESHOLDS.noul ? "ok" : noulOf(answers, id) < 1 - THRESHOLDS.noul ? "bad" : "warn";
    case "contains_secret_or_credential":
    case "contains_customer_pii":
    case "discloses_confidential_internal_info":
      return noulOf(answers, id) >= THRESHOLDS.noul ? "bad" : noulOf(answers, id) >= 0.35 ? "warn" : "ok";
    default:
      return noulOf(answers, id) >= THRESHOLDS.noul ? "warn" : "ok";
  }
}

export function chipValue(id: CoreQuestionId, answers: Record<string, Answer>): string {
  const a = answers[id];
  if (!a) return "—";
  if (a.type === "noul") return `${Math.round(a.noul * 100)}%`;
  if (a.type === "choice") return a.choice;
  if (id === "tone") return toneLabel(a.score);
  return a.score.toFixed(1);
}

export const isCoreId = (id: string): id is CoreQuestionId => (CORE_QUESTION_IDS as readonly string[]).includes(id);
