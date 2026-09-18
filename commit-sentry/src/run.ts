import { performance } from "node:perf_hooks";
import { compareWithBaseline, runRegexBaseline, type BaselineResult } from "./baseline.ts";
import { allHunks, parseUnifiedDiff } from "./diff.ts";
import {
  buildMessageState,
  hunkQuestionCount,
  judgeHunk,
  judgeMessage,
  mapWithConcurrency,
  type JevClient,
} from "./jev.ts";
import { evaluate, percentile, summariseFiles, type FileSummary } from "./policy.ts";
import type { FileDiff, Hunk, HunkJudgment, MessageJudgment, PolicyOptions, PolicyResult, Timing } from "./types.ts";

export const CONCURRENCY = 16;

/** Anything that can judge hunks and messages: the real JevClient or the mock replayer. */
export interface Judge {
  judgeHunk(h: Hunk): Promise<HunkJudgment>;
  judgeMessage(message: string, hunks: Hunk[], judgments: HunkJudgment[]): Promise<MessageJudgment>;
  readonly retries: number;
  readonly label: string | null;
}

export function liveJudge(client: JevClient): Judge {
  return {
    judgeHunk: (h) => judgeHunk(client, h),
    judgeMessage: (m, hunks, js) => judgeMessage(client, buildMessageState(m, hunks, js)),
    get retries() {
      return client.retries;
    },
    label: null,
  };
}

export interface RunInput {
  diff: string;
  commitMessage: string | null;
  policy: PolicyOptions;
  judge: Judge;
  onHunkDone?: (j: HunkJudgment, done: number, total: number) => void;
}

export interface RunResult {
  files: FileDiff[];
  hunks: Hunk[];
  judgments: HunkJudgment[];
  message: MessageJudgment | null;
  commitMessage: string | null;
  policy: PolicyResult;
  fileSummaries: FileSummary[];
  timing: Timing;
  baseline: BaselineResult & { caught: number; missed: number; extra: number };
  mockLabel: string | null;
}

export async function run(input: RunInput): Promise<RunResult> {
  const started = performance.now();
  const files = parseUnifiedDiff(input.diff);
  const hunks = allHunks(files);

  const hunkStart = performance.now();
  let done = 0;
  const judgments = await mapWithConcurrency(hunks, CONCURRENCY, (h) => input.judge.judgeHunk(h), (j) => {
    done++;
    input.onHunkDone?.(j, done, hunks.length);
  });
  const hunkPhaseMs = performance.now() - hunkStart;

  let message: MessageJudgment | null = null;
  const msgStart = performance.now();
  if (input.commitMessage && hunks.length > 0) {
    message = await input.judge.judgeMessage(input.commitMessage, hunks, judgments);
  }
  const messagePhaseMs = performance.now() - msgStart;

  const policy = evaluate(hunks, judgments, message, input.policy);
  const fileSummaries = summariseFiles(hunks, judgments, policy.findings);

  const latencies = judgments.map((j) => j.latencyMs);
  if (message) latencies.push(message.latencyMs);
  const sorted = [...latencies].sort((a, b) => a - b);
  const totalMs = performance.now() - started;
  const timing: Timing = {
    totalMs,
    hunkPhaseMs,
    messagePhaseMs,
    latencies,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    hunksPerSecond: hunkPhaseMs > 0 ? (hunks.length / hunkPhaseMs) * 1000 : 0,
    judgments: hunks.reduce((n, h) => n + hunkQuestionCount(h), 0) + (message ? 2 : 0),
    requests: judgments.length + (message ? 1 : 0),
    retries: input.judge.retries,
    inputTokens: judgments.reduce((n, j) => n + j.inputTokens, 0) + (message?.inputTokens ?? 0),
    outputTokens: judgments.reduce((n, j) => n + j.outputTokens, 0) + (message?.outputTokens ?? 0),
  };

  const base = runRegexBaseline(hunks);
  const jevPairs = policy.findings
    .filter((f) => f.id !== "risk" && f.id !== "message_mismatch")
    .map((f) => ({ hunkId: f.hunkId, id: f.id }));
  const cmp = compareWithBaseline(jevPairs, base);

  return {
    files,
    hunks,
    judgments,
    message,
    commitMessage: input.commitMessage,
    policy,
    fileSummaries,
    timing,
    baseline: { ...base, caught: cmp.caught, missed: cmp.missed.length, extra: cmp.extra.length },
    mockLabel: input.judge.label,
  };
}
