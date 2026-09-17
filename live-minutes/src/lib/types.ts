export type Kind =
  | "action_item"
  | "decision"
  | "open_question"
  | "risk"
  | "status_update"
  | "chit_chat";

export type DeadlineKind =
  | "specific_date"
  | "this_week"
  | "next_sprint"
  | "before_launch"
  | "end_of_quarter"
  | "none";

export interface Attendee {
  name: string;
  role: string;
}

export interface MeetingContext {
  /** ISO date, e.g. 2026-09-17 */
  today: string;
  /** ISO date the current sprint ends */
  sprintEnd: string;
  /** Sprint length in days */
  sprintDays: number;
  /** ISO date of the launch the team is working toward */
  launch: string;
  attendees: Attendee[];
}

export interface Utterance {
  id: number;
  speaker: string;
  text: string;
  /** Seconds since meeting start when the utterance finishes (replay only) */
  endsAt: number;
}

export interface PreviousUtterance {
  speaker: string;
  text: string;
}

/** Body sent to POST /api/judge */
export interface JudgeRequest {
  utterance: string;
  speaker: string;
  previous: PreviousUtterance[];
  recentDecisions: string[];
  context: MeetingContext;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface JudgeAnswers {
  kind: ChoiceAnswer;
  assignee: ChoiceAnswer;
  has_deadline: NoulAnswer;
  deadline_kind: ChoiceAnswer;
  reverses_earlier_decision: NoulAnswer;
  is_blocked: NoulAnswer;
  importance: ScoreAnswer;
}

export interface JudgeResponse {
  answers: JudgeAnswers;
  /** Server-measured round trip to api.typesafe.ai in ms */
  apiMs: number;
  mock: boolean;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface HealthResponse {
  ok: boolean;
  hasKey: boolean;
  mock: boolean;
}
