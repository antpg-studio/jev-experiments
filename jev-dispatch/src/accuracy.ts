/**
 * Live accuracy sample: runs the Jev mode on the default seed until N reports
 * are triaged, then compares every Jev decision with the generator's ground truth.
 *
 *   TYPESAFE_API_KEY=... node src/accuracy.ts [--n 40] [--seed N]
 */
import { makeLiveDecider } from "./live.ts";
import { DEFAULT_SEED, Sim, type FeedItem } from "./sim.ts";

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}
const n = Number(flag("--n") ?? 40);
const seed = Number(flag("--seed") ?? DEFAULT_SEED);
const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  process.stderr.write("TYPESAFE_API_KEY not set\n");
  process.exit(1);
}

const sim = new Sim("jev", seed, makeLiveDecider("https://api.typesafe.ai/v1/systemone", { authorization: `Bearer ${key}` }));
let last = performance.now();
const decided = (): FeedItem[] => sim.feed.filter((f) => f.status === "done" && f.decision !== null);
while (decided().length < n && sim.finalKpis === null) {
  await new Promise((r) => setTimeout(r, 50));
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  for (let s = dt; s > 0; s -= 0.05) sim.step(Math.min(0.05, s));
}

const sample = decided().slice(0, n);
const truthCategory = (f: FeedItem) => (f.report.truth.duplicateOf ? "duplicate_update" : f.report.truth.category);
let cat = 0, sevExact = 0, sevNear = 0, units = 0, dup = 0, fromJev = 0;
const rows: string[] = [
  "| # | Ch | Report (truncated) | Truth cat / sev / units / dup | Jev cat / sev / units / dup-p | OK |",
  "|---|---|---|---|---|---|",
];
for (const f of sample) {
  const d = f.decision!;
  const t = f.report.truth;
  const tCat = truthCategory(f);
  const jevCat = d.mergeInto ? "duplicate_update" : d.category;
  const catOk = jevCat === tCat || (tCat === "duplicate_update" && d.category === t.category && f.outcome === "merged");
  const sevOk = d.severity === t.severity;
  const sevNearOk = Math.abs(d.severity - t.severity) <= 1;
  const unitsOk = d.units === t.units || (tCat === "duplicate_update" && f.outcome === "merged");
  const dupOk = (t.duplicateOf !== null) === (f.outcome === "merged");
  cat += catOk ? 1 : 0;
  sevExact += sevOk ? 1 : 0;
  sevNear += sevNearOk ? 1 : 0;
  units += unitsOk ? 1 : 0;
  dup += dupOk ? 1 : 0;
  fromJev += d.source === "jev" ? 1 : 0;
  const text = f.report.text.replace(/\|/g, "/").replace(/\s+/g, " ");
  const marks = `${catOk ? "C" : "c"}${sevOk ? "S" : sevNearOk ? "s" : "-"}${unitsOk ? "U" : "u"}${dupOk ? "D" : "d"}`;
  rows.push(`| ${f.report.seq} | ${f.report.channel} | ${text.length > 70 ? text.slice(0, 67) + "..." : text} | ${tCat} / ${t.severity} / ${t.units} / ${t.duplicateOf ? "yes" : "no"} | ${jevCat} / ${d.severity} / ${d.units} / ${d.duplicateP.toFixed(2)}${d.source !== "jev" ? ` (${d.source})` : ""} | ${marks} |`);
}
console.log(rows.join("\n"));
console.log();
console.log(`Sample: ${sample.length} reports, seed ${seed}, ${fromJev} answered by Jev, ${sample.length - fromJev} by fallback`);
console.log(`Category (duplicates count as duplicate_update): ${cat}/${sample.length}`);
console.log(`Severity exact: ${sevExact}/${sample.length}; within ±1 level: ${sevNear}/${sample.length}`);
console.log(`Unit package: ${units}/${sample.length}`);
console.log(`Duplicate detection (merged iff truth is a follow-up): ${dup}/${sample.length}`);
console.log(`Legend: uppercase = match (C category, S severity exact, s severity ±1, U units, D duplicate)`);
