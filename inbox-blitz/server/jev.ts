import type { Category, Email, Judgment } from "../src/lib/types.ts";
import { CATEGORIES, SENTIMENT_LEVELS, URGENCY_LEVELS } from "../src/lib/types.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-latest";

type Description = string | Record<string, unknown> | unknown[];

interface NoulQuestion {
  type: "noul";
  instructions: Description;
  criteria?: { true?: string; false?: string };
}
interface ChoiceQuestion {
  type: "choice";
  instructions: Description;
  criteria: Record<string, string | null>;
}
interface ScoreQuestion {
  type: "score";
  instructions: Description;
  criteria: readonly string[];
}

export const noul = (instructions: Description, criteria?: NoulQuestion["criteria"]): NoulQuestion => ({
  type: "noul",
  instructions,
  criteria,
});
export const choice = (instructions: Description, criteria: ChoiceQuestion["criteria"]): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria,
});
export const score = (instructions: Description, criteria: readonly string[]): ScoreQuestion => ({
  type: "score",
  instructions,
  criteria,
});

/**
 * All seven questions about one email, sent in ONE request. Jev evaluates
 * them in parallel, so the extra questions cost tokens but not latency.
 */
export const TRIAGE_QUESTIONS = {
  category: choice(
    "Read `email.subject` and `email.body`. Which single category best describes what this email is primarily about? Judge the sender's actual purpose, not incidental words.",
    {
      billing: "A customer's charges, invoices, payments, duplicate charges, refunds or subscription pricing problems",
      bug: "A customer reports that a product feature is broken, erroring, down, slow or behaving incorrectly",
      feature_request: "A customer asks for new functionality or an improvement that does not exist yet",
      sales_lead: "A prospect or existing customer wants to buy, upgrade, get a quote, book a demo or discuss a contract",
      security: "Security alerts, suspected account compromise, vulnerability reports, suspicious logins, 2FA or credential problems",
      legal_privacy: "Legal notices, GDPR/CCPA data requests, data deletion, subpoenas, DPA or terms questions",
      spam_marketing: "Unsolicited marketing, cold sales outreach, promotional newsletters, phishing, scams or impersonation attempts from outside senders",
      internal: "A coworker writing from our own company domain (northwind.cloud) about operations, meetings, HR, IT, planning or team logistics",
      other: "Anything that fits none of the above, e.g. thank-you notes, offboarding/export requests, misdirected mail, community or press requests",
    },
  ),
  needs_reply: noul(
    "Does the sender of `email` expect a human at our company to write back? Mass mailings, automated notifications, newsletters and marketing blasts do not expect a reply.",
    {
      true: "A specific person is waiting for an answer, decision or confirmation from us",
      false: "No reply is expected: automated, informational, bulk or marketing message",
    },
  ),
  urgency: score(
    "How quickly does this email need action from our team, based on the real situation the sender describes (ignore sarcastic or ironic framing and marketing pressure tactics like fake deadlines)?",
    URGENCY_LEVELS,
  ),
  sentiment: score(
    "What is the sender's actual emotional tone toward our company? Read past politeness formulas and sarcasm to the underlying attitude.",
    SENTIMENT_LEVELS,
  ),
  is_phishing_or_scam: noul(
    "Is this email a phishing attempt or scam: does it try to trick the recipient into clicking a suspicious link, entering credentials, paying a fake invoice, buying gift cards, or acting on a fake authority (fake CEO, fake bank, fake vendor)?",
    {
      true: "Deceptive message designed to steal credentials, money or data",
      false: "Legitimate message from who it claims to be, including pushy or fear-based marketing and cold sales pitches that only ask for a meeting or a purchase from a real company",
    },
  ),
  mentions_churn_or_cancel: noul(
    "Does the sender say they are cancelling, will cancel, are switching to a competitor, or are seriously considering leaving our product or service?",
    {
      true: "The sender themselves is cancelling, leaving or threatening to leave",
      false: "No cancellation or churn intent from the sender (mentions of cancellation in marketing copy, newsletters or someone else's story do not count)",
    },
  ),
  asks_for_refund: noul(
    "Does the sender ask our company to refund, reverse or credit back money they paid?",
    {
      true: "The sender wants their money back or a credit for a charge",
      false: "No request for money back (a refund mentioned in marketing text or a policy description does not count)",
    },
  ),
} as const;

interface NoulAnswer {
  type: "noul";
  noul: number;
}
interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
interface ScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
}

interface TriageAnswers {
  category: ChoiceAnswer;
  needs_reply: NoulAnswer;
  urgency: ScoreAnswer;
  sentiment: ScoreAnswer;
  is_phishing_or_scam: NoulAnswer;
  mentions_churn_or_cancel: NoulAnswer;
  asks_for_refund: NoulAnswer;
}

interface SystemOneResponse<A> {
  model: string;
  answers: A;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * A free-text description typed by the operator ("customers threatening to
 * cancel", "anyone asking for a demo") becomes one noul question. Jev decides
 * per email whether it fits; the label name, filtering and counting are code.
 */
export function intentQuestion(intent: string) {
  return {
    match: noul(
      `An inbox operator wants to find emails that match this description: "${intent}". Read \`email.from\`, \`email.subject\` and \`email.body\`. Does this email genuinely match the description, judged by what the sender actually means and intends rather than by surface keywords?`,
      {
        true: "The email clearly fits the operator's description",
        false: "The email does not fit the description, or only mentions related words in passing, sarcastically, in quoted history or in marketing copy",
      },
    ),
  };
}

export function emailState(email: Email) {
  return {
    email: {
      from: `${email.from} <${email.fromEmail}>`,
      subject: email.subject,
      body: email.body,
    },
  };
}

export function toJudgment(answers: TriageAnswers): Judgment {
  const cat = answers.category.choice;
  const category: Category = (CATEGORIES as readonly string[]).includes(cat) ? (cat as Category) : "other";
  return {
    category,
    categoryConfidence: answers.category.confidence,
    categoryProbabilities: answers.category.probabilities,
    needsReply: answers.needs_reply.noul,
    urgency: answers.urgency.score,
    urgencyConfidence: answers.urgency.confidence,
    sentiment: answers.sentiment.score,
    sentimentConfidence: answers.sentiment.confidence,
    isPhishingOrScam: answers.is_phishing_or_scam.noul,
    mentionsChurnOrCancel: answers.mentions_churn_or_cancel.noul,
    asksForRefund: answers.asks_for_refund.noul,
  };
}

export class JevError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface CallOutcome<A> {
  answers: A;
  latencyMs: number;
  inputTokens: number;
  retries: number;
  model: string;
}

export interface JudgeOutcome {
  judgment: Judgment;
  latencyMs: number;
  inputTokens: number;
  retries: number;
  model: string;
}

export interface MatchOutcome {
  match: number;
  latencyMs: number;
  inputTokens: number;
  retries: number;
  model: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 6;
/** A single round trip is normally ~100-300 ms; anything past this is treated as a lost request and retried. */
export const REQUEST_TIMEOUT_MS = 6000;

/** All seven triage questions for one email in a single TypeSafe call. */
export async function judgeEmail(email: Email, apiKey: string, signal?: AbortSignal): Promise<JudgeOutcome> {
  const { answers, ...rest } = await systemOne<TriageAnswers>(emailState(email), TRIAGE_QUESTIONS, apiKey, signal);
  return { judgment: toJudgment(answers), ...rest };
}

/** One yes/no question — "does this email match the operator's description?" — for one email. */
export async function matchEmail(email: Email, intent: string, apiKey: string, signal?: AbortSignal): Promise<MatchOutcome> {
  const { answers, ...rest } = await systemOne<{ match: NoulAnswer }>(emailState(email), intentQuestion(intent), apiKey, signal);
  return { match: answers.match.noul, ...rest };
}

/**
 * One TypeSafe call. Retries 429/529/5xx and timeouts with exponential
 * backoff (honouring `retry-after`). `latencyMs` is measured with
 * performance.now() around the final successful HTTP round trip only.
 */
export async function systemOne<A>(state: unknown, questions: Record<string, NoulQuestion | ChoiceQuestion | ScoreQuestion>, apiKey: string, signal?: AbortSignal): Promise<CallOutcome<A>> {
  const body = JSON.stringify({ state, model: MODEL, questions });
  let retries = 0;
  for (;;) {
    const t0 = performance.now();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (retries >= MAX_RETRIES) throw new JevError(`TypeSafe request failed after ${retries} retries: ${err instanceof Error ? err.message : String(err)}`, 0);
      retries++;
      await sleep(Math.min(8000, 250 * 2 ** retries) + Math.random() * 100);
      continue;
    }
    const latencyMs = performance.now() - t0;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      await res.text();
      if (retries >= MAX_RETRIES) throw new JevError(`TypeSafe returned ${res.status} after ${retries} retries`, res.status);
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 250 * 2 ** retries) + Math.random() * 100;
      retries++;
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new JevError(`TypeSafe ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    const data = (await res.json()) as SystemOneResponse<A>;
    return { answers: data.answers, latencyMs, inputTokens: data.usage.input_tokens, retries, model: data.model };
  }
}
