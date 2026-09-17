/**
 * Policy lives in code: thresholds over Jev's probabilities decide block vs warn.
 * Jev supplies the semantics; nothing here calls the network.
 */
import { addedLines } from "./diff.ts";
import type {
  Finding,
  FindingId,
  Hunk,
  HunkJudgment,
  MessageJudgment,
  PolicyOptions,
  PolicyResult,
  Severity,
} from "./types.ts";

export const FINDING_LABELS: Record<FindingId, string> = {
  leaks_secret_or_token: "leaks a secret or token",
  logs_sensitive_data: "logs sensitive data",
  disables_or_skips_tests: "disables or skips tests",
  destructive_data_change: "destructive data change",
  changes_public_api_shape: "changes public API shape",
  leftover_debug_or_temp: "leftover debug / temporary code",
  hardcoded_env_specific_value: "hard-coded environment-specific value",
};

interface Rule {
  /** Probability at or above which the finding is reported at all. */
  report: number;
  /** Probability at or above which the finding blocks the commit (non-strict). */
  block: number | null;
}

/** Default policy. `block: null` means the finding only ever warns unless --strict. */
export const RULES: Record<FindingId, Rule> = {
  leaks_secret_or_token: { report: 0.5, block: 0.7 },
  destructive_data_change: { report: 0.5, block: 0.7 },
  logs_sensitive_data: { report: 0.5, block: 0.8 },
  disables_or_skips_tests: { report: 0.5, block: null },
  changes_public_api_shape: { report: 0.5, block: null },
  leftover_debug_or_temp: { report: 0.5, block: null },
  hardcoded_env_specific_value: { report: 0.5, block: null },
};

/** Risk score (0..4) at or above which a hunk blocks even without a named finding. */
export const RISK_BLOCK = 3.5;
export const RISK_WARN = 2.5;
export const STRICT_RISK_BLOCK = 2.5;
export const STRICT_BLOCK = 0.6;

export const MESSAGE_MISMATCH = 0.35;

export function quoteOffendingLines(h: Hunk, j: HunkJudgment): { quoted: string[]; line: number | undefined } {
  const adds = addedLines(h);
  if (adds.length === 0) {
    const dels = h.lines.filter((l) => l.kind === "del").slice(0, 3);
    return { quoted: dels.map((l) => "-" + l.text), line: undefined };
  }
  if (j.offendingLineIndex !== null && adds[j.offendingLineIndex]) {
    const l = adds[j.offendingLineIndex]!;
    return { quoted: ["+" + l.text], line: l.newLine };
  }
  const first = adds.slice(0, 3);
  return { quoted: first.map((l) => "+" + l.text), line: first[0]?.newLine };
}

export function evaluateHunk(h: Hunk, j: HunkJudgment, opts: PolicyOptions): Finding[] {
  const out: Finding[] = [];
  const { quoted, line } = quoteOffendingLines(h, j);
  for (const [id, rule] of Object.entries(RULES) as Array<[FindingId, Rule]>) {
    const p = j.findings[id];
    if (p < rule.report) continue;
    let severity: Severity = "warn";
    if (rule.block !== null && p >= rule.block) severity = "block";
    if (opts.strict && p >= STRICT_BLOCK) severity = "block";
    out.push({ hunkId: h.id, file: h.file, id, label: FINDING_LABELS[id], probability: p, severity, quoted, line });
  }
  const riskBlock = opts.strict ? STRICT_RISK_BLOCK : RISK_BLOCK;
  if (j.risk >= riskBlock || (j.risk >= RISK_WARN && out.length === 0)) {
    out.push({
      hunkId: h.id,
      file: h.file,
      id: "risk",
      label: `${j.riskLevel} risk change`,
      probability: j.riskConfidence,
      severity: j.risk >= riskBlock ? "block" : "warn",
      quoted,
      line,
    });
  }
  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.probability - a.probability);
}

export function evaluateMessage(msg: MessageJudgment | null, opts: PolicyOptions): Finding[] {
  if (!msg) return [];
  if (msg.matchesChanges >= MESSAGE_MISMATCH) return [];
  return [
    {
      hunkId: "commit-message",
      file: "commit message",
      id: "message_mismatch",
      label: "commit message does not describe the staged changes",
      probability: 1 - msg.matchesChanges,
      severity: opts.strict ? "block" : "warn",
      quoted: [],
      line: undefined,
    },
  ];
}

export function evaluate(
  hunks: Hunk[],
  judgments: HunkJudgment[],
  message: MessageJudgment | null,
  opts: PolicyOptions,
): PolicyResult {
  const byId = new Map(judgments.map((j) => [j.hunkId, j]));
  const findings: Finding[] = [];
  for (const h of hunks) {
    const j = byId.get(h.id);
    if (j) findings.push(...evaluateHunk(h, j, opts));
  }
  findings.push(...evaluateMessage(message, opts));
  const blocking = findings.filter((f) => f.severity === "block");
  const warnings = findings.filter((f) => f.severity === "warn");
  return {
    verdict: blocking.length > 0 ? "block" : warnings.length > 0 ? "warn" : "pass",
    findings,
    blocking,
    warnings,
  };
}

function severityRank(s: Severity): number {
  return s === "block" ? 1 : 0;
}

export interface FileSummary {
  file: string;
  hunks: number;
  maxRisk: number;
  findings: number;
  blocking: number;
  kinds: string[];
}

export function summariseFiles(hunks: Hunk[], judgments: HunkJudgment[], findings: Finding[]): FileSummary[] {
  const byId = new Map(judgments.map((j) => [j.hunkId, j]));
  const map = new Map<string, FileSummary>();
  for (const h of hunks) {
    const j = byId.get(h.id);
    const s = map.get(h.file) ?? { file: h.file, hunks: 0, maxRisk: 0, findings: 0, blocking: 0, kinds: [] };
    s.hunks++;
    if (j) {
      s.maxRisk = Math.max(s.maxRisk, j.risk);
      if (!s.kinds.includes(j.kind)) s.kinds.push(j.kind);
    }
    map.set(h.file, s);
  }
  for (const f of findings) {
    const s = map.get(f.file);
    if (!s) continue;
    s.findings++;
    if (f.severity === "block") s.blocking++;
  }
  return [...map.values()].sort((a, b) => b.maxRisk - a.maxRisk || a.file.localeCompare(b.file));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}
