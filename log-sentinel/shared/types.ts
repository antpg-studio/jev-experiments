export const SEVERITIES = [
  "noise",
  "informational",
  "degraded",
  "customer-impacting",
  "outage",
] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  "deploy",
  "capacity",
  "dependency_failure",
  "security",
  "data_integrity",
  "config",
  "transient",
  "noise",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SERVICES = [
  "api-gateway",
  "payments",
  "auth",
  "k8s",
  "postgres",
  "nginx",
  "cron",
] as const;
export type Service = (typeof SERVICES)[number];

export type Level = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | "ACCESS" | "EVENT";

/** Labels attached to every fixture template so precision/recall can be computed honestly. */
export interface Truth {
  actionable: boolean;
  severity: Severity;
  category: Category;
  security: boolean;
}

export interface LogEvent {
  id: number;
  ts: number;
  service: Service;
  level: Level;
  /** Full text of the event; multi-line stack traces are joined with "\n". */
  line: string;
  lines: number;
  truth: Truth;
  /** The regex/severity baseline's decision for this event. */
  regexPaged: boolean;
  storm: boolean;
}

export interface Judgment {
  id: number;
  actionable: boolean;
  actionableP: number;
  severity: Severity;
  severityScore: number;
  category: Category;
  categoryConfidence: number;
  security: boolean;
  securityP: number;
  /** Round-trip of the Jev request that carried this event, in ms. */
  latencyMs: number;
  /** Wall time from event emission to judgment being available, in ms. */
  ageMs: number;
  batchSize: number;
  mock: boolean;
}

export interface Incident {
  key: string;
  service: Service;
  category: Category;
  severity: Severity;
  firstSeen: number;
  lastSeen: number;
  count: number;
  security: boolean;
  sample: string;
  eventIds: number[];
}

export interface Metrics {
  eventsPerSec: number;
  judgmentsPerSec: number;
  inFlight: number;
  backlog: number;
  p50: number;
  p95: number;
  p99: number;
  lastLatency: number;
  totalEvents: number;
  totalJudged: number;
  totalRequests: number;
  errors: number;
  elapsedMs: number;
  regexPaged: number;
  jevActionable: number;
  truthActionable: number;
  regex: Accuracy;
  jev: Accuracy;
}

export interface Accuracy {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
}

export type BatchMode = "batch" | "single";

export interface Config {
  rate: number;
  concurrency: number;
  batchSize: number;
  mode: BatchMode;
  paused: boolean;
  mock: boolean;
}

export interface CalibrationResult {
  mode: BatchMode;
  batchSize: number;
  requests: number;
  events: number;
  elapsedMs: number;
  p50: number;
  eventsPerSecPerSlot: number;
}

export interface Calibration {
  results: CalibrationResult[];
  chosen: BatchMode;
  done: boolean;
}

export interface Disagreement {
  id: number;
  service: Service;
  line: string;
  kind: "regex_fp" | "regex_fn" | "jev_fp" | "jev_fn";
  regexPaged: boolean;
  jevActionable: boolean;
  truthActionable: boolean;
}

export type ServerMessage =
  | { type: "hello"; config: Config; calibration: Calibration }
  | { type: "event"; event: LogEvent }
  | { type: "judgment"; judgment: Judgment }
  | { type: "metrics"; metrics: Metrics }
  | { type: "incidents"; incidents: Incident[] }
  | { type: "disagreements"; items: Disagreement[] }
  | { type: "config"; config: Config }
  | { type: "calibration"; calibration: Calibration }
  | { type: "storm"; phase: string }
  | { type: "error"; message: string };
