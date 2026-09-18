import type { Judgment, Bucket, AssigneeCandidate } from "./resolve.ts";
import { bucketFor } from "./resolve.ts";
import type { ResolvedDeadline } from "./deadline.ts";

export interface MinuteItem {
  id: number;
  utteranceId: number;
  bucket: Bucket;
  text: string;
  speaker: string;
  assignee: string | null;
  assigneeUncertain: boolean;
  assigneeCandidates: AssigneeCandidate[];
  /** True once a human fixed the owner in the room */
  assigneeEdited: boolean;
  deadline: ResolvedDeadline;
  importance: number;
  blocked: boolean;
  reverses: boolean;
  kindConfidence: number;
  /** ms from end of utterance to the moment the card was painted; null until measured */
  latencyMs: number | null;
  /** Set on a decision when a later decision reversed it */
  supersededBy: number | null;
}

export interface AggregateState {
  items: MinuteItem[];
  nextId: number;
}

export const emptyAggregate = (): AggregateState => ({ items: [], nextId: 1 });

/**
 * Turns one judgment into zero or one list item and applies the reversal rule:
 * a decision flagged `reverses` strikes through the most recent live decision.
 */
export function addJudgment(
  state: AggregateState,
  j: Judgment,
  u: { id: number; text: string; speaker: string },
): { state: AggregateState; item: MinuteItem | null } {
  const bucket = bucketFor(j);
  if (!bucket) return { state, item: null };
  const item: MinuteItem = {
    id: state.nextId,
    utteranceId: u.id,
    bucket,
    text: u.text,
    speaker: u.speaker,
    assignee: j.assignee,
    assigneeUncertain: j.assigneeUncertain,
    assigneeCandidates: j.assigneeCandidates,
    assigneeEdited: false,
    deadline: j.deadline,
    importance: j.importance,
    blocked: j.blocked,
    reverses: j.reverses,
    kindConfidence: j.kindConfidence,
    latencyMs: null,
    supersededBy: null,
  };
  let items = state.items;
  if (bucket === "decisions" && j.reverses) {
    const prev = [...items].reverse().find((x) => x.bucket === "decisions" && x.supersededBy === null && x.utteranceId < u.id);
    if (prev) items = items.map((x) => (x.id === prev.id ? { ...x, supersededBy: item.id } : x));
  }
  return { state: { items: [...items, item], nextId: state.nextId + 1 }, item };
}

export function setAssignee(state: AggregateState, itemId: number, name: string | null): AggregateState {
  return {
    ...state,
    items: state.items.map((x) =>
      x.id === itemId ? { ...x, assignee: name, assigneeUncertain: false, assigneeEdited: true } : x,
    ),
  };
}

export function markShown(state: AggregateState, itemId: number, latencyMs: number): AggregateState {
  return {
    ...state,
    items: state.items.map((x) => (x.id === itemId && x.latencyMs === null ? { ...x, latencyMs } : x)),
  };
}

export const byBucket = (items: MinuteItem[], bucket: Bucket): MinuteItem[] => items.filter((x) => x.bucket === bucket);

/** Recent live decisions, oldest first, for the `recent_decisions` state field. */
export const recentDecisions = (items: MinuteItem[], n = 3): string[] =>
  items.filter((x) => x.bucket === "decisions" && x.supersededBy === null).slice(-n).map((x) => x.text);
