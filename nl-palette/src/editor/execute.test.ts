import { describe, expect, it } from "vitest";
import { COMMANDS } from "../shared/commands.ts";
import { execute, initialState, setText } from "./execute.ts";
import { activeNote, toAppState, type EditorState } from "./model.ts";

function withSelection(text: string, start: number, end: number): EditorState {
  const s = initialState();
  return { ...setText(s, text, { start, end }), undo: [] };
}

describe("execute", () => {
  it("handles every command in the catalog without throwing", () => {
    for (const c of COMMANDS) {
      const s = withSelection("# Title\n\nhello world\nsecond line\n", 9, 20);
      const out = execute(s, c.id, c.arg ? "+2" : undefined);
      expect(out.toast ?? "").not.toMatch(/not implemented|Unknown/);
    }
  });

  it("toggles view state and reports it in app_state", () => {
    let s = initialState();
    expect(toAppState(s).sidebar_visible).toBe(true);
    s = execute(s, "toggle_sidebar");
    expect(toAppState(s).sidebar_visible).toBe(false);
    s = execute(s, "set_theme", "sepia");
    expect(toAppState(s).theme).toBe("sepia");
    s = execute(s, "change_font_size", "+4");
    expect(toAppState(s).font_size).toBe(19);
    s = execute(s, "change_font_size", "-2");
    expect(s.fontSize).toBe(17);
  });

  it("clamps zoom and font size", () => {
    let s = initialState();
    for (let i = 0; i < 30; i++) s = execute(s, "zoom_in");
    expect(s.zoom).toBe(200);
    for (let i = 0; i < 30; i++) s = execute(s, "change_font_size", "+4");
    expect(s.fontSize).toBe(32);
  });

  it("wraps the selection in bold and undoes it", () => {
    let s = withSelection("hello world", 0, 5);
    s = execute(s, "toggle_bold");
    expect(activeNote(s).text).toBe("**hello** world");
    s = execute(s, "undo");
    expect(activeNote(s).text).toBe("hello world");
    s = execute(s, "redo");
    expect(activeNote(s).text).toBe("**hello** world");
  });

  it("sets a heading on the current line", () => {
    let s = withSelection("Intro\nbody", 2, 2);
    s = execute(s, "set_heading", "2");
    expect(activeNote(s).text).toBe("## Intro\nbody");
    s = execute(s, "set_heading", "1");
    expect(activeNote(s).text).toBe("# Intro\nbody");
  });

  it("sorts and dedupes selected lines", () => {
    let s = withSelection("b\na\nb\nc", 0, 7);
    s = execute(s, "sort_lines");
    expect(activeNote(s).text).toBe("a\nb\nb\nc");
    s = execute(s, "remove_duplicate_lines");
    expect(activeNote(s).text).toBe("a\nb\nc");
  });

  it("changes case only with a selection", () => {
    const s = withSelection("hello world", 0, 0);
    expect(execute(s, "uppercase_selection").toast).toMatch(/Select/);
    expect(activeNote(execute(withSelection("hello world", 0, 5), "uppercase_selection")).text).toBe("HELLO world");
    expect(activeNote(execute(withSelection("hello world", 0, 11), "title_case_selection")).text).toBe("Hello World");
  });

  it("manages tabs", () => {
    let s = initialState();
    const first = s.activeTab;
    s = execute(s, "next_tab");
    expect(s.activeTab).not.toBe(first);
    s = execute(s, "close_tab");
    expect(s.tabs).toHaveLength(2);
    s = execute(s, "reopen_closed_tab");
    expect(s.tabs).toHaveLength(3);
    s = execute(s, "close_other_tabs");
    expect(s.tabs).toHaveLength(1);
  });

  it("exports through an effect and keeps the export format", () => {
    const s = execute(initialState(), "export_note", "html");
    expect(s.effect).toMatchObject({ kind: "download", format: "html" });
  });

  it("refuses to delete the last note", () => {
    let s = initialState();
    s = execute(s, "delete_note");
    s = execute(s, "delete_note");
    expect(s.notes).toHaveLength(1);
    expect(execute(s, "delete_note").toast).toMatch(/last note/);
  });
});
