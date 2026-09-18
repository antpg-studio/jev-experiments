#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createFixtureRepo, FIXTURE_COMMIT_MESSAGE } from "./fixture.ts";
import { defaultCommitMessage, readCommitMessage, stagedDiff } from "./git.ts";
import { installHooks } from "./install.ts";
import { JevClient, MissingApiKeyError } from "./jev.ts";
import { loadRecording, mockJudge, recordingJudge, saveRecording, type Recording } from "./mock.ts";
import { c, renderHeader, renderProgress, renderReport } from "./render.ts";
import { liveJudge, run, type Judge, type RunResult } from "./run.ts";

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RECORDING_FILE = join(PKG_ROOT, "mock", "recording.json");

interface Args {
  command: "check" | "demo" | "install" | "help";
  strict: boolean;
  report: string | null;
  mock: boolean;
  record: boolean;
  messageFile: string | null;
  message: string | null;
  noMessage: boolean;
  timings: boolean;
  cwd: string;
  force: boolean;
  hookCommand: string | null;
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const a: Args = {
    command: "check",
    strict: false,
    report: null,
    mock: env.MOCK === "1",
    record: false,
    messageFile: null,
    message: null,
    noMessage: false,
    timings: true,
    cwd: process.cwd(),
    force: false,
    hookCommand: null,
  };
  const rest = [...argv];
  const first = rest[0];
  if (first && !first.startsWith("-")) {
    rest.shift();
    if (first === "check" || first === "demo" || first === "install" || first === "help") a.command = first;
    else throw new Error(`Unknown command "${first}". Try: check, demo, install`);
  }
  const takeValue = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined || v.startsWith("-")) throw new Error(`${flag} requires a value`);
    return v;
  };
  while (rest.length) {
    const arg = rest.shift()!;
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    if (eq >= 0) rest.unshift(arg.slice(eq + 1));
    switch (name) {
      case "--strict":
        a.strict = true;
        break;
      case "--report":
        a.report = rest[0] && !rest[0].startsWith("-") ? rest.shift()! : "commit-sentry-report.json";
        break;
      case "--mock":
        a.mock = true;
        break;
      case "--record":
        a.record = true;
        break;
      case "--message-file":
        a.messageFile = takeValue(name);
        break;
      case "--message":
      case "-m":
        a.message = takeValue(name);
        break;
      case "--no-message":
        a.noMessage = true;
        break;
      case "--no-timings":
        a.timings = false;
        break;
      case "--cwd":
        a.cwd = resolve(takeValue(name));
        break;
      case "--force":
        a.force = true;
        break;
      case "--command":
        a.hookCommand = takeValue(name);
        break;
      case "-h":
      case "--help":
        a.command = "help";
        break;
      default:
        throw new Error(`Unknown flag ${name}`);
    }
  }
  return a;
}

const HELP = `commit-sentry — semantic pre-commit checks judged by TypeSafe Jev

Usage:
  commit-sentry [check] [flags]     judge the staged diff of the current repo (default)
  commit-sentry demo [flags]        build the fixture repo in a temp dir and judge it
  commit-sentry install [flags]     write .git/hooks/pre-commit and .git/hooks/commit-msg

Flags:
  --strict              block on any finding ≥ 60% and on high-risk hunks
  --report [file]       also write a JSON report (default commit-sentry-report.json)
  --mock                replay recorded judgments (clearly labelled; no API calls)
  --record              live run that also saves judgments to mock/recording.json
  -m, --message <msg>   commit message to check against the diff
  --message-file <f>    read the commit message from a file (used by the commit-msg hook)
  --no-message          skip the commit-message judgment
  --no-timings          hide the per-hunk latency table
  --cwd <dir>           repository to check (default: current directory)
  --force               install: overwrite existing non-sentry hooks
  --command <cmd>       install: command the hooks should run (default: npx commit-sentry)

Environment:
  TYPESAFE_API_KEY      required unless --mock
  MOCK=1                same as --mock
  NO_COLOR / FORCE_COLOR
`;

function buildJudge(a: Args, rec: Recording | null): Judge {
  if (a.mock) return mockJudge(loadRecording(RECORDING_FILE));
  const live = liveJudge(new JevClient());
  return rec ? recordingJudge(live, rec) : live;
}

async function check(a: Args, cwd: string, message: string | null): Promise<RunResult> {
  const diff = stagedDiff(cwd);
  if (diff.trim().length === 0) {
    process.stdout.write(`${c.bold(c.cyan("◆ commit-sentry"))} ${c.dim("nothing staged; nothing to judge")}\n`);
    process.exit(0);
  }
  const rec: Recording | null = a.record ? { recordedAt: new Date().toISOString(), hunks: {}, messages: {} } : null;
  const judge = buildJudge(a, rec);

  const files = new Set<string>();
  let hunkCount = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) files.add(line);
    else if (line.startsWith("@@")) hunkCount++;
  }
  process.stdout.write(renderHeader(hunkCount, files.size, message, judge.label) + "\n");

  const tty = Boolean(process.stdout.isTTY);
  const started = performance.now();
  const result = await run({
    diff,
    commitMessage: message,
    policy: { strict: a.strict },
    judge,
    onHunkDone: (j, done, total) => {
      const line = renderProgress(done, total, j.latencyMs, performance.now() - started);
      if (tty) process.stdout.write(`\r${line}\u001b[K`);
      else if (done === total) process.stdout.write(line + "\n");
    },
  });
  if (tty) process.stdout.write("\n");
  process.stdout.write(renderReport(result, a.strict, a.timings));

  if (rec) {
    saveRecording(RECORDING_FILE, rec);
    process.stdout.write(c.dim(`  recorded judgments → ${RECORDING_FILE}\n\n`));
  }
  if (a.report) {
    const file = resolve(a.report);
    writeFileSync(file, JSON.stringify(reportJson(result, a.strict), null, 2) + "\n");
    process.stdout.write(c.dim(`  report → ${file}\n\n`));
  }
  return result;
}

function reportJson(r: RunResult, strict: boolean) {
  return {
    generatedAt: new Date().toISOString(),
    mock: r.mockLabel,
    strict,
    verdict: r.policy.verdict,
    commitMessage: r.commitMessage,
    message: r.message,
    files: r.fileSummaries,
    findings: r.policy.findings,
    hunks: r.hunks.map((h) => ({ id: h.id, file: h.file, language: h.language, header: h.header })),
    judgments: r.judgments,
    timing: r.timing,
    baseline: r.baseline,
  };
}

function resolveMessage(a: Args, cwd: string, fallback: string | null): string | null {
  if (a.noMessage) return null;
  if (a.message) return a.message;
  if (a.messageFile) return readCommitMessage(a.messageFile) || null;
  return fallback ?? defaultCommitMessage(cwd);
}

async function main(): Promise<number> {
  const a = parseArgs(process.argv.slice(2), process.env);
  if (a.command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (a.command === "install") {
    const r = installHooks({ cwd: a.cwd, strict: a.strict, command: a.hookCommand ?? undefined, force: a.force });
    for (const w of r.written) process.stdout.write(`${c.green("✔")} wrote ${w}\n`);
    for (const s of r.skipped) process.stdout.write(`${c.yellow("⚠")} kept existing ${s} ${c.dim("(use --force to overwrite)")}\n`);
    return r.skipped.length ? 1 : 0;
  }
  if (a.command === "demo") {
    const fx = createFixtureRepo();
    process.stdout.write(c.dim(`  fixture repo with a staged change → ${fx.dir}\n`));
    try {
      const result = await check(a, fx.dir, resolveMessage(a, fx.dir, FIXTURE_COMMIT_MESSAGE));
      return result.policy.verdict === "block" ? 1 : 0;
    } finally {
      fx.cleanup();
    }
  }
  const result = await check(a, a.cwd, resolveMessage(a, a.cwd, null));
  return result.policy.verdict === "block" ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof MissingApiKeyError) {
      process.stderr.write(`${c.red("✖ commit-sentry:")} ${err.message}\n`);
    } else {
      process.stderr.write(`${c.red("✖ commit-sentry:")} ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exit(2);
  },
);
