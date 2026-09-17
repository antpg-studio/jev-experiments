import type { Answer, JudgeRequest } from "../src/lib/types.ts";
import { TONE_LEVELS, LEGAL_LEVELS } from "../src/lib/questions.ts";

/**
 * MOCK=1 only. Crude keyword heuristics so the UI can be exercised offline.
 * Clearly labelled as mock in the UI; never used by default.
 */
export function mockAnswers(req: JudgeRequest): Record<string, Answer> {
  const d = req.draft.toLowerCase();
  const external = req.channel.audience !== "internal";
  const has = (...words: string[]) => words.some((w) => d.includes(w));
  const n = (v: boolean, p = 0.93): Answer => ({ type: "noul", noul: v ? p : 1 - p });

  const secret = req.spans.some((s) => s.kind === "key");
  const pii = req.spans.some((s) => s.kind === "email" || s.kind === "phone") && has("customer", "user", "card");
  const commit = has("guarantee", "we'll ship", "will ship", "refund", "credit", "by friday");
  const leak = external && has("margin", "cost per seat", "killing the", "before the announcement", "roadmap");
  const hostile = has("not our problem", "read the docs", "third time", "incompetent");
  const toneIdx = hostile ? 3 : has("unfortunately", "understand") || has("thanks", "good news", "happy") ? 0 : 1;
  const legalIdx = secret || leak ? 3 : commit ? 2 : hostile ? 1 : 0;
  const verdict = secret || leak || (hostile && external) ? "block" : commit || hostile ? "warn" : "send";

  const scoreAnswer = (levels: readonly string[], idx: number): Answer => ({
    type: "score",
    score: idx,
    confidence: 0.9,
    legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
    probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === idx ? 0.9 : 0.1 / (levels.length - 1)])),
  });

  const answers: Record<string, Answer> = {
    contains_secret_or_credential: n(secret),
    contains_customer_pii: n(pii),
    makes_binding_commitment: n(commit),
    discloses_confidential_internal_info: n(leak),
    tone: scoreAnswer(TONE_LEVELS, toneIdx),
    is_appropriate_for_audience: n(verdict === "send"),
    is_incomplete_or_cut_off: n(/(?:^|\s)(?:todo|\[name\])|[a-z,]$/.test(d) && d.length > 20),
    contains_hedging_that_undermines: n(has("i think maybe", "not sure but", "might be wrong")),
    legal_or_compliance_risk: scoreAnswer(LEGAL_LEVELS, legalIdx),
    should_block_send: {
      type: "choice",
      choice: verdict,
      confidence: 0.9,
      probabilities: { send: verdict === "send" ? 0.9 : 0.05, warn: verdict === "warn" ? 0.9 : 0.05, block: verdict === "block" ? 0.9 : 0.05 },
    },
  };
  for (const s of req.spans) {
    answers[s.id] = n(s.kind === "key" || (s.kind === "money" && commit) || (s.kind === "date" && commit) || (pii && (s.kind === "email" || s.kind === "phone")));
  }
  return answers;
}
