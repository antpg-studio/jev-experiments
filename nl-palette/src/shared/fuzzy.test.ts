import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { fuzzyMatch, fuzzyRank } from "./fuzzy.ts";

describe("fuzzyMatch", () => {
  it("returns null when characters are missing", () => {
    expect(fuzzyMatch("xyz", "Toggle Sidebar")).toBeNull();
  });
  it("scores consecutive matches higher than scattered ones", () => {
    const tight = fuzzyMatch("side", "Toggle Sidebar")!;
    const loose = fuzzyMatch("sdbr", "Toggle Sidebar")!;
    expect(tight.score).toBeGreaterThan(loose.score);
  });
  it("prefers word-boundary starts", () => {
    const boundary = fuzzyMatch("z", "Reset Zoom")!;
    const inner = fuzzyMatch("m", "Reset Zoom")!;
    expect(boundary.score).toBeGreaterThan(inner.score);
  });
  it("is case-insensitive", () => {
    expect(fuzzyMatch("TOG", "toggle sidebar")).not.toBeNull();
  });
});

describe("fuzzyRank", () => {
  it("finds partial command names", () => {
    expect(fuzzyRank("zoom out", COMMANDS)[0].command.id).toBe("zoom_out");
    expect(fuzzyRank("wrd wrap", COMMANDS)[0].command.id).toBe("toggle_word_wrap");
    expect(fuzzyRank("tog sidebar", COMMANDS)[0].command.id).toBe("toggle_sidebar");
  });
  it("requires every term to match", () => {
    expect(fuzzyRank("zoom banana", COMMANDS)).toHaveLength(0);
  });
  it("cannot map intent to commands", () => {
    const top = fuzzyRank("make this louder", COMMANDS)[0];
    expect(top?.command.id).not.toBe("change_font_size");
  });
  it("returns nothing for an empty query", () => {
    expect(fuzzyRank("   ", COMMANDS)).toHaveLength(0);
  });
});
