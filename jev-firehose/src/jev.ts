import type { ChatMessage, Lang } from "./generator.ts";
import { streamContext } from "./generator.ts";

// Every message is judged by one Jev request carrying all of these questions
// (fan-out). Question ids are for code; the model sees only instructions/criteria.

export const LANGS: readonly Lang[] = ["english", "spanish", "portuguese", "german", "french", "russian", "japanese", "korean", "other"];

export const questions = {
  harassment: {
    type: "noul",
    instructions: "Is `message.text` harassment: an insult, threat, slur, or demeaning attack aimed at the streamer or another chatter?",
    criteria: { true: "Personal attack, hate, threat, telling someone to quit/die", false: "Banter, criticism of a play, hype, or anything not aimed at a person" },
  },
  spam_or_scam: {
    type: "noul",
    instructions: "Is `message.text` spam or a scam: repeated flooding, giveaway/gift-card/crypto bait, phishing or suspicious links, or unsolicited advertising?",
    criteria: { true: "Copypasta floods, fake giveaways, phishing links, selling followers, self-promotion of another channel", false: "Normal chat, a few emotes, a genuine question" },
  },
  spoiler: {
    type: "noul",
    instructions: "Does `message.text` reveal a spoiler: a plot twist, ending, boss, or match result that the streamer or viewers have not reached yet?",
  },
  question_for_streamer: {
    type: "noul",
    instructions: "Is `message.text` a genuine question addressed to the streamer that they could answer on stream (gear, settings, plans, opinions, how-to)?",
    criteria: { true: "A real question the streamer would want to see", false: "Rhetorical, spam, an insult phrased as a question, or not a question" },
  },
  needs_mod_attention: {
    type: "noul",
    instructions: "Should a human moderator look at `message.text`? Yes if it breaks `stream.rules` (harassment, scam or phishing, self-promotion or links, spoilers, flooding).",
  },
  positive_hype: {
    type: "noul",
    instructions: "Is `message.text` positive hype: excitement, praise, celebration, or encouragement for the streamer?",
  },
  language: {
    type: "choice",
    instructions: "Which language is `message.text` mainly written in? Emote-only or symbol-only messages count as english.",
    criteria: Object.fromEntries(LANGS.map((l) => [l, null])),
  },
} as const;

export type QuestionId = keyof typeof questions;

export interface Judgment {
  harassment: number;
  spam_or_scam: number;
  spoiler: number;
  question_for_streamer: number;
  needs_mod_attention: number;
  positive_hype: number;
  language: Lang;
  languageConfidence: number;
  inputTokens: number;
  outputTokens: number;
  source: "jev" | "heuristic";
}

export function buildState(m: ChatMessage) {
  return {
    stream: streamContext,
    message: { user: m.user, text: m.text },
  };
}

type NoulAnswer = { type: "noul"; noul: number };
type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
type Answer = NoulAnswer | ChoiceAnswer | { type: string };

export interface JevResult {
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function noul(answers: Record<string, Answer>, id: QuestionId): number {
  const a = answers[id];
  return a && a.type === "noul" && "noul" in a ? clamp01(a.noul) : 0;
}

export function parseJudgment(r: JevResult): Judgment {
  const a = r.answers ?? {};
  const lang = a.language;
  let language: Lang = "other";
  let languageConfidence = 0;
  if (lang && lang.type === "choice" && "choice" in lang) {
    language = (LANGS as readonly string[]).includes(lang.choice) ? (lang.choice as Lang) : "other";
    languageConfidence = clamp01(lang.confidence);
  }
  return {
    harassment: noul(a, "harassment"),
    spam_or_scam: noul(a, "spam_or_scam"),
    spoiler: noul(a, "spoiler"),
    question_for_streamer: noul(a, "question_for_streamer"),
    needs_mod_attention: noul(a, "needs_mod_attention"),
    positive_hype: noul(a, "positive_hype"),
    language,
    languageConfidence,
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    source: "jev",
  };
}

// Deterministic fallback used when a request fails or the backlog is shed.
// Deliberately crude: it exists so the console never stalls, and to make the
// "before" baseline (heuristic-only mode) visibly worse than Jev.
const slurs = /\b(kys|trash|garbage|idiot|loser|shut up|subhuman|clown|pathetic|imbecil|idiota|lixo|basura|заткнись|бездарь|黙れ|닥쳐)\b|黙れ|닥쳐|заткнись/i;
const scammy = /\[\.\]|https?:\/\/|\bt\.me\b|free (skins|vbucks|robux|nitro)|gift card|giveaway|dm me|\$\d|follow my|sub to my|twitch\.tv\/|my channel|mi canal|meu canal|мой канал/i;
const spoilery = /spoiler|killer|dies|ending|final(e|s)? (result|is)|won the final|3-1|0-3|last boss|asesino|assassino|mörder|majordome|執事|死ぬ/i;
const scripts: [RegExp, Lang][] = [
  [/[\u3040-\u30ff]/, "japanese"],
  [/[\uac00-\ud7af]/, "korean"],
  [/[\u0400-\u04ff]/, "russian"],
  [/\b(que|hola|eres|gracias|vamos|usas|canal)\b/i, "spanish"],
  [/\b(voce|você|mano|galera|muito|nao|não)\b/i, "portuguese"],
  [/\b(ich|du|nicht|welche|spielst|krass)\b/i, "german"],
  [/\b(tu|c'est|quelle|trop|joues|salut)\b/i, "french"],
];

export function heuristicJudgment(text: string): Judgment {
  const rep = /(\S+)(\s+\1){3,}/i.test(text) || /(.)\1{9,}/.test(text) || text.length > 120;
  const harassment = slurs.test(text) ? 0.85 : 0.05;
  const spam = scammy.test(text) || rep ? 0.85 : 0.05;
  const spoiler = spoilery.test(text) ? 0.7 : 0.05;
  const question = /\?\s*$|^(what|how|when|which|do you|are you|can you|will you|que |como |quel|welche|какая|сколько)/i.test(text) && harassment < 0.5 ? 0.75 : 0.05;
  let language: Lang = "english";
  for (const [re, l] of scripts) {
    if (re.test(text)) {
      language = l;
      break;
    }
  }
  return {
    harassment,
    spam_or_scam: spam,
    spoiler,
    question_for_streamer: question,
    needs_mod_attention: Math.max(harassment, spam, spoiler),
    positive_hype: /!{2,}|LETS GO|insane|W |Pog|goat|vamos|krass|すご|미쳤/i.test(text) && harassment < 0.5 ? 0.7 : 0.1,
    language,
    languageConfidence: 0.5,
    inputTokens: 0,
    outputTokens: 0,
    source: "heuristic",
  };
}

// https://docs.typesafe.ai/models — jev-1.13: $0.042 per million input tokens, output free.
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
