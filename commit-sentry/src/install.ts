import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitDir } from "./git.ts";

const MARKER = "# commit-sentry hook";

export function preCommitScript(command: string, extraFlags: string): string {
  return `#!/bin/sh
${MARKER}
# Judges every staged hunk with TypeSafe Jev before the commit is created.
# Exit non-zero to block. Bypass with: git commit --no-verify
exec ${command} check ${extraFlags}--no-message
`;
}

export function commitMsgScript(command: string, extraFlags: string): string {
  return `#!/bin/sh
${MARKER}
# Checks that the commit message describes the staged hunks.
exec ${command} check ${extraFlags}--message-file "$1"
`;
}

export interface InstallOptions {
  cwd: string;
  strict: boolean;
  command?: string | undefined;
  force: boolean;
}

export interface InstallResult {
  written: string[];
  skipped: string[];
}

export function installHooks(opts: InstallOptions): InstallResult {
  const hooksDir = join(gitDir(opts.cwd), "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const command = opts.command ?? "npx commit-sentry";
  const flags = opts.strict ? "--strict " : "";
  const files: Array<[string, string]> = [
    ["pre-commit", preCommitScript(command, flags)],
    ["commit-msg", commitMsgScript(command, flags)],
  ];
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [name, body] of files) {
    const target = join(hooksDir, name);
    if (existsSync(target) && !opts.force && !readFileSync(target, "utf8").includes(MARKER)) {
      skipped.push(target);
      continue;
    }
    writeFileSync(target, body);
    chmodSync(target, 0o755);
    written.push(target);
  }
  return { written, skipped };
}
