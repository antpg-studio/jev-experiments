import { choice, noul, score } from "@typesafe-ai/sdk";
import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";

export type Role = "customer" | "agent";

export interface Message {
  role: Role;
  text: string;
}

export interface CustomerProfile {
  name: string;
  plan: "free" | "starter" | "pro" | "business";
  tenure_months: number;
  prior_tickets: number;
}

export interface MacroSummary {
  id: string;
  title: string;
  summary: string;
}

/** The exact state object sent to Jev on every customer message. */
export interface JudgeState {
  conversation: Message[];
  customer: Omit<CustomerProfile, "name">;
  catalog_of_macros: MacroSummary[];
}

export const INTENTS = {
  billing_dispute: "A charge, invoice, duplicate payment or refund problem",
  account_access: "Cannot log in, locked out, password or 2FA problems",
  cancellation_threat: "Customer says or implies they will leave, cancel or switch to a competitor",
  feature_question: "Asking whether something is possible, supported, or on the roadmap",
  data_privacy_request: "Requests about personal data: erasure, export, GDPR, CCPA or legal demands",
  shipping_delay: "A physical order is late, lost or stuck in transit",
  bug_report: "Something is broken and the customer describes errors or provides logs",
  general_help: "Needs guidance using the product, confused about the interface",
  gratitude_or_closing: "Thanking the agent, confirming the problem is solved, or ending the chat",
  other: "None of the above",
} as const;

export type Intent = keyof typeof INTENTS;

export const CHURN_LEVELS = [
  "No churn signal: the customer is neutral or positive about staying",
  "Mild: some dissatisfaction but no mention of leaving",
  "Elevated: repeated problems or comparisons with alternatives, leaving is plausible",
  "Severe: explicitly threatens to cancel, switch provider, or demands an exit",
] as const;

export const FRUSTRATION_LEVELS = [
  "Calm and polite",
  "Slightly annoyed or impatient",
  "Clearly frustrated, repeats complaints or uses emphatic language",
  "Angry or hostile, ultimatums, insults or shouting",
] as const;

export const CONVERSATION_WINDOW = 6;

export function buildQuestions(macros: MacroSummary[]) {
  const macroCriteria: Record<string, string> = {};
  for (const m of macros) macroCriteria[m.id] = `${m.title}: ${m.summary}`;
  macroCriteria.none =
    "No macro in the catalog is a good reply to the customer's latest message; the agent should write a custom reply";

  return {
    best_macro: choice(
      "Which macro from `catalog_of_macros` is the best canned reply for the agent to send in response to the LAST customer message in `conversation`, given the whole conversation so far? Pick `none` if no macro fits the latest message.",
      macroCriteria,
    ),
    intent: choice(
      "What is the primary intent of the customer in the LAST customer message of `conversation`, in the context of the earlier messages?",
      INTENTS,
    ),
    churn_risk: score(
      "How likely is this customer to cancel or leave, judging from the whole `conversation` and `customer` profile?",
      CHURN_LEVELS,
    ),
    frustration: score("How frustrated is the customer in the LAST customer message of `conversation`?", FRUSTRATION_LEVELS),
    needs_escalation_to_human_supervisor: noul(
      "Should this chat be escalated to a human supervisor or manager right now, based on the `conversation`?",
      {
        true: "The customer explicitly asks for a manager, threatens to leave, raises a legal or regulatory demand, or the issue is beyond what a front-line agent can resolve",
        false: "A front-line agent can handle this conversation on their own",
      },
    ),
    customer_requests_refund: noul(
      "Does the customer ask for, or clearly expect, money back (a refund, chargeback, reimbursement or credit) anywhere in the `conversation`?",
      {
        true: "The customer asks for a refund, reimbursement, or account credit",
        false: "No request or expectation of money back",
      },
    ),
    contains_regulatory_request: noul(
      "Does the `conversation` contain a data-protection or legal request, such as GDPR, CCPA, right to erasure, right of access, data export, subpoena or a demand made under a law or regulation?",
      {
        true: "The customer cites a law or regulation, or makes a data erasure, data access or legal demand",
        false: "An ordinary support conversation with no legal or data-protection request",
      },
    ),
    agent_should_apologize_first: noul(
      "Should the agent begin the next reply with an apology, because the customer in the `conversation` was harmed or inconvenienced by something on the company's side (a bug, outage, wrong charge, delay or poor prior support)?",
      {
        true: "The company caused a problem or inconvenience; the reply should open with an apology",
        false: "Nothing to apologize for: a neutral question, a user-side issue, or the customer is thanking us",
      },
    ),
    resolution_likely_this_session: noul(
      "Can the agent most likely fully resolve the customer's issue within this chat session, without waiting on engineering, a carrier, a legal team or a manager?",
      {
        true: "The issue can be closed in this chat: answering a question, sending a link, guiding through the UI, or issuing a refund the agent can do",
        false: "Resolution depends on another team, an external party, a multi-day process, or the customer is too upset to close today",
      },
    ),
  };
}

export type Questions = ReturnType<typeof buildQuestions>;
export type QuestionId = keyof Questions;

export interface JudgeAnswers {
  best_macro: ChoiceResponse;
  intent: ChoiceResponse;
  churn_risk: ScoreResponse;
  frustration: ScoreResponse;
  needs_escalation_to_human_supervisor: NoulResponse;
  customer_requests_refund: NoulResponse;
  contains_regulatory_request: NoulResponse;
  agent_should_apologize_first: NoulResponse;
  resolution_likely_this_session: NoulResponse;
}

export interface JudgeRequest {
  chatId: string;
  messageIndex: number;
  conversation: Message[];
  customer: CustomerProfile;
}

export interface JudgeResponse {
  chatId: string;
  messageIndex: number;
  answers: JudgeAnswers;
  /** Wall-clock milliseconds the server spent inside the Jev call, measured with performance.now(). */
  jevMs: number;
  usage: { input_tokens: number; output_tokens: number };
  mock: boolean;
  model: string;
}

export function windowConversation(conversation: Message[], size = CONVERSATION_WINDOW): Message[] {
  return conversation.slice(-size);
}

export function buildState(req: Pick<JudgeRequest, "conversation" | "customer">, macros: MacroSummary[]): JudgeState {
  const { name: _name, ...customer } = req.customer;
  return {
    conversation: windowConversation(req.conversation),
    customer,
    catalog_of_macros: macros,
  };
}
