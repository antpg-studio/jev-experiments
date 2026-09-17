export type LineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** 1-based line number in the new file (undefined for deleted lines). */
  newLine: number | undefined;
  /** 1-based line number in the old file (undefined for added lines). */
  oldLine: number | undefined;
}

export interface Hunk {
  /** Stable id: `${file}#${index}` */
  id: string;
  file: string;
  oldFile: string;
  language: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
  /** The hunk body re-serialised as unified diff text (without the @@ header). */
  text: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
}

export interface FileDiff {
  file: string;
  oldFile: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  isBinary: boolean;
  hunks: Hunk[];
}

export const RISK_LEVELS = ["cosmetic", "low", "moderate", "high", "dangerous"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const HUNK_KINDS = ["feature", "bugfix", "refactor", "test", "docs", "config", "chore"] as const;
export type HunkKind = (typeof HUNK_KINDS)[number];

export const FINDING_IDS = [
  "leaks_secret_or_token",
  "logs_sensitive_data",
  "disables_or_skips_tests",
  "destructive_data_change",
  "changes_public_api_shape",
  "leftover_debug_or_temp",
  "hardcoded_env_specific_value",
] as const;
export type FindingId = (typeof FINDING_IDS)[number];

export interface HunkJudgment {
  hunkId: string;
  /** Probability-weighted risk position, 0 (cosmetic) .. 4 (dangerous). */
  risk: number;
  riskLevel: RiskLevel;
  riskConfidence: number;
  kind: HunkKind;
  kindConfidence: number;
  findings: Record<FindingId, number>;
  /** Index into the added lines list Jev picked as most concerning, or null. */
  offendingLineIndex: number | null;
  /** Wall-clock latency of the request in ms. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
}

export interface MessageJudgment {
  matchesChanges: number;
  quality: number;
  qualityLevel: string;
  qualityConfidence: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export type Severity = "block" | "warn";

export interface Finding {
  hunkId: string;
  file: string;
  id: FindingId | "risk" | "message_mismatch";
  label: string;
  probability: number;
  severity: Severity;
  /** Quoted offending lines (with + prefix), max 4. */
  quoted: string[];
  /** New-file line number of the first quoted line, if known. */
  line: number | undefined;
}

export interface PolicyOptions {
  strict: boolean;
}

export interface PolicyResult {
  verdict: "pass" | "warn" | "block";
  findings: Finding[];
  blocking: Finding[];
  warnings: Finding[];
}

export interface Timing {
  totalMs: number;
  hunkPhaseMs: number;
  messagePhaseMs: number;
  latencies: number[];
  p50: number;
  p95: number;
  max: number;
  hunksPerSecond: number;
  judgments: number;
  requests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
}
