import { describe, expect, it } from "vitest";
import { compareWithBaseline, runRegexBaseline } from "../src/baseline.ts";
import { addedLines, allHunks, parseUnifiedDiff } from "../src/diff.ts";
import { createFixtureRepo, FIXTURE_COMMIT_MESSAGE, FIXTURE_FILES } from "../src/fixture.ts";
import { defaultCommitMessage, stagedDiff } from "../src/git.ts";
import { buildHunkQuestions, buildHunkState, buildMessageState, hunkQuestionCount } from "../src/jev.ts";

describe("fixture repo", () => {
  const fx = createFixtureRepo();
  const diff = stagedDiff(fx.dir);
  const files = parseUnifiedDiff(diff);
  const hunks = allHunks(files);

  it("stages ~8-11 files with 12-15 hunks", () => {
    expect(files.length).toBe(FIXTURE_FILES.length);
    expect(hunks.length).toBeGreaterThanOrEqual(12);
    expect(hunks.length).toBeLessThanOrEqual(15);
    expect(files.find((f) => f.file.endsWith(".sql"))?.isNewFile).toBe(true);
  });

  it("leaves the demo commit message in COMMIT_EDITMSG", () => {
    expect(defaultCommitMessage(fx.dir)).toBe(FIXTURE_COMMIT_MESSAGE);
  });

  it("covers every finding category with at least one hunk the regex baseline can see", () => {
    const base = runRegexBaseline(hunks);
    const ids = new Set(base.hits.map((h) => h.id));
    expect([...ids].sort()).toEqual(
      [
        "destructive_data_change",
        "disables_or_skips_tests",
        "hardcoded_env_specific_value",
        "leaks_secret_or_token",
        "leftover_debug_or_temp",
        "logs_sensitive_data",
      ].sort(),
    );
    const cmp = compareWithBaseline([{ hunkId: hunks[0]!.id, id: "changes_public_api_shape" }, ...base.hits], base);
    expect(cmp.caught).toBe(base.hits.length);
    expect(cmp.missed).toHaveLength(1);
  });

  it("builds one request per hunk with all questions fanned out", () => {
    for (const h of hunks) {
      const state = buildHunkState(h);
      const qs = buildHunkQuestions(state);
      expect(Object.keys(qs)).toEqual(expect.arrayContaining(["risk", "kind", "leaks_secret_or_token", "destructive_data_change"]));
      expect(hunkQuestionCount(h)).toBe(addedLines(h).length > 0 ? 10 : 9);
      expect(state.hunk.split("\n").every((l) => /^[ +-]/.test(l))).toBe(true);
    }
    const ms = buildMessageState(FIXTURE_COMMIT_MESSAGE, hunks, []);
    expect(ms.changes).toHaveLength(hunks.length);
    expect(ms.changes[0]?.added.length).toBeGreaterThan(0);
  });

  it("cleans up", () => {
    fx.cleanup();
  });
});
