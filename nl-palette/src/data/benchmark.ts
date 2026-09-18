export interface BenchmarkCase {
  query: string;
  expected: string;
  /** Expected argument for commands with a slot. */
  expectedArg?: string;
}

/**
 * 30 phrasings a real user might type. 24 describe the *effect* they want
 * ("make this louder"); 6 are the partial command names a fuzzy palette is
 * built for ("zoom out", "wrd wrap"), so the fuzzy baseline gets a fair shot.
 */
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  { query: "make this louder", expected: "change_font_size", expectedArg: "+2" },
  { query: "get rid of the sidebar", expected: "toggle_sidebar" },
  { query: "hide the left thing", expected: "toggle_sidebar" },
  { query: "text is way too small", expected: "change_font_size", expectedArg: "+4" },
  { query: "switch to night mode", expected: "set_theme", expectedArg: "dark" },
  { query: "i want it to look like paper", expected: "set_theme", expectedArg: "sepia" },
  { query: "make this line the title", expected: "set_heading", expectedArg: "1" },
  { query: "turn this into a subheading", expected: "set_heading", expectedArg: "2" },
  { query: "send this as a pdf", expected: "export_note", expectedArg: "pdf" },
  { query: "give me a web page version", expected: "export_note", expectedArg: "html" },
  { query: "everything is too big on screen", expected: "zoom_out" },
  { query: "focus, no distractions", expected: "toggle_zen_mode" },
  { query: "show me what it renders like", expected: "toggle_preview" },
  { query: "search and swap words", expected: "find_replace" },
  { query: "make it shout", expected: "uppercase_selection" },
  { query: "alphabetize these", expected: "sort_lines" },
  { query: "checkboxes please", expected: "toggle_task_list" },
  { query: "stamp today's date", expected: "insert_date" },
  { query: "trash this note", expected: "delete_note" },
  { query: "get rid of every other tab", expected: "close_other_tabs" },
  { query: "stop the red squiggles", expected: "toggle_spell_check" },
  { query: "lines are running off the edge", expected: "toggle_word_wrap" },
  { query: "make this a quote", expected: "toggle_blockquote" },
  { query: "keep this note at the top", expected: "toggle_pin_note" },
  { query: "zoom out", expected: "zoom_out" },
  { query: "wrd wrap", expected: "toggle_word_wrap" },
  { query: "insert table", expected: "insert_table" },
  { query: "split", expected: "split_editor" },
  { query: "tog sidebar", expected: "toggle_sidebar" },
  { query: "reopen tab", expected: "reopen_closed_tab" },
];
