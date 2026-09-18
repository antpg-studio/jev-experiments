/**
 * The "old way": a handful of regex rules like a lint plugin would ship.
 * Used only as the measured comparison line in the report.
 */
import { performance } from "node:perf_hooks";
import { addedLines } from "./diff.ts";
import type { FindingId, Hunk } from "./types.ts";

export interface RegexRule {
  id: FindingId;
  pattern: RegExp;
}

export const REGEX_RULES: RegexRule[] = [
  { id: "leaks_secret_or_token", pattern: /(sk_live_[0-9a-zA-Z]{8,}|ghp_[0-9a-zA-Z]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/ },
  { id: "logs_sensitive_data", pattern: /console\.(log|debug|info)\([^)]*(password|token|secret)/i },
  { id: "disables_or_skips_tests", pattern: /\b(it|test|describe)\.(skip|only)\(|\bxit\(|\bxdescribe\(/ },
  { id: "destructive_data_change", pattern: /\b(DROP\s+(TABLE|COLUMN)|TRUNCATE\s+TABLE)\b/i },
  { id: "leftover_debug_or_temp", pattern: /\bdebugger;|TODO:? remove|FIXME before/i },
  { id: "hardcoded_env_specific_value", pattern: /https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/ },
];

export interface BaselineHit {
  hunkId: string;
  id: FindingId;
  line: string;
}

export interface BaselineResult {
  hits: BaselineHit[];
  elapsedMs: number;
  rules: number;
}

export function runRegexBaseline(hunks: Hunk[]): BaselineResult {
  const started = performance.now();
  const hits: BaselineHit[] = [];
  for (const h of hunks) {
    for (const l of addedLines(h)) {
      for (const rule of REGEX_RULES) {
        if (rule.pattern.test(l.text)) hits.push({ hunkId: h.id, id: rule.id, line: l.text });
      }
    }
  }
  return { hits, elapsedMs: performance.now() - started, rules: REGEX_RULES.length };
}

/** Which (hunk, finding) pairs did Jev report that the regex baseline missed, and vice versa. */
export function compareWithBaseline(
  jevPairs: Array<{ hunkId: string; id: string }>,
  baseline: BaselineResult,
): { caught: number; missed: Array<{ hunkId: string; id: string }>; extra: BaselineHit[] } {
  const base = new Set(baseline.hits.map((h) => `${h.hunkId}|${h.id}`));
  const jev = new Set(jevPairs.map((p) => `${p.hunkId}|${p.id}`));
  const missed = jevPairs.filter((p) => !base.has(`${p.hunkId}|${p.id}`));
  const extra = baseline.hits.filter((h) => !jev.has(`${h.hunkId}|${h.id}`));
  return { caught: jevPairs.length - missed.length, missed, extra };
}
