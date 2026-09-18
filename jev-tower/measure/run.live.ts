import { test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { Sim } from "../src/engine.ts";
import { Controller, decisionsPerSecond, newTelemetry } from "../src/controller.ts";
import type { JevRequest, JevResponse } from "../src/jev.ts";
import type { Mode } from "../src/types.ts";

const MODES: readonly Mode[] = ["rules", "jev", "slow"];

/** Same wire call the /api/jev proxy makes, with the key read from the environment (never printed). */
async function live(req: JevRequest, signal?: AbortSignal): Promise<JevResponse> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const r = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(req),
    signal,
  });
  if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as JevResponse;
}

const mode = (process.env.JEV_MODE ?? "jev") as Mode;
const speed = Number(process.env.SPEED ?? "1");
const seed = Number(process.env.SEED ?? "7");
const durationS = Number(process.env.DUR ?? "300");
const rushHour = process.env.RUSH === "1";

test(`measured run: mode=${mode} seed=${seed} speed=${speed}x rush=${rushHour} duration=${durationS}s`, async () => {
  if (!(MODES as readonly string[]).includes(mode)) throw new Error(`JEV_MODE must be one of ${MODES.join(", ")}`);
  const sim = new Sim({ seed, rushHour });
  const tm = newTelemetry();
  const c = new Controller(mode, sim, tm, { call: live });
  const dps: number[] = [];
  const start = performance.now();
  let ticks = 0;
  while (sim.t < durationS) {
    const target = start + ((ticks + 1) * 500) / speed;
    const wait = target - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    sim.step(0.5);
    c.tick();
    ticks++;
    if (ticks % 20 === 0) dps.push(decisionsPerSecond(tm, performance.now()));
    if (ticks % 120 === 0) {
      console.log(`${mode} t=${sim.t}s aircraft=${sim.aircraft.length} losses=${sim.losses} near=${sim.nearMisses} requests=${tm.requests} p50=${tm.latency.p50.toFixed(0)}ms stale=${tm.stale} errors=${tm.errors}`);
    }
  }
  c.dispose();
  const out = {
    mode, seed, speed, durationS, ...sim.scorecard,
    requests: tm.requests, stale: tm.stale, errors: tm.errors, lastError: tm.lastError,
    latencyLast: tm.latency.last, p50: tm.latency.p50, p95: tm.latency.p95,
    inputTokens: tm.inputTokens, outputTokens: tm.outputTokens, costUsd: tm.costUsd, model: tm.model,
    avgDps: dps.reduce((a, b) => a + b, 0) / Math.max(1, dps.length),
    tokensPerDecision: sim.decisions ? tm.inputTokens / sim.decisions : 0,
    ticker: sim.ticker.map((e) => `${e.t} ${e.callsign} [${e.kind}] ${e.text}`),
  };
  mkdirSync("measure/results", { recursive: true });
  const file = `measure/results/${mode}-seed${seed}-x${speed}${rushHour ? "-rush" : ""}-${durationS}s.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, ticker: undefined }, null, 1));
  console.log(`wrote ${file}`);
});
