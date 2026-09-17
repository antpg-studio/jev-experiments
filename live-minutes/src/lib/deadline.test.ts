import { describe, expect, it } from "vitest";
import { parseSpecificDate, resolveDeadline, formatDate } from "./deadline.ts";
import { MEETING } from "../data/transcript.ts";

const today = MEETING.today; // Thursday 2026-09-17

describe("parseSpecificDate", () => {
  it("resolves relative days", () => {
    expect(parseSpecificDate("I'll have it by tomorrow", today)).toBe("2026-09-18");
    expect(parseSpecificDate("right after this", today)).toBe("2026-09-17");
    expect(parseSpecificDate("by EOD please", today)).toBe("2026-09-17");
  });
  it("resolves weekday names to the next occurrence", () => {
    expect(parseSpecificDate("specs in Figma by Monday", today)).toBe("2026-09-21");
    expect(parseSpecificDate("Friday at the latest", today)).toBe("2026-09-18");
    expect(parseSpecificDate("Thursday", today)).toBe("2026-09-17");
  });
  it("resolves month + day and spelled ordinals", () => {
    expect(parseSpecificDate("launch is October 1st", today)).toBe("2026-10-01");
    expect(parseSpecificDate("move it to Tuesday the twenty-ninth", today)).toBe("2026-09-29");
    expect(parseSpecificDate("by the 24th", today)).toBe("2026-09-24");
  });
  it("rolls past days in the month forward", () => {
    expect(parseSpecificDate("the 3rd", today)).toBe("2026-10-03");
    expect(parseSpecificDate("by january 5", today)).toBe("2027-01-05");
  });
  it("returns null when nothing parses", () => {
    expect(parseSpecificDate("sometime soon", today)).toBeNull();
  });
});

describe("resolveDeadline", () => {
  it("maps kinds to dates in code", () => {
    expect(resolveDeadline("this_week", "", MEETING).date).toBe("2026-09-18");
    expect(resolveDeadline("next_sprint", "", MEETING).date).toBe("2026-10-09");
    expect(resolveDeadline("before_launch", "", MEETING).date).toBe("2026-10-01");
    expect(resolveDeadline("end_of_quarter", "", MEETING).date).toBe("2026-09-30");
    expect(resolveDeadline("none", "", MEETING)).toEqual({ kind: "none", date: null, label: "" });
  });
  it("flags an unparseable specific date instead of guessing", () => {
    const d = resolveDeadline("specific_date", "when the stars align", MEETING);
    expect(d.date).toBeNull();
    expect(d.label).toBe("date?");
  });
  it("labels this_week with a weekday rather than 'tomorrow'", () => {
    expect(resolveDeadline("this_week", "", MEETING).label).toBe("this week · Fri Sep 18");
  });
});

describe("formatDate", () => {
  it("uses relative words only within a day", () => {
    expect(formatDate("2026-09-17", today)).toBe("today");
    expect(formatDate("2026-09-18", today)).toBe("tomorrow");
    expect(formatDate("2026-09-21", today)).toBe("Mon Sep 21");
    expect(formatDate("2026-10-09", today)).toBe("Oct 9");
  });
});
