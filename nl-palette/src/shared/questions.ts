import { COMMANDS, EXPORT_FORMATS, FONT_DELTAS, HEADING_LEVELS, THEMES, type Command } from "./commands.ts";

/** The slice of editor state that is sent to Jev with every keystroke pause. */
export interface AppState {
  sidebar_visible: boolean;
  outline_visible: boolean;
  preview_visible: boolean;
  zen_mode: boolean;
  theme: string;
  font_size: number;
  zoom_percent: number;
  selection_exists: boolean;
  open_tabs: number;
  word_wrap: boolean;
  line_numbers: boolean;
  spell_check: boolean;
  autosave: boolean;
}

export interface ResolveRequestBody {
  query: string;
  app_state: AppState;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string | Record<string, unknown>;
  criteria?: { true?: string; false?: string };
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string | Record<string, unknown>;
  criteria: Record<string, string | null>;
}
export type Question = NoulQuestion | ChoiceQuestion;

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
export type Answer = NoulAnswer | ChoiceAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export const QUESTION_IDS = {
  command: "command",
  fontDelta: "font_size_delta",
  theme: "theme",
  headingLevel: "heading_level",
  exportFormat: "export_format",
  isDestructive: "is_destructive",
} as const;

function choice(instructions: string | Record<string, unknown>, criteria: Record<string, string | null>): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}
function noul(instructions: string, criteria?: { true?: string; false?: string }): NoulQuestion {
  return { type: "noul", instructions, criteria };
}

function commandCriteria(commands: readonly Command[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const c of commands) criteria[c.id] = `${c.title}: ${c.description}`;
  return criteria;
}

/**
 * One request carries the routing question plus every argument slot, asked
 * speculatively. Code reads only the slot that belongs to the chosen command.
 */
export function buildQuestions(commands: readonly Command[] = COMMANDS): Record<string, Question> {
  return {
    [QUESTION_IDS.command]: choice(
      {
        task: "The user typed `query` into the command palette of a Markdown notes editor. Which editor command do they want to run?",
        notes: [
          "Match on meaning, not on exact words; users describe the effect they want.",
          "`app_state` describes the editor right now. A request to hide something that is visible, or show something that is hidden, means the toggle for that thing.",
          "Requests about text size mean the editor font size; requests about the whole window or interface being bigger/smaller mean zoom.",
        ],
      },
      commandCriteria(commands),
    ),
    [QUESTION_IDS.fontDelta]: choice(
      "If the user is asking to change the text or font size, by how many points and in which direction? Small nudges are 2 points; 'a lot', 'much', or 'way' bigger/smaller is 4 points. Making text bigger, larger, louder or more readable is positive; smaller, tinier or more compact is negative.",
      {
        [FONT_DELTAS[0]]: "Much smaller text: shrink the font by 4 points",
        [FONT_DELTAS[1]]: "Slightly smaller text: shrink the font by 2 points",
        [FONT_DELTAS[2]]: "Slightly bigger text: grow the font by 2 points",
        [FONT_DELTAS[3]]: "Much bigger text: grow the font by 4 points",
      },
    ),
    [QUESTION_IDS.theme]: choice(
      "If the user is asking to change the color theme, which theme do they want? Night, black or dim means dark; day, bright or white means light; warm, paper or vintage means sepia; accessibility or maximum readability means high contrast. If they just want a different look than the current `app_state.theme`, pick the most common alternative (dark when currently light, light otherwise).",
      {
        [THEMES[0]]: "Dark theme: dark background, light text (night mode)",
        [THEMES[1]]: "Light theme: white background, dark text (day mode)",
        [THEMES[2]]: "Sepia theme: warm cream paper-like background",
        [THEMES[3]]: "High contrast theme: black and yellow for maximum legibility",
      },
    ),
    [QUESTION_IDS.headingLevel]: choice(
      "If the user is asking to make a heading, which level? Title, top, biggest or main heading is 1; section or subheading is 2; subsection is 3. Words like 'h4', 'level 5', 'smallest heading' name the level directly.",
      Object.fromEntries(HEADING_LEVELS.map((l) => [l, `Heading level ${l} (H${l}${l === "1" ? ", the largest title" : l === "6" ? ", the smallest heading" : ""})`])),
    ),
    [QUESTION_IDS.exportFormat]: choice(
      "If the user is asking to export or download the note, which file format do they want? A printable or shareable document is PDF; a web page is HTML; raw text without markup is plain text; keeping the .md source is Markdown.",
      {
        [EXPORT_FORMATS[0]]: "Markdown (.md) source file",
        [EXPORT_FORMATS[1]]: "HTML web page",
        [EXPORT_FORMATS[2]]: "PDF document for printing or sharing",
        [EXPORT_FORMATS[3]]: "Plain text (.txt) with all markup stripped",
      },
    ),
    [QUESTION_IDS.isDestructive]: noul(
      "Does the user's `query` ask for something that would permanently discard content or close work (deleting a note, deleting lines, closing tabs)?",
      {
        true: "The request removes, deletes, discards or closes something for good",
        false: "The request only shows, changes, formats, navigates or can be trivially undone",
      },
    ),
  };
}
