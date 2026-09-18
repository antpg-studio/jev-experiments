// Runs the whole fixture through Jev (real API), scores it against the ground truth,
// prints latency + accuracy, and with --write-mock records the answers for MOCK=1 mode.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MEETING, TRANSCRIPT, type LabelledUtterance } from "../src/data/transcript.ts";
import { judgeUtterance } from "../server/jev.ts";
import { resolveJudgment } from "../src/lib/resolve.ts";
import { createLimiter } from "../src/lib/queue.ts";
import { summarize } from "../src/lib/stats.ts";
import { evaluateKeyword } from "../src/lib/keyword.ts";
import type { JudgeAnswers, JudgeRequest } from "../src/lib/types.ts";

const apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const writeMock = process.argv.includes("--write-mock");
const verbose = process.argv.includes("-v");
const hash = (text: string) => createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);

function requestFor(u: LabelledUtterance, recentDecisions: string[]): JudgeRequest {
  const prev = TRANSCRIPT.slice(Math.max(0, u.id - 3), u.id).map((p) => ({ speaker: p.speaker, text: p.text }));
  return { utterance: u.text, speaker: u.speaker, previous: prev, recentDecisions, context: MEETING };
}

const limiter = createLimiter(12);
const recorded: Record<string, JudgeAnswers> = {};
const latencies: number[] = [];
let kindOk = 0;
let assigneeOk = 0;
let assigneeTotal = 0;
let deadlineOk = 0;
let deadlineTotal = 0;
let actionTP = 0;
let actionFP = 0;
let reverseOk = 0;
let blockedOk = 0;
const confusion = new Map<string, number>();
const misses: string[] = [];

// Ground-truth decisions before each utterance stand in for the live "recent decisions" state.
const decisionsBefore = (id: number) =>
  TRANSCRIPT.filter((u) => u.id < id && u.truth.kind === "decision").slice(-3).map((u) => u.text);

const t0 = performance.now();
await Promise.all(
  TRANSCRIPT.map((u) =>
    limiter.run(async () => {
      const r = await judgeUtterance(requestFor(u, decisionsBefore(u.id)), apiKey);
      latencies.push(r.apiMs);
      recorded[hash(u.text)] = r.answers;
      const j = resolveJudgment(r.answers, u.text, u.speaker, MEETING);
      const t = u.truth;
      const key = `${t.kind} → ${j.kind}`;
      if (j.kind === "action_item") {
        if (t.kind === "action_item") actionTP++;
        else actionFP++;
      }
      if (j.kind === t.kind) kindOk++;
      else {
        confusion.set(key, (confusion.get(key) ?? 0) + 1);
        misses.push(`KIND  [${u.id}] ${u.speaker.split(" ")[0]}: "${u.text}"  truth=${t.kind} got=${j.kind} (${j.kindConfidence.toFixed(2)})`);
      }
      if (t.kind === "action_item") {
        assigneeTotal++;
        if ((j.assignee ?? null) === t.assignee) assigneeOk++;
        else misses.push(`OWNER [${u.id}] "${u.text}"  truth=${t.assignee} got=${j.assignee} (${j.assigneeConfidence.toFixed(2)}${j.assigneeUncertain ? " ?" : ""})`);
        deadlineTotal++;
        if (j.deadline.kind === t.deadline) deadlineOk++;
        else misses.push(`DUE   [${u.id}] "${u.text}"  truth=${t.deadline} got=${j.deadline.kind} (has=${r.answers.has_deadline.noul.toFixed(2)})`);
      }
      if (j.reverses === t.reverses) reverseOk++;
      else misses.push(`REV   [${u.id}] "${u.text}"  truth=${t.reverses} got=${r.answers.reverses_earlier_decision.noul.toFixed(2)}`);
      if (j.blocked === t.blocked) blockedOk++;
      else misses.push(`BLK   [${u.id}] "${u.text}"  truth=${t.blocked} got=${r.answers.is_blocked.noul.toFixed(2)}`);
      if (verbose) console.log(`${String(u.id).padStart(3)} ${r.apiMs.toFixed(0).padStart(4)}ms ${j.kind.padEnd(13)} ${u.text.slice(0, 80)}`);
    }),
  ),
);
const wall = performance.now() - t0;
const n = TRANSCRIPT.length;
const lat = summarize(latencies);
const kw = evaluateKeyword(TRANSCRIPT.map((u) => ({ text: u.text, isAction: u.truth.kind === "action_item" })));

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}% (${a}/${b})`;
console.log("\n── Live Minutes · fixture evaluation ──────────────────────────");
console.log(`utterances            ${n}`);
console.log(`wall time (12 conc.)  ${(wall / 1000).toFixed(2)} s  →  ${(n / (wall / 1000)).toFixed(1)} utterances/s`);
console.log(`Jev latency           p50 ${lat.p50.toFixed(0)} ms · p95 ${lat.p95.toFixed(0)} ms · max ${lat.max.toFixed(0)} ms · mean ${lat.mean.toFixed(0)} ms`);
console.log(`kind accuracy         ${pct(kindOk, n)}`);
console.log(`action items           recall ${pct(actionTP, assigneeTotal)} · precision ${pct(actionTP, actionTP + actionFP)}`);
console.log(`assignee accuracy     ${pct(assigneeOk, assigneeTotal)}   (action items only)`);
console.log(`deadline-kind acc.    ${pct(deadlineOk, deadlineTotal)}   (action items only)`);
console.log(`reverses accuracy     ${pct(reverseOk, n)}`);
console.log(`blocked accuracy      ${pct(blockedOk, n)}`);
console.log(`keyword baseline      miss rate ${(kw.missRate * 100).toFixed(1)}% (${kw.falseNegatives}/${kw.total}) · false positives ${kw.falsePositives} · precision ${(kw.precision * 100).toFixed(0)}%`);
if (confusion.size) {
  console.log("\nkind confusion:");
  for (const [k, v] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}
if (misses.length) {
  console.log("\nmisses:");
  for (const m of misses.sort()) console.log("  " + m);
}
if (writeMock) {
  writeFileSync(new URL("../server/mock-answers.json", import.meta.url), JSON.stringify(recorded, null, 1));
  console.log(`\nwrote server/mock-answers.json (${Object.keys(recorded).length} entries)`);
}
