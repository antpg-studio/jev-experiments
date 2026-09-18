export type Audience = "external_customer" | "internal" | "public";

export interface Channel {
  id: string;
  name: string;
  label: string;
  audience: Audience;
  description: string;
}

export type SpanKind = "email" | "phone" | "key" | "money" | "date" | "url";

export interface Span {
  id: string;
  kind: SpanKind;
  text: string;
  start: number;
  end: number;
}

export type Verdict = "send" | "warn" | "block";

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

export interface JudgeRequest {
  channel: Pick<Channel, "name" | "audience">;
  draft: string;
  spans: Span[];
}

export interface JudgeResponse {
  answers: Record<string, Answer>;
  /** Server-measured round trip to api.typesafe.ai in ms. */
  apiMs: number;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  questionCount: number;
  mock: boolean;
}
