import type { JudgeRequest, Span } from "./types";

export interface NoulQuestion {
  type: "noul";
  instructions: string | object;
  criteria?: { true: string; false: string };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string | object;
  criteria: Record<string, string | null>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string | object;
  criteria: string[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export const noul = (instructions: string | object, yes?: string, no?: string): NoulQuestion =>
  yes && no ? { type: "noul", instructions, criteria: { true: yes, false: no } } : { type: "noul", instructions };
export const choice = (instructions: string | object, criteria: Record<string, string | null>): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria,
});
export const score = (instructions: string | object, criteria: string[]): ScoreQuestion => ({
  type: "score",
  instructions,
  criteria,
});

export const TONE_LEVELS = ["warm", "neutral", "curt", "hostile"] as const;
export const LEGAL_LEVELS = ["none", "minor", "material", "severe"] as const;

/** The ten core judgments, in display order. */
export const CORE_QUESTION_IDS = [
  "contains_secret_or_credential",
  "contains_customer_pii",
  "makes_binding_commitment",
  "discloses_confidential_internal_info",
  "tone",
  "is_appropriate_for_audience",
  "is_incomplete_or_cut_off",
  "contains_hedging_that_undermines",
  "legal_or_compliance_risk",
  "should_block_send",
] as const;
export type CoreQuestionId = (typeof CORE_QUESTION_IDS)[number];

export const QUESTION_LABEL: Record<CoreQuestionId, string> = {
  contains_secret_or_credential: "secret / credential",
  contains_customer_pii: "customer PII",
  makes_binding_commitment: "binding commitment",
  discloses_confidential_internal_info: "confidential leak",
  tone: "tone",
  is_appropriate_for_audience: "fits audience",
  is_incomplete_or_cut_off: "incomplete",
  contains_hedging_that_undermines: "undermining hedge",
  legal_or_compliance_risk: "legal risk",
  should_block_send: "verdict",
};

export function buildCoreQuestions(): Record<CoreQuestionId, Question> {
  return {
    contains_secret_or_credential: noul(
      "Does `draft` contain a secret or credential: an API key, access token, password, private key, connection string, or similar value that grants access to a system?",
      "The draft includes the actual secret value (even partially redacted values like sk-live-... count).",
      "No credential value appears; merely mentioning that keys exist does not count.",
    ),
    contains_customer_pii: noul(
      "Does `draft` contain personal data about a customer or end user: a named person's email address, phone number, home address, card or account number, government ID, or health details?",
      "Identifiable personal data about a specific individual appears in the draft.",
      "No personal data, or only the author's own company contact details.",
    ),
    makes_binding_commitment: noul(
      "Does the author of `draft` make a binding commitment to the recipient: promising a refund, a specific delivery or fix date, a discount or price, or that a feature will definitely ship?",
      "A firm promise with words like 'guaranteed', 'will', 'by Friday', 'we'll refund', or a stated price/discount.",
      "No promise, or clearly non-committal language ('we're looking into it', 'no ETA yet').",
    ),
    discloses_confidential_internal_info: noul(
      "Given that `channel.audience` describes who can read this message, does `draft` disclose confidential internal company information to people outside the company: unreleased roadmap, internal pricing or margins, unannounced incidents, other customers' names or deals, internal staffing or legal matters?",
      "Internal-only information is being shared with an external or public audience.",
      "Either the audience is internal, or the content is already public / not confidential.",
    ),
    tone: score("What is the emotional tone of `draft` toward its reader?", [
      "Warm: friendly, appreciative, empathetic.",
      "Neutral: professional and matter-of-fact.",
      "Curt: terse, dismissive, or impatient.",
      "Hostile: angry, insulting, sarcastic, blaming, or threatening.",
    ]),
    is_appropriate_for_audience: noul(
      "Considering `channel.name` and `channel.audience`, is `draft` appropriate to send to this audience as written (content, confidentiality, and professionalism together)?",
      "A reasonable manager would be fine seeing this sent to this channel.",
      "Wrong channel for this content, or content a manager would not want this audience to see.",
    ),
    is_incomplete_or_cut_off: noul(
      "Does `draft` look unfinished: a sentence that stops mid-thought, a dangling placeholder like TODO or [name], or an obvious missing attachment/link that the text refers to?",
      "The message is clearly not finished being written.",
      "The message reads as complete (even if short).",
    ),
    contains_hedging_that_undermines: noul(
      "Does `draft` contain hedging that undermines the author's own message, such as 'I think maybe', 'not sure but', 'this might be wrong', or apologising for asking?",
      "Excessive hedging that makes the author sound unsure of a statement they are making.",
      "Confident wording, or appropriate uncertainty about a genuinely open question.",
    ),
    legal_or_compliance_risk: score(
      "How much legal or compliance risk does sending `draft` to `channel.audience` create for the author's company (contractual promises, regulatory or privacy violations, defamation, admissions of fault, discriminatory remarks)?",
      [
        "None: ordinary business communication.",
        "Minor: slightly loose wording a lawyer might tighten.",
        "Material: an enforceable promise, an admission of liability, or personal data shared without need.",
        "Severe: clear regulatory/privacy breach, leaked credentials, defamation, or discriminatory content.",
      ],
    ),
    should_block_send: choice(
      "Taking `channel.audience` into account, should this `draft` be sent as written, sent after the author reviews a warning, or blocked outright?",
      {
        send: "Safe, professional, and appropriate for this audience.",
        warn: "Sendable but risky: a commitment, a curt tone, unfinished text, or borderline content the author should double-check.",
        block: "Must not be sent: leaked credentials, customer personal data to the wrong audience, hostile tone to a customer, or confidential information leaving the company.",
      },
    ),
  };
}

/** One speculative noul per regex-located span: is THIS span the problem? (select, don't generate) */
export function buildSpanQuestions(spans: Span[]): Record<string, NoulQuestion> {
  const out: Record<string, NoulQuestion> = {};
  for (const s of spans) {
    out[s.id] = noul(
      `The text of \`draft\` contains the ${s.kind} fragment ${JSON.stringify(s.text)} at \`spans\` entry "${s.id}". Given \`channel.audience\`, is this exact fragment something that should not be sent as-is: a real credential, a customer's personal data, or a specific amount or date the author is committing to?`,
      "This fragment is the (or a) reason the message is risky.",
      "This fragment is harmless in context (e.g. the author's own work email, a public URL, a casual mention of a day).",
    );
  }
  return out;
}

export function buildRequestBody(req: JudgeRequest) {
  return {
    model: "jev-latest",
    state: {
      channel: req.channel,
      draft: req.draft,
      spans: req.spans.map((s) => ({ id: s.id, kind: s.kind, text: s.text })),
    },
    questions: { ...buildCoreQuestions(), ...buildSpanQuestions(req.spans) },
  };
}
