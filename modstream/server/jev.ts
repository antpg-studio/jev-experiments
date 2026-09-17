/**
 * The only module that talks to TypeSafe. One request per chat message carrying
 * all seven questions (speculative fan-out); code owns the policy.
 */
import type { JevAction, Judgment, Truth } from "../shared/types.ts";

const ENDPOINT = process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.TYPESAFE_MODEL ?? "jev-latest";

// ---- typed question builders -------------------------------------------------

type NoulQ = { type: "noul"; instructions: string; criteria: { true: string; false: string } };
type ChoiceQ<K extends string> = { type: "choice"; instructions: string; criteria: Record<K, string> };
type ScoreQ = { type: "score"; instructions: string; criteria: string[] };

const noul = (instructions: string, yes: string, no: string): NoulQ => ({
  type: "noul",
  instructions,
  criteria: { true: yes, false: no },
});
const choice = <K extends string>(instructions: string, criteria: Record<K, string>): ChoiceQ<K> => ({
  type: "choice",
  instructions,
  criteria,
});
const score = (instructions: string, levels: string[]): ScoreQ => ({ type: "score", instructions, criteria: levels });

export const QUESTIONS = {
  action: choice<JevAction>(
    "You are the moderation policy for a live video-game stream chat. Which moderation action is right for `message.text`? Viewer chat is casual: hype, emotes, caps, mild profanity, gamer trash talk about the game, and backseat-gaming advice are normal and allowed.",
    {
      allow:
        "Normal chat: hype, questions, emotes, jokes, mild profanity, opinions about the game or the run, unsolicited gameplay advice, banter that does not attack a person.",
      hide: "Remove this single message; the user does not need a timeout: spam floods (the same word, emote or character repeated many times, e.g. 'GG GG GG GG GG GG' or 'AAAAAAAAAA'), scam/phishing or giveaway bait, mild insults, off-topic political fights, disguised abuse where intent is unclear.",
      timeout_user:
        "Clear targeted harassment, threats, hate speech or slurs (including leetspeak or spaced-out spellings), doxxing or posting someone's personal details, telling someone to kill themselves. The user should be timed out.",
      escalate_to_human:
        "A human moderator must look: the sender appears to be in crisis or expressing self-harm or suicidal thoughts, or the situation is serious but genuinely ambiguous.",
    },
  ),
  harassment: noul(
    "Does `message.text` harass, threaten, demean or attack a specific person or group (the streamer, another chatter, or a protected group)? Trash talk about the game itself, self-deprecation, or advice about how to play is not harassment.",
    "Targets a person or group with abuse, threats, hate, slurs or doxxing.",
    "No personal attack: normal chat, banter aimed at the game, or gameplay advice.",
  ),
  scam_or_phishing: noul(
    "Is `message.text` a scam, phishing attempt or unsolicited promotion: free gift cards, giveaways that require a DM or a link, crypto pumps, 'check my bio', suspicious links, selling accounts, or asking for login details?",
    "Tries to lure chatters to a link, DM, giveaway, account sale or crypto deal; a classic chat scam.",
    "Not trying to lure anyone anywhere; an ordinary question or comment.",
  ),
  self_harm_risk: noul(
    "Does `message.text` indicate the SENDER may be at risk of self-harm or suicide, or is in emotional crisis? Telling someone else to harm themselves does not count, nor does hyperbole like 'this game is killing me'.",
    "The sender expresses their own suicidal thoughts, self-harm, hopelessness or crisis.",
    "No sign the sender is at risk; jokes, hyperbole, or attacks on others do not count.",
  ),
  spam: noul(
    "Is `message.text` spam: repeated characters or words, copypasta walls, an all-caps flood with no content, or the same message repeated (see `message.recent_duplicates_from_user`)?",
    "Low-value repetitive flood content.",
    "A normal message, even if short, loud, or just an emote.",
  ),
  is_obfuscated_slur_or_evasion: noul(
    "Does `message.text` contain a slur, hateful term or abusive phrase that has been disguised to evade a word filter (leetspeak like k1ll, spaced letters like k y s, symbol swaps like f@g, homoglyphs, deliberate misspellings, or split words)?",
    "A disguised slur or abusive phrase written to slip past a word filter.",
    "No disguised abuse: ordinary spelling, typos, or gamer slang.",
  ),
  severity: score("How harmful is `message.text` to the chat community if it is shown publicly?", [
    "Harmless: ordinary chat.",
    "Mildly disruptive: spam, off-topic, mild rudeness.",
    "Harmful: scam, targeted insult, doxxing attempt, political derailing.",
    "Severe: slurs, hate speech, threats of violence, telling someone to kill themselves.",
  ]),
};

export const QUESTION_COUNT = Object.keys(QUESTIONS).length;

// ---- response parsing ----------------------------------------------------------

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
interface SystemOneResponse {
  model: string;
  answers: {
    action: ChoiceAnswer;
    harassment: NoulAnswer;
    scam_or_phishing: NoulAnswer;
    self_harm_risk: NoulAnswer;
    spam: NoulAnswer;
    is_obfuscated_slur_or_evasion: NoulAnswer;
    severity: ScoreAnswer;
  };
  usage: { input_tokens: number; output_tokens: number };
}

const ACTIONS: readonly JevAction[] = ["allow", "hide", "timeout_user", "escalate_to_human"];

function toJudgment(r: SystemOneResponse): Judgment {
  const a = r.answers;
  const action = (ACTIONS as readonly string[]).includes(a.action.choice) ? (a.action.choice as JevAction) : "escalate_to_human";
  const probs = { allow: 0, hide: 0, timeout_user: 0, escalate_to_human: 0 } satisfies Record<JevAction, number>;
  for (const k of ACTIONS) probs[k] = a.action.probabilities[k] ?? 0;
  return {
    action,
    actionProbabilities: probs,
    actionConfidence: a.action.confidence,
    harassment: a.harassment.noul,
    scam_or_phishing: a.scam_or_phishing.noul,
    self_harm_risk: a.self_harm_risk.noul,
    spam: a.spam.noul,
    is_obfuscated_slur_or_evasion: a.is_obfuscated_slur_or_evasion.noul,
    severity: a.severity.score,
    severityConfidence: a.severity.confidence,
  };
}

// ---- client ----------------------------------------------------------------------

export interface JudgeInput {
  text: string;
  user: string;
  recentDuplicatesFromUser: number;
}

export interface JudgeResult {
  judgment: Judgment;
  /** performance.now() ms around the successful fetch */
  latencyMs: number;
  retries: number;
  inputTokens: number;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface JevClient {
  judge(input: JudgeInput): Promise<JudgeResult>;
  readonly mock: boolean;
}

const CONTEXT = "Live Twitch-style chat for a video-game speedrun stream with a few thousand viewers.";

export function createJevClient(apiKey: string, opts: { maxRetries?: number; timeoutMs?: number } = {}): JevClient {
  const maxRetries = opts.maxRetries ?? 4;
  const timeoutMs = opts.timeoutMs ?? 3000;
  return {
    mock: false,
    async judge(input) {
      const body = JSON.stringify({
        model: MODEL,
        state: {
          context: CONTEXT,
          message: { user: input.user, text: input.text, recent_duplicates_from_user: input.recentDuplicatesFromUser },
        },
        questions: QUESTIONS,
      });
      let retries = 0;
      for (;;) {
        const t0 = performance.now();
        let res: Response;
        try {
          res = await fetch(ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          if (retries >= maxRetries) throw new JevError(`network error: ${(err as Error).message}`, null);
          retries++;
          await sleep(backoff(retries));
          continue;
        }
        if (res.ok) {
          const json = (await res.json()) as SystemOneResponse;
          return { judgment: toJudgment(json), latencyMs: performance.now() - t0, retries, inputTokens: json.usage?.input_tokens ?? 0 };
        }
        if ((res.status === 429 || res.status === 529 || res.status >= 500) && retries < maxRetries) {
          retries++;
          const ra = Number(res.headers.get("retry-after"));
          await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(retries));
          continue;
        }
        const text = await res.text().catch(() => "");
        throw new JevError(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status);
      }
    },
  };
}

function backoff(attempt: number): number {
  return Math.min(4000, 150 * 2 ** attempt) + Math.random() * 100;
}

/**
 * MOCK mode: no network. Derives a plausible judgment from the fixture label and
 * sleeps ~150 ms so the pipeline can be exercised offline. The UI shows a MOCK
 * banner whenever this client is active; the default is the real API.
 */
export function createMockJevClient(truthOf: (text: string) => Truth | undefined): JevClient {
  const j = (over: Partial<Judgment>): Judgment => ({
    action: "allow",
    actionProbabilities: { allow: 0.95, hide: 0.02, timeout_user: 0.02, escalate_to_human: 0.01 },
    actionConfidence: 0.95,
    harassment: 0.02,
    scam_or_phishing: 0.01,
    self_harm_risk: 0.01,
    spam: 0.03,
    is_obfuscated_slur_or_evasion: 0.02,
    severity: 0.1,
    severityConfidence: 0.9,
    ...over,
  });
  const byTruth: Record<Truth, () => Judgment> = {
    ok: () => j({}),
    backseat: () => j({ harassment: 0.3, actionConfidence: 0.8, severity: 0.6 }),
    harassment: () => j({ action: "timeout_user", harassment: 0.93, severity: 2.4, actionConfidence: 0.9 }),
    slur_evasion: () => j({ action: "timeout_user", harassment: 0.97, is_obfuscated_slur_or_evasion: 0.95, severity: 2.95 }),
    scam: () => j({ action: "hide", scam_or_phishing: 0.98, severity: 2.0 }),
    doxxing: () => j({ action: "timeout_user", harassment: 0.85, severity: 2.3 }),
    self_harm: () => j({ action: "escalate_to_human", self_harm_risk: 0.88, severity: 1.5 }),
    spam: () => j({ action: "hide", spam: 0.9, severity: 0.7, actionConfidence: 0.7 }),
    off_topic_fight: () => j({ action: "hide", harassment: 0.7, severity: 1.4, actionConfidence: 0.65 }),
  };
  return {
    mock: true,
    async judge(input) {
      const t0 = performance.now();
      await sleep(120 + Math.random() * 60);
      const judgment = byTruth[truthOf(input.text) ?? "ok"]();
      return { judgment, latencyMs: performance.now() - t0, retries: 0, inputTokens: 0 };
    },
  };
}
