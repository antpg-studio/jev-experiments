/**
 * Mock mode: replays judgments recorded from a real run (mock/recording.json), keyed by hunk
 * fingerprint. Output is labelled MOCK everywhere. Recorded latencies are re-slept so the
 * timeline looks like the original run, but nothing here is a live measurement.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { hunkFingerprint } from "./diff.ts";
import type { Judge } from "./run.ts";
import type { Hunk, HunkJudgment, MessageJudgment } from "./types.ts";

export interface Recording {
  recordedAt: string;
  hunks: Record<string, HunkJudgment>;
  messages: Record<string, MessageJudgment>;
}

export const MOCK_LABEL = "MOCK — replaying judgments recorded from a real run; no API calls made";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function loadRecording(file: string): Recording {
  if (!existsSync(file)) throw new Error(`No mock recording at ${file}. Run once live with --record to create it.`);
  return JSON.parse(readFileSync(file, "utf8")) as Recording;
}

export function saveRecording(file: string, rec: Recording): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
}

export function messageKey(message: string): string {
  return message.trim();
}

export function mockJudge(rec: Recording): Judge {
  return {
    label: MOCK_LABEL,
    retries: 0,
    async judgeHunk(h: Hunk): Promise<HunkJudgment> {
      const j = rec.hunks[hunkFingerprint(h)];
      if (!j) throw new Error(`Mock recording has no judgment for ${h.id}; re-record with --record.`);
      const t = performance.now();
      await sleep(j.latencyMs);
      return { ...j, hunkId: h.id, latencyMs: performance.now() - t };
    },
    async judgeMessage(message: string): Promise<MessageJudgment> {
      const m = rec.messages[messageKey(message)];
      if (!m) throw new Error("Mock recording has no judgment for this commit message; re-record with --record.");
      const t = performance.now();
      await sleep(m.latencyMs);
      return { ...m, latencyMs: performance.now() - t };
    },
  };
}

/** Wrap a live judge so its answers are captured into a recording. */
export function recordingJudge(inner: Judge, rec: Recording): Judge {
  return {
    label: inner.label,
    get retries() {
      return inner.retries;
    },
    async judgeHunk(h) {
      const j = await inner.judgeHunk(h);
      rec.hunks[hunkFingerprint(h)] = j;
      return j;
    },
    async judgeMessage(message, hunks, judgments) {
      const m = await inner.judgeMessage(message, hunks, judgments);
      rec.messages[messageKey(message)] = m;
      return m;
    },
  };
}
