import { TypeSafeClient, choice, noul, score, type Questions } from "@typesafe-ai/sdk";
import { performance } from "node:perf_hooks";
import { CATEGORIES, SEVERITIES, type Category, type LogEvent, type Severity } from "../shared/types.ts";

/**
 * The only module that talks to TypeSafe. Everything else in the server treats Jev as a function
 * from a list of log events to a list of typed verdicts plus a measured round-trip time.
 */
export interface Verdict {
  id: number;
  actionableP: number;
  severityScore: number;
  severity: Severity;
  category: Category;
  categoryConfidence: number;
  securityP: number;
}

export interface JevResult {
  verdicts: Verdict[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export const ACTIONABLE_THRESHOLD = 0.5;
export const SECURITY_THRESHOLD = 0.5;

const SEVERITY_LEVELS = [
  "Noise: routine, expected, or already self-healed. Nothing is wrong.",
  "Informational: worth knowing (a deprecation notice, a blocked scan, a one-off client error) but there is no service impact.",
  "Degraded: performance, capacity, freshness or reliability is slipping, or a risky change was made. Customers are not failing yet.",
  "Customer-impacting: some customers are failing, waiting far too long, or getting wrong or unknown results right now.",
  "Outage: the service or a core dependency is down, or effectively every request is failing.",
] as const;

const CATEGORY_CRITERIA: Record<Category, string> = {
  deploy: "A rollout, new image, or version change caused it.",
  capacity: "A resource is running out or overloaded: memory, disk, connections, replicas, queue depth, replication lag, latency under load.",
  dependency_failure: "An upstream provider or another service is failing, timing out, or returning bad or empty responses.",
  security: "Authentication, authorization, privilege grants, scanning, credential stuffing or other abuse.",
  data_integrity: "Data is missing, mismatched, unreconciled, stale, or a backup wrote nothing.",
  config: "A configuration value, certificate, feature flag or scaling setting is wrong, dangerous or about to expire.",
  transient: "A one-off blip that already recovered on its own (a retry that succeeded, a client that hung up).",
  noise: "Normal operation. Nothing is wrong.",
};

function questionsFor(path: string, servicePath: string, prefix: string): Questions {
  return {
    [`${prefix}actionable`]: noul(
      `Should an on-call engineer look at the log line \`${path}\` (emitted by the service \`${servicePath}\`) right now? Judge what the line means for the system, NOT its log level or the words it contains. A failed attempt that recovered, an expected or canary failure, a client hanging up (HTTP 499, context canceled), a single wrong password, a diagnostic dump, an idempotent duplicate-key retry, a 404 or a deprecation notice is NOT actionable even if it says ERROR or contains a stack trace. A line that looks successful but reveals silent failure (HTTP 200 with a 0-byte body on a checkout or payment path, backup wrote 0 bytes, reconciliation mismatch), a request that took many seconds (rt/urt of several seconds), capacity running out, replication lag, a certificate about to expire, a dangerous privilege grant or scale-down, credential stuffing or vulnerability scanning IS actionable even at INFO level or with a 2xx status.`,
      {
        true: "A human should investigate now: the line indicates customer impact, silent failure, data loss or risk, capacity exhaustion, a dangerous change, or a security event.",
        false: "Routine, expected, self-healed, or merely informational. Nobody needs to act on this line.",
      },
    ),
    [`${prefix}severity`]: score(
      `How severe is the situation described by the log line \`${path}\` for the production system? Judge the consequence, not the log level: a successful retry or an expected canary failure is noise even if it says ERROR; a silent failure (backup wrote 0 bytes, HTTP 200 with an empty body on a payment path, reconciliation mismatch, replication lag, cert expiring) is at least degraded even at INFO; a routine autoscaler or deploy event with no failure is at most degraded.`,
      SEVERITY_LEVELS,
    ),
    [`${prefix}category`]: choice(`What is the root-cause category of the log line \`${path}\`?`, CATEGORY_CRITERIA),
    [`${prefix}security`]: noul(`Is the log line \`${path}\` security-relevant: credential attacks, vulnerability scanning or probing, privilege or scope grants, suspicious tokens, or abuse?`, {
      true: "The line describes or strongly suggests a security event that a security or on-call engineer should know about.",
      false: "Not a security matter (ordinary logins, refreshes, blocked rate limits and normal traffic are not security events).",
    }),
  };
}

export function buildBatchRequest(events: LogEvent[]): { state: unknown; questions: Questions } {
  const state = { events: events.map((e) => ({ service: e.service, line: e.line })) };
  let questions: Questions = {};
  events.forEach((_e, i) => {
    questions = { ...questions, ...questionsFor(`events[${i}].line`, `events[${i}].service`, `e${i}_`) };
  });
  return { state, questions };
}

export function buildSingleRequest(event: LogEvent): { state: unknown; questions: Questions } {
  return { state: { event: { service: event.service, line: event.line } }, questions: questionsFor("event.line", "event.service", "") };
}

type Answers = Record<string, { type: string; noul?: number; score?: number; choice?: string; confidence?: number }>;

export function severityFromScore(s: number): Severity {
  const idx = Math.min(SEVERITIES.length - 1, Math.max(0, Math.round(s)));
  return SEVERITIES[idx];
}

function parseVerdict(answers: Answers, prefix: string, id: number): Verdict {
  const a = answers[`${prefix}actionable`];
  const s = answers[`${prefix}severity`];
  const c = answers[`${prefix}category`];
  const sec = answers[`${prefix}security`];
  const cat = (CATEGORIES as readonly string[]).includes(c?.choice ?? "") ? (c!.choice as Category) : "noise";
  return {
    id,
    actionableP: a?.noul ?? 0,
    severityScore: s?.score ?? 0,
    severity: severityFromScore(s?.score ?? 0),
    category: cat,
    categoryConfidence: c?.confidence ?? 0,
    securityP: sec?.noul ?? 0,
  };
}

export interface JevJudge {
  judge(events: LogEvent[]): Promise<JevResult>;
  readonly mock: boolean;
}

export function createJev(): JevJudge {
  if (process.env.MOCK === "1") return new MockJev();
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set. Export it (or run with MOCK=1 for the clearly-labelled mock mode).");
  }
  return new RealJev();
}

class RealJev implements JevJudge {
  readonly mock = false;
  private client = new TypeSafeClient({
    timeout: 15000,
    retry: { maxRetries: 4 },
  });

  async judge(events: LogEvent[]): Promise<JevResult> {
    const single = events.length === 1;
    const req = single ? buildSingleRequest(events[0]) : buildBatchRequest(events);
    const t0 = performance.now();
    const res = await this.client.systemOne({ state: req.state as never, questions: req.questions });
    const latencyMs = performance.now() - t0;
    const answers = res.answers as unknown as Answers;
    const verdicts = events.map((e, i) => parseVerdict(answers, single ? "" : `e${i}_`, e.id));
    return { verdicts, latencyMs, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}

/** Replays the fixture ground truth with a simulated round trip. Only used when MOCK=1. */
class MockJev implements JevJudge {
  readonly mock = true;
  async judge(events: LogEvent[]): Promise<JevResult> {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 80 + events.length * 6));
    const verdicts = events.map((e) => ({
      id: e.id,
      actionableP: e.truth.actionable ? 0.9 : 0.08,
      severityScore: SEVERITIES.indexOf(e.truth.severity),
      severity: e.truth.severity,
      category: e.truth.category,
      categoryConfidence: 0.85,
      securityP: e.truth.security ? 0.9 : 0.05,
    }));
    return { verdicts, latencyMs: performance.now() - t0, inputTokens: 0, outputTokens: 0 };
  }
}
