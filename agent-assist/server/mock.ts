import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { CHURN_LEVELS, FRUSTRATION_LEVELS, INTENTS } from "../src/lib/questions.ts";
import type { Intent, JudgeAnswers, JudgeState } from "../src/lib/questions.ts";

/**
 * MOCK=1 answers. Deliberately crude keyword heuristics so the UI can be exercised offline;
 * the UI shows a prominent "MOCK" banner whenever these are in use. Never used by default.
 */
const INTENT_KEYWORDS: Array<[Intent, RegExp]> = [
  ["gratitude_or_closing", /\b(thank|thanks|perfect|found it|that's all)\b/i],
  ["data_privacy_request", /\b(gdpr|ccpa|erasure|article 1[57]|personal data|delete my data)\b/i],
  ["cancellation_threat", /\b(competitor|cancel|moving my|leaving|manager)\b/i],
  ["billing_dispute", /\b(charged|charge|refund|invoice|\$\d+)\b/i],
  ["account_access", /\b(log ?in|locked|password|2fa|sign in)\b/i],
  ["shipping_delay", /\b(order|tracking|carrier|in transit|ship)\b/i],
  ["bug_report", /\b(502|webhook|error|logs?|deploy|failing)\b/i],
  ["feature_question", /\b(support|does the|can i|roadmap|integration)\b/i],
  ["general_help", /\b(can't find|screen|grandson|bother|picture of)\b/i],
];

const INTENT_TO_MACRO: Record<Intent, string> = {
  billing_dispute: "duplicate_charge_refund",
  account_access: "account_unlock_reset",
  cancellation_threat: "escalate_to_supervisor",
  feature_question: "feature_availability_by_plan",
  data_privacy_request: "privacy_data_request",
  shipping_delay: "shipping_tracking_update",
  bug_report: "bug_acknowledged_engineering",
  general_help: "guided_walkthrough",
  gratitude_or_closing: "none",
  other: "none",
};

function choiceOf<T extends string>(options: readonly T[], pick: T, p = 0.8): ChoiceResponse {
  const rest = (1 - p) / Math.max(1, options.length - 1);
  const probabilities: Record<string, number> = {};
  for (const o of options) probabilities[o] = o === pick ? p : rest;
  return { type: "choice", choice: pick, confidence: p, probabilities };
}

function scoreOf(levels: readonly string[], level: number): ScoreResponse {
  const legend: Record<string, string> = {};
  const probabilities: Record<string, number> = {};
  levels.forEach((l, i) => {
    legend[String(i)] = l;
    probabilities[String(i)] = i === level ? 0.85 : 0.15 / (levels.length - 1);
  });
  return { type: "score", score: level, confidence: 0.85, legend, probabilities };
}

function noulOf(yes: boolean): NoulResponse {
  return { type: "noul", noul: yes ? 0.9 : 0.1 };
}

export function mockAnswers(state: JudgeState): JudgeAnswers {
  const last = [...state.conversation].reverse().find((m) => m.role === "customer")?.text ?? "";
  const all = state.conversation.map((m) => m.text).join("\n");
  const intent: Intent = INTENT_KEYWORDS.find(([, re]) => re.test(last))?.[0] ?? "other";
  const angry = /\b(losing|six|every single|competitor|manager|ridiculous)\b/i.test(last) || /!{1,}/.test(last);
  const churn = /\b(competitor|moving my|cancel)\b/i.test(all) ? 3 : /\b(second time|again|every time)\b/i.test(all) ? 2 : angry ? 1 : 0;
  const macroIds = [...Object.values(INTENT_TO_MACRO), "none"];
  return {
    best_macro: choiceOf(macroIds, INTENT_TO_MACRO[intent], 0.72),
    intent: choiceOf(Object.keys(INTENTS) as Intent[], intent, 0.78),
    churn_risk: scoreOf(CHURN_LEVELS, churn),
    frustration: scoreOf(FRUSTRATION_LEVELS, angry ? 3 : churn >= 2 ? 2 : /\b(honestly|still|again)\b/i.test(last) ? 1 : 0),
    needs_escalation_to_human_supervisor: noulOf(/\b(manager|competitor|gdpr|legal)\b/i.test(all)),
    customer_requests_refund: noulOf(/\b(refund|money back|credit)\b/i.test(all)),
    contains_regulatory_request: noulOf(/\b(gdpr|ccpa|article|erasure|legal)\b/i.test(all)),
    agent_should_apologize_first: noulOf(/\b(charged twice|down|failing|late|hasn't moved|502)\b/i.test(all)),
    resolution_likely_this_session: noulOf(!/\b(engineering|carrier|legal|manager|competitor|gdpr)\b/i.test(all)),
  };
}
