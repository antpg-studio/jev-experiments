import type { Judgment, Truth } from "./types.ts";
import { HARMFUL_TRUTHS } from "./types.ts";

/** What the moderator console does with a message. */
export type Decision = "allow" | "hide" | "timeout_user" | "care" | "review";

export interface Thresholds {
  /** self_harm_risk >= this → care queue (supportive reply, never a ban). */
  selfHarm: number;
  /** harassment or obfuscated-slur probability >= this → timeout. */
  timeout: number;
  /** any harm noul >= this → hide. */
  hide: number;
  /** severity score (0–3) >= this → at least hide; >= timeoutSeverity → timeout. */
  hideSeverity: number;
  timeoutSeverity: number;
  /** action-choice confidence below this (for any non-allow choice, or an allow with strong harm signal) → human review. */
  reviewConfidence: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  selfHarm: 0.5,
  timeout: 0.85,
  hide: 0.6,
  hideSeverity: 1.6,
  timeoutSeverity: 2.6,
  reviewConfidence: 0.6,
};

export interface PolicyResult {
  decision: Decision;
  /** short reason for the moderator UI, e.g. "harassment 0.97" */
  reason: string;
}

const pct = (v: number) => v.toFixed(2);

/**
 * Pure function: raw Jev judgment + thresholds → decision. No inference; this is
 * what lets the settings drawer re-apply new thresholds to 500 messages instantly.
 */
export function decide(j: Judgment | null, t: Thresholds): PolicyResult {
  if (!j) return { decision: "review", reason: "no judgment (error)" };

  if (j.self_harm_risk >= t.selfHarm) {
    return { decision: "care", reason: `self-harm risk ${pct(j.self_harm_risk)}` };
  }

  const worstAttack = Math.max(j.harassment, j.is_obfuscated_slur_or_evasion);
  if (worstAttack >= t.timeout || j.severity >= t.timeoutSeverity) {
    const why =
      j.is_obfuscated_slur_or_evasion >= t.timeout
        ? `obfuscated slur ${pct(j.is_obfuscated_slur_or_evasion)}`
        : j.harassment >= t.timeout
          ? `harassment ${pct(j.harassment)}`
          : `severity ${j.severity.toFixed(1)}/3`;
    return { decision: "timeout_user", reason: why };
  }
  if (j.action === "timeout_user" && j.actionConfidence >= t.reviewConfidence) {
    return { decision: "timeout_user", reason: `jev: timeout (${pct(j.actionConfidence)})` };
  }

  const hideSignals: Array<[string, number]> = [
    ["scam", j.scam_or_phishing],
    ["spam", j.spam],
    ["harassment", j.harassment],
    ["obfuscated abuse", j.is_obfuscated_slur_or_evasion],
  ];
  const strongest = hideSignals.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (strongest[1] >= t.hide) {
    return { decision: "hide", reason: `${strongest[0]} ${pct(strongest[1])}` };
  }
  if (j.severity >= t.hideSeverity) {
    return { decision: "hide", reason: `severity ${j.severity.toFixed(1)}/3` };
  }

  if (j.action === "escalate_to_human") {
    return { decision: "review", reason: `jev: escalate (${pct(j.actionConfidence)})` };
  }
  if (j.actionConfidence < t.reviewConfidence) {
    return { decision: "review", reason: `low confidence ${pct(j.actionConfidence)} on "${j.action}"` };
  }
  if (j.action === "hide") {
    return { decision: "hide", reason: `jev: hide (${pct(j.actionConfidence)})` };
  }
  return { decision: "allow", reason: `allow (${pct(j.actionConfidence)})` };
}

/** Did the decision remove the message from viewers' eyes? */
export function isBlocking(d: Decision): boolean {
  return d === "hide" || d === "timeout_user" || d === "care";
}

export function isHarmful(truth: Truth): boolean {
  return HARMFUL_TRUTHS.has(truth);
}

export interface FilterScore {
  harmfulTotal: number;
  caught: number;
  wronglyBlocked: number;
  cleanTotal: number;
}

export function emptyScore(): FilterScore {
  return { harmfulTotal: 0, caught: 0, wronglyBlocked: 0, cleanTotal: 0 };
}

/**
 * Score one blocking verdict against ground truth. Self-harm messages are
 * excluded from "harmful" (routing them to care is correct, banning them is not),
 * so they count neither as a catch nor as a false positive.
 */
export function scoreVerdict(acc: FilterScore, truth: Truth, blocked: boolean): void {
  if (truth === "self_harm") return;
  if (isHarmful(truth)) {
    acc.harmfulTotal++;
    if (blocked) acc.caught++;
  } else {
    acc.cleanTotal++;
    if (blocked) acc.wronglyBlocked++;
  }
}

export const CARE_REPLY =
  "Hey, we read that and we're glad you're here. If things feel heavy right now you can text or call 988 (US) or find a local line at findahelpline.com. A mod is going to DM you — you don't have to carry this alone.";
