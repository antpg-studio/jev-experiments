import type { JudgeAnswers, JudgeRequest } from "../src/lib/types.ts";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "typesafe/jev-1.13";

type Instructions = string | Record<string, unknown>;
type Question =
  | { type: "noul"; instructions: Instructions; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: Instructions; criteria: Record<string, string | null> }
  | { type: "score"; instructions: Instructions; criteria: string[] };

const noul = (instructions: Instructions, criteria?: { true: string; false: string }): Question => ({
  type: "noul",
  instructions,
  criteria,
});
const choice = (instructions: Instructions, criteria: Record<string, string | null>): Question => ({
  type: "choice",
  instructions,
  criteria,
});
const score = (instructions: Instructions, criteria: string[]): Question => ({
  type: "score",
  instructions,
  criteria,
});

function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/** Everything Jev sees. Known facts go in; the model only supplies the semantic judgment. */
export function buildState(req: JudgeRequest) {
  return {
    today: `${req.context.today} (${weekday(req.context.today)})`,
    current_sprint_ends: req.context.sprintEnd,
    launch_date: req.context.launch,
    attendees: req.context.attendees,
    speaker: req.speaker,
    previous_3_utterances: req.previous,
    recent_decisions: req.recentDecisions,
    utterance: req.utterance,
  };
}

/** One request, all independent questions about the utterance (speculative fan-out). */
export function buildQuestions(req: JudgeRequest): Record<keyof JudgeAnswers, Question> {
  const others = req.context.attendees.filter((a) => a.name !== req.speaker);
  const assigneeCriteria: Record<string, string | null> = {
    speaker_themself: `The speaker (${req.speaker}) commits to doing the task personally: "I'll take that", "I can do it", "let me handle it".`,
  };
  for (const a of others) {
    assigneeCriteria[a.name] = `${a.name} (${a.role}) is asked to do it or accepts it, or the speaker says ${a.name.split(" ")[0]} will do it.`;
  }
  assigneeCriteria.unassigned =
    'A task is raised but nobody specific owns it yet ("someone should...", "we need to..."), or the utterance is not a task at all.';

  return {
    kind: choice(
      {
        task: "Classify `utterance` (said by `speaker` in a product standup) by what a human note-taker would record from it. Use `previous_3_utterances` only for context; judge the utterance itself.",
        tie_breaks: [
          "If it both warns about a problem and assigns or accepts follow-up work, it is an action_item.",
          "Accepting or confirming work that was just assigned to the speaker ('yep, by tomorrow', 'understood, X before Y') is an action_item.",
          "A proposal or option that the group has not yet agreed to is a status_update, not a decision.",
          "Bare agreement or acknowledgement ('agreed', 'deal', 'sounds good', 'fine') is chit_chat.",
          "Handing the floor to someone, asking permission to raise a topic, or announcing the next agenda item is chit_chat.",
          "A recap that merely restates work already assigned earlier in the meeting is a status_update.",
        ],
      },
      {
        action_item:
          "Commits a specific person (the speaker or an attendee) to a concrete piece of follow-up work after the meeting: \"I'll send the doc\", \"can you check the logs by Friday?\", \"Marcus, take the migration\", \"someone needs to file a ticket\", or the speaker offering to do something (\"I can add it\").",
        decision:
          "The group or the lead settles what to do or how: \"let's go with X\", \"we're not shipping Y this sprint\", \"agreed, ship Friday\", \"scrap that, keep the old flow\". A conclusion the team will act on, not a task for one person and not a mere proposal.",
        open_question:
          "Raises an unresolved question about the work or asks for information the utterance itself does not answer: \"do we know if legal signed off?\", \"has anyone checked the iOS numbers?\", \"threshold, one percent or two?\"",
        risk:
          "Warns about a specific thing that could go wrong, slip, break, or block the work: a bug, flaky tests, a dependency on another team, an at-risk deadline, a compliance gap, a blocker.",
        status_update:
          "Reports facts, progress, or a proposal without a new commitment or decision: \"the migration ran fine\", \"I'm halfway through the review\", \"my proposal was five percent\", \"the plan says October first\".",
        chit_chat:
          "Greetings, jokes, small talk, acknowledgements (\"sounds good\", \"cool\", \"agreed\", \"deal\"), reactions, or logistics of the call itself (\"Dev, you're up\", \"can I raise something?\").",
      },
    ),
    assignee: choice(
      "If `utterance` assigns, requests, or takes on a task, who is responsible for doing it? If it is not a task, answer unassigned.",
      assigneeCriteria,
    ),
    has_deadline: noul(
      "Does `utterance` state a due date or time frame for the follow-up work being committed to (e.g. \"by Friday\", \"end of next sprint\", \"before launch\", \"tomorrow\", \"by EOD\", \"right after this\")?",
      {
        true: "A due date, day, or time frame by which the assigned work must be done is stated.",
        false: "No due date for the work: no time reference at all, or the date mentioned is about something else (the launch schedule, an email date, a past event, the meeting itself), or the utterance is not a task.",
      },
    ),
    deadline_kind: choice(
      "What kind of due date does `utterance` set for the follow-up work being committed to? Answer none if no deadline is set for the work (dates that are merely discussed as content do not count).",
      {
        specific_date:
          "A named day or date: \"Friday\", \"tomorrow\", \"tonight\", \"Monday morning\", \"the 24th\", \"October 1st\", \"today\", \"right after this\", \"EOD\".",
        this_week: "\"this week\", \"end of week\", \"EOW\", \"in the next couple of days\".",
        next_sprint: "\"next sprint\", \"end of next sprint\", \"by sprint end\", \"before sprint planning\".",
        before_launch: "\"before launch\", \"before we ship\", \"pre-launch\", \"before go-live\".",
        end_of_quarter: "\"end of quarter\", \"EOQ\", \"by end of Q3\", \"before the quarter closes\".",
        none: "No deadline mentioned.",
      },
    ),
    reverses_earlier_decision: noul(
      "Does `utterance` itself decide to reverse, cancel, or replace a decision or plan that was agreed earlier (see `recent_decisions` and `previous_3_utterances`)?",
      {
        true: "The speaker decides to undo or change something previously agreed: \"actually, scrap that\", \"let's not do X after all\", \"forget Friday, we'll ship Monday\", \"let's move it to Tuesday\".",
        false: "It does not change an earlier decision: it confirms the plan, merely proposes or asks about a change, sets a new plan where none existed, or is unrelated.",
      },
    ),
    is_blocked: noul(
      "Does the speaker report that work is blocked right now: stuck and unable to proceed until another team, a vendor, an approval, or a dependency delivers?",
      {
        true: "Explicitly stuck now: \"the ticket with infra isn't moving\", \"blocked on the vendor\", \"the staging API rate-limits us so we can't run it\", \"they need a ticket from the account owner before they'll do it\".",
        false: "Not a current blocker: a deadline or ordering (\"before we go to 25%\", \"once the data is in\"), a hypothetical risk, a request for someone to do something, a question, or work that is simply in progress.",
      },
    ),
    importance: score("How important is `utterance` for the team to remember after the meeting?", [
      "Trivial: small talk, a joke, or a detail nobody needs to remember.",
      "Minor: useful context but low stakes; nothing changes if it is forgotten.",
      "Notable: affects the team's plan, a deliverable, or an owner's work this sprint.",
      "Critical: affects the launch date, customers, revenue, compliance, or a hard deadline.",
    ]),
  };
}

export class JevError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface JevResult {
  answers: JudgeAnswers;
  usage?: { input_tokens: number; output_tokens: number };
  apiMs: number;
  attempts: number;
}

/** Per-attempt cap; a stalled connection is retried rather than holding a slot in the concurrency limiter. */
export const ATTEMPT_TIMEOUT_MS = 6000;

/** Calls Jev with exponential backoff on 429/529/timeouts. apiMs is the last (successful) attempt only. */
export async function judgeUtterance(req: JudgeRequest, apiKey: string, maxAttempts = 5): Promise<JevResult> {
  const body = JSON.stringify({ state: buildState(req), model: MODEL, questions: buildQuestions(req) });
  let attempt = 0;
  for (;;) {
    attempt++;
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt < maxAttempts) {
        await sleep(Math.min(4000, 200 * 2 ** (attempt - 1)) + Math.random() * 100);
        continue;
      }
      throw new JevError(0, e instanceof Error ? e.message : String(e));
    }
    const apiMs = performance.now() - t0;
    if (res.ok) {
      const json = (await res.json()) as { answers: JudgeAnswers; usage?: JevResult["usage"] };
      return { answers: json.answers, usage: json.usage, apiMs, attempts: attempt };
    }
    const text = await res.text();
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < maxAttempts) {
      await sleep(Math.min(4000, 200 * 2 ** (attempt - 1)) + Math.random() * 100);
      continue;
    }
    throw new JevError(res.status, text.slice(0, 300) || res.statusText);
  }
}
