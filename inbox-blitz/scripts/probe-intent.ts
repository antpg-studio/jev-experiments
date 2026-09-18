// Dev helper: label the whole fixture against a free-text intent and print the matches.
// Usage: TYPESAFE_API_KEY=... npx tsx scripts/probe-intent.ts "customers threatening to cancel" [count]
import { EMAILS } from "../src/data/emails.ts";
import { matchEmail } from "../server/jev.ts";
import { summarize } from "../src/lib/labels.ts";
import type { MatchResult } from "../src/lib/types.ts";

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY missing");
const intent = process.argv[2];
if (!intent) throw new Error("intent missing");
const n = Number(process.argv[3] ?? EMAILS.length);
const sample = EMAILS.slice(0, n);
const out: MatchResult[] = [];
let i = 0;
const t0 = performance.now();
async function worker() {
  while (i < sample.length) {
    const e = sample[i++];
    const r = await matchEmail(e, intent, key!);
    out.push({ id: e.id, match: r.match, latencyMs: r.latencyMs, inputTokens: r.inputTokens, retries: r.retries });
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
const elapsed = performance.now() - t0;
const byId = new Map(EMAILS.map((e) => [e.id, e]));
out.sort((a, b) => b.match - a.match);
console.log(`\n"${intent}"\n`);
for (const r of out.slice(0, 40)) {
  const e = byId.get(r.id)!;
  console.log(`${(r.match * 100).toFixed(0).padStart(3)}%  ${r.latencyMs.toFixed(0).padStart(4)}ms  ${e.from.padEnd(22).slice(0, 22)}  ${e.subject.slice(0, 60)}${e.trap ? "  [TRAP]" : ""}`);
}
const s = summarize(out);
const lat = out.map((r) => r.latencyMs).sort((a, b) => a - b);
console.log(`\nmatched ${s.matched} (sure ${s.sure}, borderline ${s.borderline}) of ${s.judged} · ${(elapsed / 1000).toFixed(2)} s · p50 ${lat[Math.floor(lat.length / 2)].toFixed(0)} ms · p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(0)} ms · ${(out.length / (elapsed / 1000)).toFixed(1)} emails/s`);
console.log(`histogram ${s.histogram.join(" ")}`);
