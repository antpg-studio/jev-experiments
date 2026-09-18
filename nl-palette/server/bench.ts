/**
 * Terminal benchmark: runs the 30 phrasings through Jev (real API) and the
 * fuzzy matcher, printing accuracy@1 and latency stats. Usage:
 *   OPENROUTER_API_KEY=... node --experimental-strip-types server/bench.ts
 */
import { BENCHMARK_CASES } from "../src/data/benchmark.ts";
import { COMMANDS } from "../src/shared/commands.ts";
import { fuzzyRank } from "../src/shared/fuzzy.ts";
import { buildQuestions } from "../src/shared/questions.ts";
import { previewLabel, resolveAnswers } from "../src/shared/resolve.ts";
import { percentile } from "../src/shared/stats.ts";
import { systemOne } from "./jev.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const questions = buildQuestions();
const appState = {
  sidebar_visible: true, outline_visible: false, preview_visible: false, zen_mode: false, theme: "dark", font_size: 15,
  zoom_percent: 100, selection_exists: true, open_tabs: 3, word_wrap: true, line_numbers: true, spell_check: true, autosave: true,
};

const CONCURRENCY = 8;
const latencies: number[] = [];
let jevCorrect = 0;
let argCorrect = 0;
let argTotal = 0;
let fuzzyCorrect = 0;
const t0 = performance.now();

const queue = [...BENCHMARK_CASES];
async function worker() {
  for (;;) {
    const c = queue.shift();
    if (!c) return;
    const { response, latencyMs } = await systemOne(apiKey!, { query: c.query, app_state: appState }, questions);
    latencies.push(latencyMs);
    const r = resolveAnswers(response.answers);
    const top = r.ranked[0];
    const ok = top?.command.id === c.expected;
    if (ok) jevCorrect++;
    if (c.expectedArg) {
      argTotal++;
      if (ok && top.arg === c.expectedArg) argCorrect++;
    }
    const fz = fuzzyRank(c.query, COMMANDS)[0];
    const fzOk = fz?.command.id === c.expected;
    if (fzOk) fuzzyCorrect++;
    const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const second = r.ranked[1] ? ` | #2 ${r.ranked[1].command.id} ${(r.ranked[1].probability * 100).toFixed(0)}%` : "";
    console.log(`${mark} ${latencyMs.toFixed(0).padStart(4)}ms  "${c.query}" → ${previewLabel(top)} (${(top.probability * 100).toFixed(0)}%, conf ${r.confidence.toFixed(2)}, ${r.gate})${ok ? "" : `  expected ${c.expected}`}${second}  fuzzy: ${fz ? fz.command.id : "—"}${fzOk ? "" : " ✗"}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const elapsed = performance.now() - t0;
const n = BENCHMARK_CASES.length;
console.log(`\nJev accuracy@1 ${jevCorrect}/${n} (${((100 * jevCorrect) / n).toFixed(0)}%)  args ${argCorrect}/${argTotal}   fuzzy accuracy@1 ${fuzzyCorrect}/${n} (${((100 * fuzzyCorrect) / n).toFixed(0)}%)`);
console.log(`latency mean ${(latencies.reduce((a, b) => a + b, 0) / n).toFixed(0)}ms  p50 ${percentile(latencies, 50).toFixed(0)}ms  p95 ${percentile(latencies, 95).toFixed(0)}ms  total ${(elapsed / 1000).toFixed(2)}s at concurrency ${CONCURRENCY}`);
