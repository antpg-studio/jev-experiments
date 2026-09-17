/**
 * The only module that talks to TypeSafe. Everything else consumes typed judgments.
 *
 * POST https://api.typesafe.ai/v1/systemone
 *   { state, model: "jev-latest", questions: { id: { type, instructions, criteria } } }
 */
import { performance } from "node:perf_hooks";
import { addedLines, removedLines } from "./diff.ts";
import {
  FINDING_IDS,
  HUNK_KINDS,
  RISK_LEVELS,
  type FindingId,
  type Hunk,
  type HunkJudgment,
  type HunkKind,
  type MessageJudgment,
  type RiskLevel,
} from "./types.ts";

// ---------- question types ----------

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export const noul = (instructions: string, criteria?: { true: string; false: string }): NoulQuestion =>
  criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
export const choice = (instructions: string, criteria: Record<string, string | null>): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria,
});
export const score = (instructions: string, criteria: string[]): ScoreQuestion => ({
  type: "score",
  instructions,
  criteria,
});

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export interface JevCallResult {
  response: SystemOneResponse;
  latencyMs: number;
  attempts: number;
}

// ---------- client ----------

export interface JevClientOptions {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  model?: string | undefined;
  maxAttempts?: number | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "TYPESAFE_API_KEY is not set. Export it (export TYPESAFE_API_KEY=...) or run with --mock to replay recorded judgments.",
    );
    this.name = "MissingApiKeyError";
  }
}

export class JevHttpError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`TypeSafe API responded ${status}: ${body.slice(0, 300)}`);
    this.name = "JevHttpError";
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export class JevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  public retries = 0;

  constructor(opts: JevClientOptions = {}) {
    const key = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!key) throw new MissingApiKeyError();
    this.apiKey = key;
    this.baseUrl = opts.baseUrl ?? process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
    this.model = opts.model ?? "jev-latest";
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** One request = one state + many independent questions (speculative fan-out). */
  async systemOne(state: unknown, questions: Record<string, Question>): Promise<JevCallResult> {
    const body = JSON.stringify({ state, model: this.model, questions });
    const started = performance.now();
    let attempt = 0;
    for (;;) {
      attempt++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: ctrl.signal,
        });
        if (res.ok) {
          const json = (await res.json()) as SystemOneResponse;
          return { response: json, latencyMs: performance.now() - started, attempts: attempt };
        }
        const text = await res.text();
        if (!RETRYABLE.has(res.status) || attempt >= this.maxAttempts) throw new JevHttpError(res.status, text);
        this.retries++;
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
      } catch (err) {
        if (err instanceof JevHttpError) throw err;
        if (attempt >= this.maxAttempts) throw err;
        this.retries++;
        await sleep(backoffMs(attempt, null));
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

export function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 10_000);
  }
  const base = Math.min(200 * 2 ** (attempt - 1), 4_000);
  return base + Math.floor(Math.random() * 100);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run tasks with a concurrency limit, preserving order of results. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone?: (result: R, index: number) => void,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const r = await fn(items[i]!, i);
      results[i] = r;
      onDone?.(r, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- hunk questions ----------

export const MAX_OFFENDING_CANDIDATES = 12;

export interface HunkState {
  file: string;
  language: string;
  change_type: "new file" | "deleted file" | "modification";
  hunk: string;
  added_lines: Record<string, string>;
}

export function buildHunkState(h: Hunk): HunkState {
  const adds = addedLines(h);
  const added_lines: Record<string, string> = {};
  adds.slice(0, MAX_OFFENDING_CANDIDATES).forEach((l, i) => {
    added_lines[`L${i + 1}`] = l.text;
  });
  return {
    file: h.file,
    language: h.language,
    change_type: h.isNewFile ? "new file" : h.isDeletedFile ? "deleted file" : "modification",
    hunk: h.text,
    added_lines,
  };
}

export const RISK_CRITERIA: Record<RiskLevel, string> = {
  cosmetic:
    "Formatting, whitespace, comments, renames of local identifiers, docs or wording-only changes; no behaviour change possible.",
  low: "Small, local behaviour change that is easy to reason about and easy to revert: a bug fix, a new pure helper, a test, a config bump.",
  moderate:
    "Behaviour change that other code depends on, or new logic with branches; needs review but nothing is destroyed or exposed if it is wrong.",
  high: "Touches authentication, authorization, payments, data migrations, infrastructure, or contracts with external callers; mistakes are costly or hard to undo.",
  dangerous:
    "Exposes credentials or user data, permanently deletes or corrupts data, disables security or safety checks, or bypasses authentication; must not ship as-is.",
};

export const KIND_CRITERIA: Record<HunkKind, string> = {
  feature: "Adds new user-visible capability or new behaviour.",
  bugfix: "Corrects existing behaviour that was wrong.",
  refactor: "Restructures code without changing what it does.",
  test: "Adds, changes or removes test code.",
  docs: "Comments, README, or documentation text only.",
  config: "Configuration, environment, dependency versions, build or CI settings.",
  chore: "Housekeeping such as formatting, logging tweaks, or version bumps that fit none of the others.",
};

export function buildHunkQuestions(state: HunkState): Record<string, Question> {
  const candidateCount = Object.keys(state.added_lines).length;
  const offendingCriteria: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(state.added_lines)) offendingCriteria[k] = v;
  offendingCriteria.none = "No added line is concerning; the hunk is benign.";

  const q: Record<string, Question> = {
    risk: score(
      "Judge the risk of shipping the code change in `hunk` (a unified diff hunk from `file`, written in `language`; lines starting with + are added, - removed). How much damage could this change do if it is wrong or if it ships as written?",
      RISK_LEVELS.map((l) => RISK_CRITERIA[l]),
    ),
    leaks_secret_or_token: noul(
      "Does an added line in `hunk` embed a real-looking secret: an API key, access token, password, private key, connection string with credentials, or a live payment/provider key? Placeholders like '<your-key>' or reading from environment variables do not count.",
      {
        true: "A literal credential value (e.g. sk_live_..., ghp_..., AKIA..., a password string, a bearer token) is added to source code.",
        false: "No literal credential is added; secrets are read from env/config or the values are obvious placeholders/examples.",
      },
    ),
    logs_sensitive_data: noul(
      "Does an added line in `hunk` write sensitive data to logs, console, stdout, or an error message: tokens, session ids, passwords, API keys, full card numbers, personal data such as email addresses or full user records?",
      {
        true: "A log/print statement outputs a token, password, secret, card number, or personal user data (possibly via a variable clearly holding one).",
        false: "Logging only outputs non-sensitive values (ids, counts, statuses, durations) or there is no logging.",
      },
    ),
    disables_or_skips_tests: noul(
      "Does `hunk` disable, skip, comment out, or weaken a test or an assertion (for example it.skip, xit, @Ignore, commenting out expect(...), changing an assertion to always pass, or deleting test cases)?",
      {
        true: "A test or assertion is skipped, disabled, removed, or made vacuous.",
        false: "Tests are added or fixed, or the hunk does not touch tests.",
      },
    ),
    destructive_data_change: noul(
      "Does `hunk` introduce an operation that permanently deletes, truncates, drops, or overwrites stored data or schema: DROP TABLE/COLUMN, TRUNCATE, DELETE/UPDATE without a WHERE clause, rm -rf on data, deleteMany({}) with no filter, irreversible migrations?",
      {
        true: "Existing data or schema is destroyed or overwritten irreversibly, or a bulk delete/update has no restricting condition.",
        false: "No data is destroyed; additive schema changes, filtered deletes of specific rows, or non-data code.",
      },
    ),
    changes_public_api_shape: noul(
      "Does `hunk` change the shape of data exposed to external callers: a renamed or removed field in an HTTP response/JSON payload, a changed exported function signature or return type consumers depend on, a changed CLI flag, or a changed event/message schema?",
      {
        true: "A field, parameter, type or contract that clients or other services consume is renamed, removed, retyped or restructured.",
        false: "The change is internal, purely additive (new optional field), or does not touch any external contract.",
      },
    ),
    leftover_debug_or_temp: noul(
      "Does `hunk` add temporary or debugging code that should not be committed: console.log/print debugging output, debugger statements, commented-out code, 'TODO remove before merge', hard-coded test shortcuts, sleep() for debugging, or feature flags forced on?",
      {
        true: "Debug/temporary scaffolding is added that the author clearly intends to remove or that only makes sense while developing locally.",
        false: "Any logging or TODOs present are intentional production code; nothing temporary is added.",
      },
    ),
    hardcoded_env_specific_value: noul(
      "Does an added line in `hunk` hard-code an environment-specific value that should come from configuration: an internal IP address, localhost or staging/production hostname, an absolute local file path, a specific port, a personal email, or a region/account id?",
      {
        true: "A literal URL/IP/host/path/account identifier tied to one environment or one machine is written into the code.",
        false: "Values come from config/env, or literals present are generic constants (0, 3, 'utf-8', public documentation URLs).",
      },
    ),
    kind: choice("What kind of change is `hunk`?", { ...KIND_CRITERIA }),
  };
  if (candidateCount > 0) {
    q.offending_line = choice(
      "Which entry of `added_lines` is the single most concerning added line in `hunk` (a leaked secret, sensitive logging, destructive data operation, skipped test, debug leftover, hard-coded environment value, or auth/safety bypass)? Choose none if every added line is benign.",
      offendingCriteria,
    );
  }
  return q;
}

export function parseHunkJudgment(
  hunkId: string,
  state: HunkState,
  call: JevCallResult,
): HunkJudgment {
  const a = call.response.answers;
  const risk = expectScore(a.risk, "risk");
  const kind = expectChoice(a.kind, "kind");
  const findings = {} as Record<FindingId, number>;
  for (const id of FINDING_IDS) findings[id] = expectNoul(a[id], id).noul;
  const offending = a.offending_line ? expectChoice(a.offending_line, "offending_line") : null;
  let offendingLineIndex: number | null = null;
  if (offending && offending.choice !== "none") {
    const idx = Number(offending.choice.slice(1)) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < Object.keys(state.added_lines).length) offendingLineIndex = idx;
  }
  const kindChoice = (HUNK_KINDS as readonly string[]).includes(kind.choice) ? (kind.choice as HunkKind) : "chore";
  return {
    hunkId,
    risk: risk.score,
    riskLevel: riskLevelFor(risk.score),
    riskConfidence: risk.confidence,
    kind: kindChoice,
    kindConfidence: kind.confidence,
    findings,
    offendingLineIndex,
    latencyMs: call.latencyMs,
    inputTokens: call.response.usage.input_tokens,
    outputTokens: call.response.usage.output_tokens,
    attempts: call.attempts,
  };
}

export function riskLevelFor(s: number): RiskLevel {
  const idx = Math.max(0, Math.min(RISK_LEVELS.length - 1, Math.round(s)));
  return RISK_LEVELS[idx]!;
}

/** Judge one hunk with one request (all questions fan out inside the request). */
export async function judgeHunk(client: JevClient, h: Hunk): Promise<HunkJudgment> {
  const state = buildHunkState(h);
  const call = await client.systemOne(state, buildHunkQuestions(state));
  return parseHunkJudgment(h.id, state, call);
}

// ---------- commit message questions ----------

export interface MessageState {
  commit_message: string;
  changes: Array<{ file: string; kind: HunkKind; risk: RiskLevel; added: string[]; removed: string[] }>;
}

export function buildMessageState(message: string, hunks: Hunk[], judgments: HunkJudgment[]): MessageState {
  const byId = new Map(judgments.map((j) => [j.hunkId, j]));
  return {
    commit_message: message.trim(),
    changes: hunks.map((h) => {
      const j = byId.get(h.id);
      return {
        file: h.file,
        kind: j?.kind ?? "chore",
        risk: j?.riskLevel ?? "low",
        added: addedLines(h)
          .slice(0, 4)
          .map((l) => l.text.trim())
          .filter(Boolean),
        removed: removedLines(h)
          .slice(0, 2)
          .map((l) => l.text.trim())
          .filter(Boolean),
      };
    }),
  };
}

export const MESSAGE_QUALITY_LEVELS = [
  "Empty, a placeholder, or meaningless ('wip', 'fix', 'asdf', 'update stuff').",
  "Vague: names a topic but not what changed or why ('fix bug', 'update config', 'changes').",
  "Adequate: states what changed in concrete terms so a reader can locate the change.",
  "Excellent: states what changed and why, in imperative mood, and is specific about scope and any risk or migration.",
];

export function buildMessageQuestions(): Record<string, Question> {
  return {
    message_matches_changes: noul(
      "Does `commit_message` honestly and completely describe the set of code changes listed in `changes` (each entry shows the file, the kind of change, its risk, and the main added/removed lines)? A message that omits a significant or risky change, or describes a different change, does not match.",
      {
        true: "Every significant change in `changes` is reflected in the message and the message does not claim anything the changes do not do.",
        false: "The message leaves out a significant change (e.g. calls a schema drop a 'typo fix'), describes something else, or is too generic to describe these changes.",
      },
    ),
    message_quality: score("How well-written is `commit_message` as a git commit message?", MESSAGE_QUALITY_LEVELS),
  };
}

export async function judgeMessage(client: JevClient, state: MessageState): Promise<MessageJudgment> {
  const call = await client.systemOne(state, buildMessageQuestions());
  return parseMessageJudgment(call);
}

export function parseMessageJudgment(call: JevCallResult): MessageJudgment {
  const a = call.response.answers;
  const matches = expectNoul(a.message_matches_changes, "message_matches_changes");
  const quality = expectScore(a.message_quality, "message_quality");
  const levelIdx = Math.max(0, Math.min(MESSAGE_QUALITY_LEVELS.length - 1, Math.round(quality.score)));
  return {
    matchesChanges: matches.noul,
    quality: quality.score,
    qualityLevel: ["poor", "vague", "adequate", "excellent"][levelIdx]!,
    qualityConfidence: quality.confidence,
    latencyMs: call.latencyMs,
    inputTokens: call.response.usage.input_tokens,
    outputTokens: call.response.usage.output_tokens,
  };
}

// ---------- answer guards ----------

function expectNoul(a: Answer | undefined, id: string): NoulAnswer {
  if (!a || a.type !== "noul") throw new Error(`Expected noul answer for ${id}`);
  return a;
}
function expectChoice(a: Answer | undefined, id: string): ChoiceAnswer {
  if (!a || a.type !== "choice") throw new Error(`Expected choice answer for ${id}`);
  return a;
}
function expectScore(a: Answer | undefined, id: string): ScoreAnswer {
  if (!a || a.type !== "score") throw new Error(`Expected score answer for ${id}`);
  return a;
}

/** Number of judgments (questions) asked per hunk request. */
export function hunkQuestionCount(h: Hunk): number {
  return Object.keys(buildHunkQuestions(buildHunkState(h))).length;
}
