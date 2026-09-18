// Offline evaluation of the Jev questions against the seeded corpus.
// Usage: OPENROUTER_API_KEY=... node eval.mjs [count=300] [seed=2024] [concurrency=32]
// Prints per-category mean probabilities, mod-queue precision/recall against the
// generator's hidden labels, and dumps every judged message to eval-out.jsonl
// so a human can hand-check a sample.

import fs from "node:fs";
import { createGenerator } from "./src/generator.ts";
import { buildState, parseJudgment, questions } from "./src/jev.ts";
import { defaultThresholds, inModQueue, isStreamerQuestion } from "./src/policy.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY not set");
const count = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 2024);
const conc = Number(process.argv[4] ?? 32);

const gen = createGenerator(seed);
const msgs = Array.from({ length: count }, () => gen.next());
const out = [];
const lats = [];
let next = 0;
let tokens = 0;
const t0 = performance.now();
await Promise.all(
  Array.from({ length: conc }, async () => {
    while (next < msgs.length) {
      const m = msgs[next++];
      const s = performance.now();
      const r = await fetch("https://openrouter.ai/api/alpha/decisions", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ state: buildState(m), model: "typesafe/jev-1.13", questions }),
      });
      const ms = performance.now() - s;
      if (r.status !== 200) {
        console.error("status", r.status, (await r.text()).slice(0, 120));
        continue;
      }
      const j = parseJudgment(await r.json());
      lats.push(ms);
      tokens += j.inputTokens;
      out.push({ ...m, j });
    }
  }),
);
const wall = (performance.now() - t0) / 1000;
lats.sort((a, b) => a - b);
const pct = (p) => lats[Math.min(lats.length - 1, Math.ceil((p / 100) * lats.length) - 1)].toFixed(0);
console.log(`judged ${out.length} in ${wall.toFixed(1)}s => ${(out.length / wall).toFixed(0)} msg/s; latency p50 ${pct(50)} p95 ${pct(95)} p99 ${pct(99)} ms; ${Math.round(tokens / out.length)} input tokens/msg`);

const cats = {};
for (const o of out) (cats[o.category] ??= []).push(o);
const mean = (xs, f) => (xs.reduce((s, x) => s + f(x), 0) / xs.length).toFixed(2);
console.log("\ncategory        n   harass  spam  spoiler  question  modAttn  hype   lang-ok");
for (const [c, xs] of Object.entries(cats).sort()) {
  const langOk = (xs.filter((x) => x.j.language === x.lang).length / xs.length).toFixed(2);
  console.log(`${c.padEnd(14)} ${String(xs.length).padStart(4)}   ${mean(xs, (x) => x.j.harassment)}   ${mean(xs, (x) => x.j.spam_or_scam)}   ${mean(xs, (x) => x.j.spoiler)}     ${mean(xs, (x) => x.j.question_for_streamer)}      ${mean(xs, (x) => x.j.needs_mod_attention)}    ${mean(xs, (x) => x.j.positive_hype)}   ${langOk}`);
}

const bad = new Set(["harassment", "scam", "spam", "spoiler", "selfpromo"]);
const flagged = out.filter((o) => inModQueue(o.j, defaultThresholds));
const tp = flagged.filter((o) => bad.has(o.category)).length;
const shouldFlag = out.filter((o) => bad.has(o.category)).length;
console.log(`\nmod queue @ defaults: flagged ${flagged.length}, precision ${(tp / flagged.length).toFixed(2)}, recall ${(tp / shouldFlag).toFixed(2)} (labels: harassment/scam/spam/spoiler/selfpromo)`);
const q = out.filter((o) => isStreamerQuestion(o.j, defaultThresholds));
const qtp = q.filter((o) => o.category === "question").length;
console.log(`streamer feed @ 0.8: shown ${q.length}, precision ${(qtp / q.length).toFixed(2)}, recall ${(qtp / out.filter((o) => o.category === "question").length).toFixed(2)}`);
console.log("\nfalse positives in mod queue:");
for (const o of flagged.filter((o) => !bad.has(o.category)).slice(0, 15)) console.log(`  [${o.category}] ${o.text}  harass=${o.j.harassment} mod=${o.j.needs_mod_attention}`);
console.log("misses:");
for (const o of out.filter((o) => bad.has(o.category) && !inModQueue(o.j, defaultThresholds)).slice(0, 15)) console.log(`  [${o.category}] ${o.text}  harass=${o.j.harassment} spam=${o.j.spam_or_scam} spoiler=${o.j.spoiler} mod=${o.j.needs_mod_attention}`);

fs.writeFileSync("eval-out.jsonl", out.map((o) => JSON.stringify(o)).join("\n"));
