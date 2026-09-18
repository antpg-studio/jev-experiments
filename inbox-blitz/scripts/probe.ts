// Dev helper: judge a sample of the fixture against the real API and print a compact table.
// Usage: OPENROUTER_API_KEY=... npx tsx scripts/probe.ts [count]
import { EMAILS } from "../src/data/emails.ts";
import { judgeEmail } from "../server/jev.ts";
import { URGENCY_LEVELS, SENTIMENT_LEVELS } from "../src/lib/types.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY missing");
const n = Number(process.argv[2] ?? 40);
const traps = EMAILS.filter((e) => e.trap);
const rest = EMAILS.filter((e) => !e.trap).slice(0, n);
const sample = [...traps, ...rest];
const lat: number[] = [];
const rows: string[] = [];
let i = 0;
async function worker() {
  while (i < sample.length) {
    const e = sample[i++];
    const { judgment: j, latencyMs } = await judgeEmail(e, key!);
    lat.push(latencyMs);
    const f = (x: number) => (x >= 0.5 ? "Y" : ".");
    rows.push(
      `${e.id} ${latencyMs.toFixed(0).padStart(4)}ms ${j.category.padEnd(15)} conf=${j.categoryConfidence.toFixed(2)} reply=${f(j.needsReply)} urg=${URGENCY_LEVELS[Math.round(j.urgency)].padEnd(15)} sent=${SENTIMENT_LEVELS[Math.round(j.sentiment)].padEnd(10)} phish=${f(j.isPhishingOrScam)} churn=${f(j.mentionsChurnOrCancel)} refund=${f(j.asksForRefund)} | ${e.subject.slice(0, 45)}${e.trap ? "  [TRAP: " + e.trap.slice(0, 60) + "]" : ""}`,
    );
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
rows.sort();
console.log(rows.join("\n"));
lat.sort((a, b) => a - b);
console.log(`\np50 ${lat[Math.floor(lat.length * 0.5)].toFixed(0)}ms p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(0)}ms n=${lat.length}`);
