import type { ChatScript } from "../data/scripts.ts";
import type { CustomerProfile, JudgeAnswers, Message } from "./questions.ts";

export interface Judgment {
  messageIndex: number;
  answers: JudgeAnswers;
  jevMs: number;
  panelMs: number;
  /** performance.now() when the answers landed in the browser. */
  arrivedAt: number;
  mock: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export interface Chat {
  id: string;
  label: string;
  customer: CustomerProfile;
  messages: Message[];
  /** Number of scripted customer messages delivered so far. */
  delivered: number;
  scriptLength: number;
  playing: boolean;
  pending: boolean;
  judgment: Judgment | null;
  /** Total customer messages judged in this chat. */
  judged: number;
  draft: string;
  draftSource: "auto" | "manual" | null;
  error: string | null;
}

export interface Sample {
  chatId: string;
  panelMs: number;
  jevMs: number;
  at: number;
}

export interface State {
  chats: Chat[];
  activeId: string;
  samples: Sample[];
  tokens: number;
  runStartedAt: number | null;
  runEndedAt: number | null;
  baseline: boolean;
}

export type Action =
  | { type: "customer_message"; chatId: string; text: string }
  | { type: "agent_message"; chatId: string; text: string }
  | { type: "judging"; chatId: string }
  | { type: "judged"; chatId: string; judgment: Judgment; draft: string | null }
  | { type: "judge_failed"; chatId: string; error: string }
  | { type: "set_draft"; chatId: string; draft: string; source: "auto" | "manual" | null }
  | { type: "set_playing"; chatIds: string[]; playing: boolean }
  | { type: "select"; chatId: string }
  | { type: "toggle_baseline" }
  | { type: "run_started"; at: number }
  | { type: "run_ended"; at: number }
  | { type: "reset"; scripts: ChatScript[] };

export function initialState(scripts: ChatScript[]): State {
  return {
    chats: scripts.map((s) => ({
      id: s.id,
      label: s.label,
      customer: s.customer,
      messages: [],
      delivered: 0,
      scriptLength: s.messages.length,
      playing: false,
      pending: false,
      judgment: null,
      judged: 0,
      draft: "",
      draftSource: null,
      error: null,
    })),
    activeId: scripts[0]?.id ?? "",
    samples: [],
    tokens: 0,
    runStartedAt: null,
    runEndedAt: null,
    baseline: false,
  };
}

function updateChat(state: State, chatId: string, fn: (c: Chat) => Chat): State {
  return { ...state, chats: state.chats.map((c) => (c.id === chatId ? fn(c) : c)) };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "customer_message":
      return updateChat(state, action.chatId, (c) => ({
        ...c,
        messages: [...c.messages, { role: "customer", text: action.text }],
        delivered: c.delivered + 1,
        error: null,
      }));
    case "agent_message":
      return updateChat(state, action.chatId, (c) => ({
        ...c,
        messages: [...c.messages, { role: "agent", text: action.text }],
        draft: "",
        draftSource: null,
      }));
    case "judging":
      return updateChat(state, action.chatId, (c) => ({ ...c, pending: true }));
    case "judged": {
      const next = updateChat(state, action.chatId, (c) => ({
        ...c,
        pending: false,
        judgment: action.judgment,
        judged: c.judged + 1,
        draft: action.draft ?? (c.draftSource === "auto" ? "" : c.draft),
        draftSource: action.draft ? "auto" : c.draftSource === "auto" ? null : c.draftSource,
      }));
      return {
        ...next,
        tokens: next.tokens + action.judgment.usage.input_tokens + action.judgment.usage.output_tokens,
        samples: [
          ...next.samples,
          { chatId: action.chatId, panelMs: action.judgment.panelMs, jevMs: action.judgment.jevMs, at: action.judgment.arrivedAt },
        ],
      };
    }
    case "judge_failed":
      return updateChat(state, action.chatId, (c) => ({ ...c, pending: false, error: action.error }));
    case "set_draft":
      return updateChat(state, action.chatId, (c) => ({ ...c, draft: action.draft, draftSource: action.source }));
    case "set_playing":
      return {
        ...state,
        chats: state.chats.map((c) => (action.chatIds.includes(c.id) ? { ...c, playing: action.playing } : c)),
      };
    case "select":
      return { ...state, activeId: action.chatId };
    case "toggle_baseline":
      return { ...state, baseline: !state.baseline };
    case "run_started":
      return { ...state, runStartedAt: action.at, runEndedAt: null };
    case "run_ended":
      return { ...state, runEndedAt: action.at };
    case "reset":
      return { ...initialState(action.scripts), baseline: state.baseline };
  }
}

/** Simulated delay of a typical LLM prompt-and-parse copilot. Clearly labelled as simulated in the UI. */
export const LLM_BASELINE_MS = 4000;
