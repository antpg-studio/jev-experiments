/**
 * Same-seed benchmark of the three modes over a full RUN_SECONDS run.
 *
 *   OPENROUTER_API_KEY=... node src/bench.ts [--seed N] [--surge-at SECONDS] [--skip-jev]
 *
 * Manual and Slow LLM are deterministic and run instantly. Jev runs in real time
 * against the live API (one fan-out request per report), so it takes RUN_SECONDS.
 */
import { makeLiveDecider } from "./live.ts";
import { fmtMs, fmtUsd } from "./kpi.ts";
import { DEFAULT_SEED, MODE_LABEL, RUN_SECONDS, Sim, type Decider, type Kpis, type Mode } from "./sim.ts";

const args = process.argv.slice(2);
function flag(name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}
const seed = Number(flag("--seed") ?? DEFAULT_SEED);
const surgeAt = flag("--surge-at") ? Number(flag("--surge-at")) : null;
const skipJev = args.includes("--skip-jev");

function maybeSurge(sim: Sim, fired: { done: boolean }): void {
  if (surgeAt !== null && !fired.done && sim.time >= surgeAt) {
    sim.surge();
    fired.done = true;
  }
}

function runInstant(mode: Mode): Kpis {
  const sim = new Sim(mode, seed, null);
  const fired = { done: false };
  while (sim.finalKpis === null) {
    sim.step(0.05);
    maybeSurge(sim, fired);
  }
  return sim.finalKpis;
}

async function runRealtime(mode: Mode, decider: Decider): Promise<Kpis> {
  const sim = new Sim(mode, seed, decider);
  const fired = { done: false };
  let last = performance.now();
  let nextLog = 30;
  while (sim.finalKpis === null) {
    await new Promise((r) => setTimeout(r, 50));
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    for (let s = dt; s > 0; s -= 0.05) sim.step(Math.min(0.05, s));
    maybeSurge(sim, fired);
    if (sim.time >= nextLog) {
      const k = sim.kpis();
      process.stderr.write(`  t=${nextLog}s  decided ${k.reportsDecided}/${k.reportsArrived}  queue ${k.queued}  p50 ${fmtMs(k.jev.p50Ms)}ms  fallbacks ${k.jev.fallbacks}\n`);
      nextLog += 30;
    }
  }
  return sim.finalKpis;
}

function row(label: string, cells: (string | number)[]): string {
  return `| ${label} | ${cells.join(" | ")} |`;
}

function table(results: Partial<Record<Mode, Kpis>>): string {
  const modes = (["manual", "slow", "jev"] as Mode[]).filter((m) => results[m]);
  const get = (f: (k: Kpis) => string | number) => modes.map((m) => f(results[m]!));
  const lines = [
    row("Metric", modes.map((m) => MODE_LABEL[m])),
    row("---", modes.map(() => "---")),
    row("Reports arrived", get((k) => k.reportsArrived)),
    row("Reports triaged", get((k) => k.reportsDecided)),
    row("Still in queue at 180 s", get((k) => k.queued)),
    row("Median time-to-dispatch", get((k) => k.medianDispatchS ? `${k.medianDispatchS.toFixed(1)} s` : "–")),
    row("Median triage time", get((k) => `${k.medianTriageS.toFixed(1)} s`)),
    row("Critical incidents waiting > 60 s", get((k) => k.criticalWaiting)),
    row("Duplicates merged", get((k) => k.merged)),
    row("Incidents open / closed", get((k) => `${k.incidentsOpen} / ${k.incidentsClosed}`)),
    row("Units idle", get((k) => `${k.unitsIdle} / ${k.unitsTotal}`)),
  ];
  const jev = results.jev;
  if (jev) {
    lines.push(
      row("Jev requests (errors / stale / fallbacks)", get((k) => k.jev.requests ? `${k.jev.requests} (${k.jev.errors} / ${k.jev.stale} / ${k.jev.fallbacks})` : "–")),
      row("Jev latency p50 / p95", get((k) => k.jev.requests ? `${fmtMs(k.jev.p50Ms)} / ${fmtMs(k.jev.p95Ms)} ms` : "–")),
      row("Input tokens (per request)", get((k) => k.jev.requests ? `${k.jev.inputTokens.toLocaleString()} (${Math.round(k.jev.inputTokens / k.jev.requests)})` : "–")),
      row("Est. cost per 1,000 reports", get((k) => k.jev.requests ? fmtUsd(k.jev.costPer1k) : "–")),
    );
  }
  return lines.join("\n");
}

const results: Partial<Record<Mode, Kpis>> = {};
process.stderr.write(`seed ${seed}, ${RUN_SECONDS} s run${surgeAt !== null ? `, surge at ${surgeAt} s` : ""}\n`);
results.manual = runInstant("manual");
results.slow = runInstant("slow");
if (!skipJev) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    process.stderr.write("OPENROUTER_API_KEY not set; skipping the Jev run\n");
  } else {
    process.stderr.write(`Jev run (real time, ${RUN_SECONDS} s)...\n`);
    results.jev = await runRealtime("jev", makeLiveDecider("https://openrouter.ai/api/alpha/decisions", { authorization: `Bearer ${key}` }));
  }
}
console.log(table(results));
