export type Truth =
  | "ok"
  | "backseat"
  | "harassment"
  | "slur_evasion"
  | "scam"
  | "doxxing"
  | "self_harm"
  | "spam"
  | "off_topic_fight";

/** Ground-truth categories a moderator would want removed. */
export const HARMFUL_TRUTHS: ReadonlySet<Truth> = new Set<Truth>([
  "harassment",
  "slur_evasion",
  "scam",
  "doxxing",
  "spam",
  "off_topic_fight",
]);

export type JevAction = "allow" | "hide" | "timeout_user" | "escalate_to_human";

/** Raw judgment returned by Jev for one message (one request, seven questions). */
export interface Judgment {
  action: JevAction;
  actionProbabilities: Record<JevAction, number>;
  actionConfidence: number;
  harassment: number;
  scam_or_phishing: number;
  self_harm_risk: number;
  spam: number;
  is_obfuscated_slur_or_evasion: number;
  /** 0 harmless … 3 severe (probability-weighted). */
  severity: number;
  severityConfidence: number;
}

export interface Timing {
  /** ms the message waited for a free slot before its request went out. */
  queuedMs: number;
  /** ms of the Jev HTTP round trip (performance.now around fetch). */
  jevMs: number;
  /** total ms between message arrival and release to the chat pane. */
  heldMs: number;
  retries: number;
}

export interface ChatMessage {
  id: number;
  user: string;
  color: string;
  text: string;
  truth: Truth;
  /** server arrival time (epoch ms) */
  ts: number;
  raid: boolean;
  judgment: Judgment | null;
  error: string | null;
  timing: Timing;
}

export interface ServerStats {
  inFlight: number;
  queued: number;
  concurrency: number;
  rate: number;
  running: boolean;
  mock: boolean;
  raidRemaining: number;
  totalJudged: number;
  totalErrors: number;
}

export type ServerEvent =
  | { type: "hello"; stats: ServerStats }
  | { type: "message"; message: ChatMessage }
  | { type: "stats"; stats: ServerStats };

export type ClientCommand =
  | { type: "start" }
  | { type: "stop" }
  | { type: "set_rate"; rate: number }
  | { type: "set_concurrency"; concurrency: number }
  | { type: "raid"; count?: number };
