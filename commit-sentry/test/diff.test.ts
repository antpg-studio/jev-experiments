import { describe, expect, it } from "vitest";
import { addedLines, allHunks, hunkFingerprint, languageFor, parseUnifiedDiff } from "../src/diff.ts";

const SAMPLE = `diff --git a/src/config.ts b/src/config.ts
index 1111111..2222222 100644
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,5 +1,5 @@
 export const config = {
-  apiUrl: process.env.API_URL,
+  apiUrl: "http://10.0.3.12:8080",
   retries: 3,
 
   timeoutMs: 5000,
@@ -20,4 +20,5 @@ export function load() {
   return config;
 }
+// TODO remove before merge
 
 export default config;
diff --git a/migrations/0007.sql b/migrations/0007.sql
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/migrations/0007.sql
@@ -0,0 +1,2 @@
+ALTER TABLE users DROP COLUMN legacy_email;
+-- irreversible
\\ No newline at end of file
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`;

describe("parseUnifiedDiff", () => {
  const files = parseUnifiedDiff(SAMPLE);

  it("splits files and hunks", () => {
    expect(files.map((f) => f.file)).toEqual(["src/config.ts", "migrations/0007.sql", "old.txt", "logo.png"]);
    expect(files[0]!.hunks).toHaveLength(2);
    expect(files[1]!.hunks).toHaveLength(1);
    expect(files[2]!.hunks).toHaveLength(1);
    expect(files[3]!.hunks).toHaveLength(0);
    expect(files[3]!.isBinary).toBe(true);
    expect(allHunks(files)).toHaveLength(4);
  });

  it("parses hunk ranges and header context", () => {
    const [h1, h2] = files[0]!.hunks;
    expect(h1).toMatchObject({ oldStart: 1, oldCount: 5, newStart: 1, newCount: 5, header: "" });
    expect(h2).toMatchObject({ oldStart: 20, oldCount: 4, newStart: 20, newCount: 5, header: "export function load() {" });
    expect(h1!.id).toBe("src/config.ts#0");
    expect(h2!.id).toBe("src/config.ts#1");
  });

  it("tracks new-file line numbers for added lines", () => {
    const h1 = files[0]!.hunks[0]!;
    const adds = addedLines(h1);
    expect(adds).toHaveLength(1);
    expect(adds[0]!.text).toBe('  apiUrl: "http://10.0.3.12:8080",');
    expect(adds[0]!.newLine).toBe(2);
    const dels = h1.lines.filter((l) => l.kind === "del");
    expect(dels[0]!.oldLine).toBe(2);

    const h2 = files[0]!.hunks[1]!;
    expect(addedLines(h2)[0]!.newLine).toBe(22);
  });

  it("treats a bare empty line inside a hunk as blank context", () => {
    const h1 = files[0]!.hunks[0]!;
    expect(h1.lines).toHaveLength(6);
    expect(h1.lines[4]).toMatchObject({ kind: "context", text: "", newLine: 4, oldLine: 4 });
  });

  it("flags new and deleted files and ignores the no-newline marker", () => {
    expect(files[1]!.isNewFile).toBe(true);
    expect(files[1]!.hunks[0]!.isNewFile).toBe(true);
    expect(files[1]!.hunks[0]!.lines.map((l) => l.text)).toEqual([
      "ALTER TABLE users DROP COLUMN legacy_email;",
      "-- irreversible",
    ]);
    expect(files[2]!.isDeletedFile).toBe(true);
    expect(files[2]!.hunks[0]!.lines[0]).toMatchObject({ kind: "del", text: "gone", oldLine: 1 });
  });

  it("re-serialises hunk text with prefixes", () => {
    expect(files[0]!.hunks[1]!.text).toBe(
      ["   return config;", " }", "+// TODO remove before merge", " ", " export default config;"].join("\n"),
    );
  });

  it("returns an empty list for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("\n")).toEqual([]);
  });

  it("fingerprints are stable and content-sensitive", () => {
    const h = files[0]!.hunks[0]!;
    expect(hunkFingerprint(h)).toBe(hunkFingerprint(parseUnifiedDiff(SAMPLE)[0]!.hunks[0]!));
    expect(hunkFingerprint(h)).not.toBe(hunkFingerprint(files[0]!.hunks[1]!));
    expect(hunkFingerprint(h)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("languageFor", () => {
  it("maps extensions and special names", () => {
    expect(languageFor("src/a.ts")).toBe("TypeScript");
    expect(languageFor("db/0001.sql")).toBe("SQL");
    expect(languageFor("Dockerfile")).toBe("Dockerfile");
    expect(languageFor(".env.production")).toBe("dotenv");
    expect(languageFor("Makefile")).toBe("text");
    expect(languageFor("x.weird")).toBe("WEIRD");
  });
});
