import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function stagedDiff(cwd: string): string {
  return execFileSync("git", ["diff", "--cached", "-U3", "--no-color", "--no-ext-diff"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function gitDir(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function repoRoot(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Read a commit message file, dropping comment lines and trailing whitespace. */
export function readCommitMessage(file: string): string {
  const raw = readFileSync(file, "utf8");
  return raw
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();
}

export function defaultCommitMessage(cwd: string): string | null {
  try {
    const f = join(gitDir(cwd), "COMMIT_EDITMSG");
    if (!existsSync(f)) return null;
    const msg = readCommitMessage(f);
    return msg.length > 0 ? msg : null;
  } catch {
    return null;
  }
}
