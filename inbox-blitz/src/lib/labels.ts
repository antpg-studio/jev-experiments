import type { MatchResult } from "./types";
import type { RunStats } from "./stats";

/** An email is labelled when Jev's match probability is at least this. */
export const MATCH_THRESHOLD = 0.5;
/** Matches below this are shown as "borderline" so an operator can eyeball them. */
export const SURE_THRESHOLD = 0.8;
export const MAX_INTENT_CHARS = 200;

export type LabelPhase = "queued" | "running" | "done" | "error";

/** A user-defined label: a free-text intent plus every email's judgment against it. */
export interface IntentLabel {
  id: string;
  /** What the operator typed, e.g. "customers threatening to cancel". */
  intent: string;
  /** Short display name derived from the intent. */
  name: string;
  color: string;
  phase: LabelPhase;
  matches: Map<string, MatchResult>;
  errors: Map<string, string>;
  stats: RunStats;
  fatal?: string;
}

/** Gmail's label palette. */
export const LABEL_COLORS = ["#4a86e8", "#e66550", "#16a765", "#ffad46", "#a479e2", "#2da2bb", "#f691b2", "#b99aff", "#cca6ac", "#8c6d1f"];

export function pickColor(index: number): string {
  return LABEL_COLORS[index % LABEL_COLORS.length];
}

const FILLER = /^(emails?|messages?|mail|anything|anyone|everything|everyone|all|any|show|find|filter|label|people|customers?|senders?|someone|somebody|that|who|which|where|from|are|is|about|me)\s+/i;

/** "Emails from customers who are threatening to cancel" → "Threatening to cancel". */
export function labelName(intent: string, max = 40): string {
  let s = intent.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(FILLER, "");
  }
  if (!s) s = intent.trim().replace(/[.!?]+$/, "");
  s = s[0].toUpperCase() + s.slice(1);
  if (s.length > max) {
    const cut = s.slice(0, max);
    s = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut) + "…";
  }
  return s;
}

export function isMatch(r: MatchResult | undefined, threshold = MATCH_THRESHOLD): boolean {
  return r !== undefined && r.match >= threshold;
}

export interface LabelSummary {
  judged: number;
  matched: number;
  sure: number;
  borderline: number;
  rejected: number;
  /** Ten equal-width buckets of the match probability, 0.0–0.1 … 0.9–1.0. */
  histogram: number[];
}

export function summarize(matches: Iterable<MatchResult>): LabelSummary {
  const s: LabelSummary = { judged: 0, matched: 0, sure: 0, borderline: 0, rejected: 0, histogram: Array<number>(10).fill(0) };
  for (const r of matches) {
    s.judged++;
    s.histogram[Math.min(9, Math.floor(r.match * 10))]++;
    if (r.match >= SURE_THRESHOLD) {
      s.matched++;
      s.sure++;
    } else if (r.match >= MATCH_THRESHOLD) {
      s.matched++;
      s.borderline++;
    } else s.rejected++;
  }
  return s;
}

/** Ids that match every one of the given labels (AND). Unjudged emails never match. */
export function intersect(ids: readonly string[], labels: readonly IntentLabel[], threshold = MATCH_THRESHOLD): string[] {
  if (labels.length === 0) return [...ids];
  return ids.filter((id) => labels.every((l) => isMatch(l.matches.get(id), threshold)));
}

/** Ids not yet ruled out: every label either still has to judge the email or matched it. */
export function pending(ids: readonly string[], labels: readonly IntentLabel[], threshold = MATCH_THRESHOLD): string[] {
  return ids.filter((id) =>
    labels.every((l) => {
      const r = l.matches.get(id);
      return r === undefined || r.match >= threshold;
    }),
  );
}

/** Highest combined match first (product of probabilities), ties keep input order. */
export function sortByMatch<T extends { id: string }>(rows: readonly T[], labels: readonly IntentLabel[]): T[] {
  if (labels.length === 0) return [...rows];
  const score = (id: string) => labels.reduce((acc, l) => acc * (l.matches.get(id)?.match ?? 0), 1);
  return rows
    .map((r, i) => ({ r, i, s: score(r.id) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

export const SUGGESTED_INTENTS = [
  "customers threatening to cancel",
  "someone asking for a refund",
  "production is down or broken for them",
  "sales leads asking for pricing or a demo",
  "phishing or a scam",
  "GDPR or data deletion requests",
  "sarcastic or passive-aggressive tone",
  "legitimate security alerts from a vendor",
  "a coworker asking me to do something",
  "newsletters I can ignore",
];
