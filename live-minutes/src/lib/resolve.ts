import type { JudgeAnswers, Kind, MeetingContext } from "./types.ts";
import { resolveDeadline, type ResolvedDeadline } from "./deadline.ts";

/** Below this Choice confidence the assignee is shown as a "?" chip the user can fix. */
export const ASSIGNEE_CONFIDENCE = 0.6;
export const NOUL_YES = 0.5;
export const KIND_CONFIDENCE_LOW = 0.5;

export interface AssigneeCandidate {
  name: string;
  p: number;
}

export interface Judgment {
  kind: Kind;
  kindConfidence: number;
  kindProbabilities: Record<string, number>;
  /** Resolved owner name (speaker_themself already mapped), or null */
  assignee: string | null;
  assigneeConfidence: number;
  /** True when the UI should show the "?" chip */
  assigneeUncertain: boolean;
  assigneeCandidates: AssigneeCandidate[];
  hasDeadline: boolean;
  deadline: ResolvedDeadline;
  reverses: boolean;
  blocked: boolean;
  /** 0 trivial … 3 critical */
  importance: number;
}

export function resolveJudgment(answers: JudgeAnswers, utterance: string, speaker: string, ctx: MeetingContext): Judgment {
  const kind = answers.kind.choice as Kind;
  const mapName = (opt: string) => (opt === "speaker_themself" ? speaker : opt);

  const candidates: AssigneeCandidate[] = Object.entries(answers.assignee.probabilities)
    .filter(([opt]) => opt !== "unassigned")
    .map(([opt, p]) => ({ name: mapName(opt), p }))
    .sort((a, b) => b.p - a.p);

  const rawAssignee = answers.assignee.choice;
  const assignee = rawAssignee === "unassigned" ? null : mapName(rawAssignee);
  const isTask = kind === "action_item";
  const assigneeUncertain = isTask && (assignee === null || answers.assignee.confidence < ASSIGNEE_CONFIDENCE);

  const hasDeadline = answers.has_deadline.noul >= NOUL_YES && answers.deadline_kind.choice !== "none";
  const deadline = hasDeadline
    ? resolveDeadline(answers.deadline_kind.choice as ResolvedDeadline["kind"], utterance, ctx)
    : resolveDeadline("none", utterance, ctx);

  return {
    kind,
    kindConfidence: answers.kind.confidence,
    kindProbabilities: answers.kind.probabilities,
    assignee: isTask ? assignee : null,
    assigneeConfidence: answers.assignee.confidence,
    assigneeUncertain,
    assigneeCandidates: candidates,
    hasDeadline,
    deadline,
    reverses: answers.reverses_earlier_decision.noul >= NOUL_YES,
    blocked: answers.is_blocked.noul >= NOUL_YES,
    importance: answers.importance.score,
  };
}

export type Bucket = "decisions" | "actions" | "questions" | "risks";

/** Which right-hand list (if any) an utterance lands in. Blocked status updates surface as risks. */
export function bucketFor(j: Judgment): Bucket | null {
  switch (j.kind) {
    case "action_item":
      return "actions";
    case "decision":
      return "decisions";
    case "open_question":
      return "questions";
    case "risk":
      return "risks";
    case "status_update":
      return j.blocked ? "risks" : null;
    default:
      return null;
  }
}
