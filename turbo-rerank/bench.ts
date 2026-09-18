import { performance } from "node:perf_hooks";
import { BENCH_QUERIES } from "./shared/bench-queries.ts";
import { runBenchQuery, summarize } from "./shared/bench.ts";
import type { BenchRow, BenchSummary } from "./shared/types.ts";
import { BATCHES, describeError, MOCK, rerank } from "./server/jev.ts";
import { bm25Search, byId, corpusSize } from "./server/search.ts";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const ms = (x: number) => `${x.toFixed(0)} ms`;
const rank = (r: number | null) => (r === null ? `${c.red}  –${c.reset}` : r === 1 ? `${c.green}${String(r).padStart(3)}${c.reset}` : r <= 5 ? `${c.yellow}${String(r).padStart(3)}${c.reset}` : `${c.red}${String(r).padStart(3)}${c.reset}`);

function arrow(row: BenchRow): string {
  if (row.bm25Rank === null || row.jevRank === null) return " ";
  if (row.jevRank < row.bm25Rank) return `${c.green}▲${c.reset}`;
  if (row.jevRank > row.bm25Rank) return `${c.red}▼${c.reset}`;
  return `${c.dim}=${c.reset}`;
}

function table(summary: BenchSummary) {
  const line = (label: string, a: string, b: string, color = "") => `  ${label.padEnd(22)} ${a.padStart(10)} ${color}${b.padStart(12)}${c.reset}`;
  console.log(`\n${c.bold}  ${"".padEnd(22)} ${"BM25".padStart(10)} ${"BM25 + Jev".padStart(12)}${c.reset}`);
  console.log(line("top-1 accuracy", pct(summary.bm25Top1), pct(summary.jevTop1), c.green));
  console.log(line("top-5 accuracy", pct(summary.bm25Top5), pct(summary.jevTop5), c.green));
  console.log(line("MRR", summary.bm25Mrr.toFixed(3), summary.jevMrr.toFixed(3)));
  console.log(line("target in BM25 top-50", pct(summary.inTop50), ""));
  console.log(`\n${c.bold}  Rerank latency (50 candidates, one Jev request${BATCHES > 1 ? ` in ${BATCHES} batches` : ""})${c.reset}`);
  console.log(`  mean ${ms(summary.meanMs)}   p50 ${ms(summary.p50Ms)}   p95 ${ms(summary.p95Ms)}   max ${ms(summary.maxMs)}`);
  console.log(`  ${summary.n} queries in ${(summary.wallMs / 1000).toFixed(1)} s wall → ${summary.candidatesPerSecond.toFixed(0)} candidates judged/s, ${summary.inputTokens.toLocaleString()} input / ${summary.outputTokens.toLocaleString()} output tokens`);
}

async function main() {
  console.log(`${c.bold}${c.cyan}Turbo Rerank benchmark${c.reset} — corpus ${corpusSize} passages, ${BENCH_QUERIES.length} labelled queries${MOCK ? `  ${c.magenta}[MOCK MODE — no API calls, numbers are meaningless]${c.reset}` : ""}`);
  console.log(`${c.dim}  BM25 top-50 → one Jev request: 50 × score(relevance) + noul(answer_exists_in_candidates)${c.reset}\n`);
  console.log(`${c.dim}  ${"bm25".padStart(4)} ${"jev".padStart(4)}    ${"ms".padStart(5)}  exists  query${c.reset}`);

  const rows: BenchRow[] = [];
  const t0 = performance.now();
  let inputTokens = 0;
  let outputTokens = 0;
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
  let next = 0;
  const worker = async () => {
    while (next < BENCH_QUERIES.length) {
      const bq = BENCH_QUERIES[next++];
      try {
        const { row, timing } = await runBenchQuery(bq, (q, hits, b) => rerank(q, hits, byId, b), bm25Search, byId);
        inputTokens += timing.inputTokens;
        outputTokens += timing.outputTokens;
        rows.push(row);
        console.log(`  ${rank(row.bm25Rank)} ${arrow(row)}${rank(row.jevRank)}  ${ms(row.jevMs).padStart(7)}  ${row.answerExists.toFixed(2).padStart(6)}  ${row.paraphrase ? `${c.magenta}P${c.reset} ` : "  "}${row.query}`);
      } catch (err) {
        const { message } = describeError(err);
        console.log(`  ${c.red}ERR${c.reset} ${bq.query}: ${message}`);
        if (message.includes("TYPESAFE_API_KEY")) process.exit(1);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const summary = summarize(rows, performance.now() - t0, inputTokens, outputTokens);
  table(summary);
  const paraRows = rows.filter((r) => r.paraphrase);
  if (paraRows.length) {
    const p = summarize(paraRows, 0);
    console.log(`\n  ${c.magenta}P${c.reset} = paraphrase (few/no shared keywords), ${paraRows.length} queries: top-1 ${pct(p.bm25Top1)} → ${c.green}${pct(p.jevTop1)}${c.reset}, top-5 ${pct(p.bm25Top5)} → ${c.green}${pct(p.jevTop5)}${c.reset}`);
  }
  console.log(`\n${c.bold}  50 candidates reranked in ~${ms(summary.p50Ms)} (p50); top-1 accuracy ${pct(summary.bm25Top1)} → ${pct(summary.jevTop1)}${c.reset}\n`);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ summary, rows }, null, 2));
}

main();
