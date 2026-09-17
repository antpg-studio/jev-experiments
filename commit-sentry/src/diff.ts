import type { DiffLine, FileDiff, Hunk } from "./types.ts";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript (React)",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript (React)",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  md: "Markdown",
  sql: "SQL",
  py: "Python",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C header",
  cpp: "C++",
  cs: "C#",
  php: "PHP",
  sh: "Shell",
  bash: "Shell",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  env: "dotenv",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  tf: "Terraform",
  dockerfile: "Dockerfile",
  prisma: "Prisma schema",
  graphql: "GraphQL",
};

export function languageFor(file: string): string {
  const base = file.split("/").pop() ?? file;
  if (/^dockerfile$/i.test(base)) return "Dockerfile";
  if (/^\.env(\..+)?$/.test(base)) return "dotenv";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANGUAGE_BY_EXT[ext] ?? (ext ? ext.toUpperCase() : "text");
}

function stripPrefix(path: string): string {
  return path.replace(/^[ab]\//, "");
}

/** Parse a `diff --git` header path pair, handling quoted paths. */
function parseFileHeader(line: string): { oldFile: string; newFile: string } | null {
  const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
  if (!m) return null;
  return { oldFile: m[1]!, newFile: m[2]! };
}

/**
 * Parse the output of `git diff` (unified format, any -U context) into files and hunks.
 * Pure function; no git dependency, so it is unit-testable.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  let current: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  const finishHunk = () => {
    if (hunk && current) {
      hunk.text = hunk.lines.map(serialiseLine).join("\n");
      current.hunks.push(hunk);
    }
    hunk = null;
  };

  for (const raw of lines) {
    if (raw.startsWith("diff --git ")) {
      finishHunk();
      const hdr = parseFileHeader(raw);
      current = {
        file: hdr ? stripPrefix(hdr.newFile) : raw.slice("diff --git ".length),
        oldFile: hdr ? stripPrefix(hdr.oldFile) : "",
        isNewFile: false,
        isDeletedFile: false,
        isBinary: false,
        hunks: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;

    if (hunk === null) {
      if (raw.startsWith("new file mode")) current.isNewFile = true;
      else if (raw.startsWith("deleted file mode")) current.isDeletedFile = true;
      else if (raw.startsWith("Binary files") || raw.startsWith("GIT binary patch")) current.isBinary = true;
      else if (raw.startsWith("--- ")) {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") current.oldFile = stripPrefix(p);
      } else if (raw.startsWith("+++ ")) {
        const p = raw.slice(4).trim();
        if (p !== "/dev/null") current.file = stripPrefix(p);
      }
    }

    const hm = HUNK_HEADER.exec(raw);
    if (hm) {
      finishHunk();
      const oldStart = Number(hm[1]);
      const oldCount = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newCount = hm[4] === undefined ? 1 : Number(hm[4]);
      oldLine = oldStart;
      newLine = newStart;
      oldRemaining = oldCount;
      newRemaining = newCount;
      const index = current.hunks.length;
      hunk = {
        id: `${current.file}#${index}`,
        file: current.file,
        oldFile: current.oldFile || current.file,
        language: languageFor(current.file),
        oldStart,
        oldCount,
        newStart,
        newCount,
        header: hm[5]!.trim(),
        lines: [],
        text: "",
        isNewFile: current.isNewFile,
        isDeletedFile: current.isDeletedFile,
      };
      continue;
    }

    if (!hunk) continue;
    if (raw.startsWith("\\ No newline at end of file")) continue;
    if (oldRemaining <= 0 && newRemaining <= 0) {
      finishHunk();
      continue;
    }

    const marker = raw[0];
    const text = raw.slice(1);
    let line: DiffLine;
    if (marker === "+") {
      line = { kind: "add", text, newLine: newLine++, oldLine: undefined };
      newRemaining--;
    } else if (marker === "-") {
      line = { kind: "del", text, newLine: undefined, oldLine: oldLine++ };
      oldRemaining--;
    } else if (marker === " " || raw === "") {
      // An empty raw line inside a hunk is a blank context line whose leading space was stripped.
      line = { kind: "context", text, newLine: newLine++, oldLine: oldLine++ };
      oldRemaining--;
      newRemaining--;
    } else {
      finishHunk();
      continue;
    }
    hunk.lines.push(line);
  }
  finishHunk();
  return files;
}

export function serialiseLine(l: DiffLine): string {
  const p = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
  return p + l.text;
}

export function allHunks(files: FileDiff[]): Hunk[] {
  return files.flatMap((f) => f.hunks);
}

export function addedLines(h: Hunk): DiffLine[] {
  return h.lines.filter((l) => l.kind === "add");
}

export function removedLines(h: Hunk): DiffLine[] {
  return h.lines.filter((l) => l.kind === "del");
}

/** Stable content hash used to key mock recordings and the hook result cache. */
export function hunkFingerprint(h: Hunk): string {
  let hash = 2166136261;
  const s = `${h.file}\n${h.text}`;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
