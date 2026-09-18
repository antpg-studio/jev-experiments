export type ArgSlot = "font_size_delta" | "theme" | "heading_level" | "export_format";

export const FONT_DELTAS = ["-4", "-2", "+2", "+4"] as const;
export const THEMES = ["dark", "light", "sepia", "high_contrast"] as const;
export const HEADING_LEVELS = ["1", "2", "3", "4", "5", "6"] as const;
export const EXPORT_FORMATS = ["markdown", "html", "pdf", "plain_text"] as const;

export type FontDelta = (typeof FONT_DELTAS)[number];
export type Theme = (typeof THEMES)[number];
export type HeadingLevel = (typeof HEADING_LEVELS)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ArgValue = FontDelta | Theme | HeadingLevel | ExportFormat;

export type CommandGroup =
  | "View"
  | "Appearance"
  | "Text"
  | "Format"
  | "Navigation"
  | "File"
  | "Edit"
  | "Find"
  | "Tabs"
  | "Tools";

export interface Command {
  id: string;
  title: string;
  /** Plain-language description used as the Choice criterion for Jev. */
  description: string;
  group: CommandGroup;
  shortcut?: string;
  arg?: ArgSlot;
  /** Discards data or is hard to undo; asks for confirmation when Jev is not sure. */
  destructive?: boolean;
}

export const COMMANDS: readonly Command[] = [
  // View
  { id: "toggle_sidebar", title: "Toggle Sidebar", group: "View", shortcut: "Ctrl+B", description: "Show or hide the left-hand file explorer panel (the sidebar with the note list)." },
  { id: "toggle_outline", title: "Toggle Outline Panel", group: "View", description: "Show or hide the document outline of headings on the right." },
  { id: "toggle_status_bar", title: "Toggle Status Bar", group: "View", description: "Show or hide the thin status bar along the bottom with word count and cursor position." },
  { id: "toggle_minimap", title: "Toggle Minimap", group: "View", description: "Show or hide the miniature overview of the document next to the scrollbar." },
  { id: "toggle_line_numbers", title: "Toggle Line Numbers", group: "View", description: "Show or hide line numbers in the gutter." },
  { id: "toggle_word_wrap", title: "Toggle Word Wrap", group: "View", description: "Turn soft wrapping of long lines on or off." },
  { id: "toggle_preview", title: "Toggle Markdown Preview", group: "View", description: "Show or hide the rendered Markdown preview pane inside the editor, next to the source." },
  { id: "toggle_zen_mode", title: "Toggle Zen Mode", group: "View", description: "Distraction-free writing: hide every panel and chrome except the text, or leave that mode." },
  { id: "toggle_fullscreen", title: "Toggle Full Screen", group: "View", shortcut: "F11", description: "Enter or leave full-screen mode for the whole window." },
  { id: "zoom_in", title: "Zoom In", group: "View", shortcut: "Ctrl+=", description: "Magnify the whole interface (UI zoom), making everything larger." },
  { id: "zoom_out", title: "Zoom Out", group: "View", shortcut: "Ctrl+-", description: "Shrink the whole interface (UI zoom), making everything smaller." },
  { id: "reset_zoom", title: "Reset Zoom", group: "View", description: "Return the interface zoom to 100%." },
  { id: "split_editor", title: "Split Editor", group: "View", description: "Open a second editor pane side by side with the current one." },
  { id: "close_split", title: "Close Split", group: "View", description: "Close the second pane and return to a single editor." },

  // Appearance
  { id: "set_theme", title: "Change Color Theme", group: "Appearance", arg: "theme", description: "Switch the color theme (dark, light, sepia or high contrast) — how the app looks, its colors." },
  { id: "change_font_size", title: "Change Font Size", group: "Appearance", arg: "font_size_delta", description: "Make the editor text bigger or smaller by changing the font size by a number of points." },
  { id: "reset_font_size", title: "Reset Font Size", group: "Appearance", description: "Return the editor font size to its default." },
  { id: "toggle_ligatures", title: "Toggle Font Ligatures", group: "Appearance", description: "Turn programming font ligatures on or off." },
  { id: "cycle_font_family", title: "Cycle Font Family", group: "Appearance", description: "Switch to the next typeface (monospace, serif, sans-serif)." },
  { id: "toggle_typewriter_mode", title: "Toggle Typewriter Scrolling", group: "Appearance", description: "Keep the current line vertically centered while typing, or stop doing so." },

  // Format
  { id: "set_heading", title: "Set Heading Level", group: "Format", arg: "heading_level", description: "Turn the current line into a heading of a given level (H1 to H6)." },
  { id: "toggle_bold", title: "Toggle Bold", group: "Format", shortcut: "Ctrl+B", description: "Make the selected text bold, or remove bold." },
  { id: "toggle_italic", title: "Toggle Italic", group: "Format", shortcut: "Ctrl+I", description: "Make the selected text italic, or remove italics." },
  { id: "toggle_strikethrough", title: "Toggle Strikethrough", group: "Format", description: "Strike through the selected text, or remove strikethrough." },
  { id: "toggle_inline_code", title: "Toggle Inline Code", group: "Format", description: "Wrap the selection in backticks as inline code, or unwrap it." },
  { id: "insert_code_block", title: "Insert Code Block", group: "Format", description: "Insert a fenced code block (triple backticks) at the cursor." },
  { id: "toggle_bullet_list", title: "Toggle Bullet List", group: "Format", description: "Turn the current lines into a bulleted (unordered) list, or back into plain text." },
  { id: "toggle_numbered_list", title: "Toggle Numbered List", group: "Format", description: "Turn the current lines into a numbered (ordered) list, or back into plain text." },
  { id: "toggle_task_list", title: "Toggle Task List", group: "Format", description: "Turn the current lines into checkbox to-do items, or back into plain text." },
  { id: "toggle_blockquote", title: "Toggle Blockquote", group: "Format", description: "Turn the current lines into a quoted block (prefixed with >), or remove the quote." },
  { id: "insert_link", title: "Insert Link", group: "Format", shortcut: "Ctrl+K", description: "Insert a Markdown hyperlink around the selection." },
  { id: "insert_image", title: "Insert Image", group: "Format", description: "Insert a Markdown image reference at the cursor." },
  { id: "insert_table", title: "Insert Table", group: "Format", description: "Insert an empty Markdown table at the cursor." },
  { id: "insert_horizontal_rule", title: "Insert Horizontal Rule", group: "Format", description: "Insert a horizontal divider line (---) at the cursor." },
  { id: "insert_date", title: "Insert Current Date", group: "Format", description: "Insert today's date at the cursor." },
  { id: "clear_formatting", title: "Clear Formatting", group: "Format", description: "Strip Markdown markup (bold, italic, code, headings) from the selection, leaving plain text." },

  // Text
  { id: "uppercase_selection", title: "Transform to Uppercase", group: "Text", description: "Convert the selected text to ALL CAPS." },
  { id: "lowercase_selection", title: "Transform to Lowercase", group: "Text", description: "Convert the selected text to all lowercase letters." },
  { id: "title_case_selection", title: "Transform to Title Case", group: "Text", description: "Capitalize The First Letter Of Each Word in the selection." },
  { id: "sort_lines", title: "Sort Lines Ascending", group: "Text", description: "Sort the selected lines alphabetically." },
  { id: "remove_duplicate_lines", title: "Remove Duplicate Lines", group: "Text", description: "Delete repeated lines in the selection, keeping one copy of each." },
  { id: "trim_trailing_whitespace", title: "Trim Trailing Whitespace", group: "Text", description: "Remove spaces and tabs from the ends of all lines." },
  { id: "join_lines", title: "Join Lines", group: "Text", description: "Merge the selected lines into a single line." },
  { id: "duplicate_line", title: "Duplicate Line", group: "Text", description: "Copy the current line and insert the copy directly below it." },
  { id: "delete_line", title: "Delete Line", group: "Text", description: "Remove the current line entirely." },
  { id: "move_line_up", title: "Move Line Up", group: "Text", description: "Swap the current line with the line above it." },
  { id: "move_line_down", title: "Move Line Down", group: "Text", description: "Swap the current line with the line below it." },

  // Edit
  { id: "undo", title: "Undo", group: "Edit", shortcut: "Ctrl+Z", description: "Revert the most recent edit." },
  { id: "redo", title: "Redo", group: "Edit", shortcut: "Ctrl+Shift+Z", description: "Re-apply the edit that was just undone." },
  { id: "select_all", title: "Select All", group: "Edit", shortcut: "Ctrl+A", description: "Select the entire document text." },

  // Find
  { id: "find", title: "Find", group: "Find", shortcut: "Ctrl+F", description: "Open the search box to look for text in the current note." },
  { id: "find_replace", title: "Find and Replace", group: "Find", shortcut: "Ctrl+H", description: "Open search with a replacement field to substitute text in the current note." },
  { id: "go_to_line", title: "Go to Line", group: "Navigation", shortcut: "Ctrl+G", description: "Jump the cursor to a specific line number." },
  { id: "toggle_spell_check", title: "Toggle Spell Check", group: "Tools", description: "Turn the spelling checker (red squiggles under misspelled words) on or off." },

  // File
  { id: "new_note", title: "New Note", group: "File", shortcut: "Ctrl+N", description: "Create a fresh, empty note and open it in a new tab." },
  { id: "save_note", title: "Save Note", group: "File", shortcut: "Ctrl+S", description: "Save the current note to disk." },
  { id: "export_note", title: "Export Note", group: "File", arg: "export_format", description: "Export, save-as or download the current note as a file in another format (Markdown, an HTML web page, PDF or plain text) to share or open elsewhere." },
  { id: "rename_note", title: "Rename Note", group: "File", description: "Change the title / file name of the current note." },
  { id: "delete_note", title: "Delete Note", group: "File", destructive: true, description: "Permanently delete the current note from the workspace (destructive)." },
  { id: "toggle_pin_note", title: "Pin / Unpin Note", group: "File", description: "Pin the current note to the top of the sidebar list, or unpin it." },

  // Tabs
  { id: "close_tab", title: "Close Tab", group: "Tabs", shortcut: "Ctrl+W", description: "Close the current editor tab." },
  { id: "close_other_tabs", title: "Close Other Tabs", group: "Tabs", destructive: true, description: "Close every open tab except the current one." },
  { id: "reopen_closed_tab", title: "Reopen Closed Tab", group: "Tabs", shortcut: "Ctrl+Shift+T", description: "Restore the tab that was closed most recently." },
  { id: "next_tab", title: "Next Tab", group: "Tabs", shortcut: "Ctrl+Tab", description: "Switch to the tab to the right of the current one." },
  { id: "previous_tab", title: "Previous Tab", group: "Tabs", shortcut: "Ctrl+Shift+Tab", description: "Switch to the tab to the left of the current one." },
  { id: "toggle_autosave", title: "Toggle Autosave", group: "Tools", description: "Turn automatic saving after each change on or off." },
];

export const COMMAND_BY_ID: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.id, c]));

export function argOptions(slot: ArgSlot): readonly string[] {
  switch (slot) {
    case "font_size_delta":
      return FONT_DELTAS;
    case "theme":
      return THEMES;
    case "heading_level":
      return HEADING_LEVELS;
    case "export_format":
      return EXPORT_FORMATS;
  }
}

export const ARG_SLOTS: readonly ArgSlot[] = ["font_size_delta", "theme", "heading_level", "export_format"];
