/**
 * Runs every fixture template (and every storm step) through Jev once, batched 8 at a time, and prints
 * a table of Jev vs regex vs ground truth. Used to tune question wording:  npx tsx server/evaluate.ts
 */
import type { LogEvent } from "../shared/types.ts";
import { STORM, TEMPLATES } from "./fixtures.ts";
import { Generator } from "./generator.ts";
import { ACTIONABLE_THRESHOLD, createJev } from "./jev.ts";
import { Confusion } from "./metrics.ts";

const gen = new Generator(42);
const events: { name: string; e: LogEvent }[] = [];
const now = Date.now();
for (const t of [...TEMPLATES, ...STORM.map((s) => s.template)]) {
  const out = [...gen.emit(t, now, false), ...gen.flush(now)];
  for (const e of out) events.push({ name: t.name, e });
}

const jev = createJev();
const batchSize = Number(process.argv[2] ?? 8);
const regex = new Confusion();
const jevAcc = new Confusion();
const lat: number[] = [];
const rows: string[] = [];
const t0 = performance.now();
for (let i = 0; i < events.length; i += batchSize) {
  const chunk = events.slice(i, i + batchSize);
  const res = await jev.judge(chunk.map((c) => c.e));
  lat.push(res.latencyMs);
  chunk.forEach((c, k) => {
    const v = res.verdicts[k];
    const act = v.actionableP >= ACTIONABLE_THRESHOLD;
    regex.record(c.e.regexPaged, c.e.truth.actionable);
    jevAcc.record(act, c.e.truth.actionable);
    const mark = act === c.e.truth.actionable ? "  " : "!!";
    rows.push(
      `${mark} ${c.name.padEnd(20)} truth=${String(c.e.truth.actionable).padEnd(5)} regex=${String(c.e.regexPaged).padEnd(5)} jev=${v.actionableP.toFixed(2)} sev=${v.severity.padEnd(18)}(${v.severityScore.toFixed(1)}/${c.e.truth.severity}) cat=${v.category.padEnd(18)}(${c.e.truth.category}) sec=${v.securityP.toFixed(2)}/${c.e.truth.security}`,
    );
  });
}
const elapsed = performance.now() - t0;
console.log(rows.join("\n"));
console.log(`\n${events.length} events, ${lat.length} requests (batch ${batchSize}), ${elapsed.toFixed(0)} ms total, p50 ${lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)].toFixed(0)} ms`);
console.log("regex", regex.snapshot());
console.log("jev  ", jevAcc.snapshot());
