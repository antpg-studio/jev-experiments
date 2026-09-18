# Testing jev-dispatch

## Clean install and checks

Node 22.12+ or 24 (`node src/bench.ts` relies on Node's native TypeScript stripping).

```sh
cd jev-dispatch
npm ci
npm run lint        # oxlint --deny-warnings src
npm run typecheck   # tsc --noEmit
npm test            # vitest run, 22 tests, no network
npm run build       # tsc -b && vite build
```

All four must exit 0. Tests never call the network: the `Sim` class takes an injected `Decider`, and the tests use canned JSON, a never-resolving promise (timeout path) and a rejecting promise (error path).

## Deterministic verification

The whole simulation is seeded (`DEFAULT_SEED = 20260917`), and unit assignment sorts by distance then unit id, so two runs with the same decisions produce identical KPIs.

1. `npm run bench -- --skip-jev` prints the Manual and Slow LLM columns instantly. Expected on the default seed: 275 reports, Manual 14 triaged / 261 queued / 57.7 s median dispatch, Slow LLM 59 / 216 / 54.5 s. These numbers are fully deterministic.
2. `npm run bench -- --seed 7 --skip-jev` gives a different but equally reproducible stream.
3. In the UI, `Restart` replays the same schedule; the map caption shows `seed 20260917 · 275 reports`. Switching mode also restarts on the same seed. `Run all 3` chains the three modes and fills the comparison table.
4. The Jev column depends on live model answers and network latency, so it is reproducible in shape (0 queued, sub-second median dispatch) but not bit-for-bit.

## What the automated tests cover (`src/sim.test.ts`)

| Area | Checks |
| --- | --- |
| Generator | same seed → identical schedule, different seed → different; bursts of 3–8 reports in a wall-clock second (generator rate is 1–5/s with jitter) separated by lulls, all three channels, duplicates and non-emergencies present; follow-ups reference an earlier report; surge fires 40 reports inside its window |
| City / fleet | deterministic depots and units; every unit type parked at a depot of the right kind, 112 units |
| Jev request | exactly seven questions with the required ids and types; nearby open incidents serialised into `state` |
| Answer parsing | well-formed answer → typed decision; high duplicate probability merges into the nearest open incident; far-away incidents are not merge targets; out-of-range severity clamped, unknown unit package replaced; low category confidence falls back to the heuristic; malformed payloads return `null` |
| Fallback heuristic | obvious texts classified, non-emergencies flagged, deterministic output, close same-category repeats merged |
| KPI math | median, percentile, rate per second, formatting helpers |
| Dispatch engine | manual mode decides one report per 12 s FIFO; nearest units of the right type are assigned and move toward the scene; duplicates merge instead of opening a new incident; slow Jev answer → fallback, late answer discarded as stale; failed request → fallback; critical-waiting KPI and surge injection; same seed twice gives identical heuristic runs |

## Live checks (need `OPENROUTER_API_KEY`)

```sh
export OPENROUTER_API_KEY=...
npm run dev             # open http://localhost:5173, pick Jev, watch the latency KPI
npm run bench           # ~3 min; the Jev leg runs in real time against the API
npm run accuracy        # ~40 s; 40 live decisions vs generator ground truth
```

The key is read only by Node-side code: the Vite middleware (`vite.config.ts`), `server.mjs`, and the two CLI scripts `src/bench.ts` / `src/accuracy.ts`. Nothing imported by `src/main.tsx` touches it; the browser bundle only knows the `/api/jev` path.

### Recorded accuracy run (2026-09-17, seed 20260917)

| # | Ch | Report (truncated) | Truth cat / sev / units / dup | Jev cat / sev / units / dup-p | OK |
|---|---|---|---|---|---|
| 1 | sms | theres a guy sleeping in the doorway of 174 juniper st northgate he... | police / 1 / police_1 / no | medical / 2 / ambulance / 0.03 | csuD |
| 2 | call | sewage smell and water coming up from a drain at 16 Boathouse Ln, R... | utility / 1 / utility_crew / no | utility / 2 / utility_crew / 0.01 | CsUD |
| 3 | sensor | GRID SENSOR feeder 14 (341 Foxglove Ct, Northgate): fault current, ... | utility / 3 / utility_crew / no | utility / 3 / utility_crew / 0.05 | CSUD |
| 4 | sms | someone is breaking into the house next door at 292 union sq midtow... | police / 3 / police_2+ / no | police / 3 / police_2+ / 0.02 | CSUD |
| 5 | call | apartment fire 475 Kiln St, Ironworks smoke everywhere i'm on the 4... | fire / 4 / fire_full / no | fire / 4 / fire_full / 0.03 | CSUD |
| 9 | call | my son has had a fever since yesterday and now a rash, 488 Quay St,... | medical / 1 / ambulance / no | medical / 2 / ambulance / 0.04 | CsUD |
| 10 | call | man having a heart attack at 442 Foundry Rd, Ironworks he is grey a... | medical / 4 / ambulance / no | medical / 4 / ambulance / 0.05 | CSUD |
| 13 | call | there's a guy sleeping in the doorway of 142 Liberty Pl, Midtown, h... | police / 1 / police_1 / no | medical / 2 / ambulance / 0.19 | csuD |
| 14 | call | my roommate took a bunch of pills and is really drowsy and confused... | medical / 3 / ambulance / no | medical / 4 / ambulance / 0.06 | CsUD |
| 6 | sms | i see the smoke from kiln st is anyone coming?? big black smoke | duplicate_update / 4 / fire_full / yes | duplicate_update / 4 / fire_full / 0.97 | CSUD |
| 11 | call | still no ambulance at 442 Foundry Rd, Ironworks, he's still not bre... | duplicate_update / 4 / ambulance / yes | duplicate_update / 4 / ambulance / 0.94 | CSUD |
| 16 | call | my roommate took a bunch of pills and is really drowsy and confused... | medical / 3 / ambulance / no | medical / 4 / ambulance / 0.27 | CsUD |
| 18 | sms | thres a raccoon in my garage at 170 depot ln ironworks how do i get... | non_emergency / 0 / none / no | non_emergency / 1 / none / 0.02 | CsUD |
| 19 | sms | my husband colapsed hes not breathing 164 quay st harborfront pls h... | medical / 4 / ambulance / no | medical / 4 / ambulance / 0.05 | CSUD |
| 8 | call | the fire on Kiln St is getting bigger, its spreading to the next bu... | duplicate_update / 4 / fire_full / yes | duplicate_update / 4 / fire_full / 0.96 | CSUD |
| 23 | call | street light out at 215 Cedar Ln, Northgate, it's really dark on th... | utility / 1 / utility_crew / no | utility / 1 / utility_crew / 0.15 | CSUD |
| 24 | sms | a kid is stuck in a storm drain at 72 sycamore st riverside we can ... | rescue / 3 / fire_engine / no | rescue / 4 / ambulance+fire / 0.06 | CsuD |
| 26 | sensor | GRID SENSOR feeder 14 (143 Kiln St, Ironworks): fault current, brea... | utility / 3 / utility_crew / no | utility / 3 / utility_crew / 0.04 | CSUD |
| 28 | call | Tom here. fender bender at 235 Foundry Rd, Ironworks, two cars, no ... | traffic / 2 / police_1 / no | traffic / 1 / police_1 / 0.06 | CsUD |
| 30 | sms | some1 just collapsed at 289 liberty pl mitown unconscious not respo... | medical / 4 / ambulance / no | medical / 4 / ambulance / 0.07 | CSUD |
| 33 | call | test test is this the emergency line | non_emergency / 0 / none / no | non_emergency / 0 / none / 0.03 | CSUD |
| 34 | call | cyclist got hit by a car at 412 Mill St, Old Town, she's awake but ... | traffic / 3 / ambulance / no | traffic / 3 / ambulance / 0.04 | CSUD |
| 15 | call | the lady who fell at 370 Boathouse Ln, Riverside is in a lot of pai... | duplicate_update / 3 / ambulance / yes | medical / 3 / ambulance / 0.40 | cSUd |
| 17 | sms | update on 141 juniper st northgate: shes awake now but very confused | duplicate_update / 3 / ambulance / yes | duplicate_update / 3 / ambulance / 0.95 | CSUD |
| 29 | sms | the two cars at 235 foundry rd ironworks r still blocking the road ... | duplicate_update / 2 / police_1 / yes | duplicate_update / 1 / police_1 / 0.98 | CsUD |
| 12 | call | calling again re the man who collapsed at 442 Foundry Rd, Ironworks | duplicate_update / 4 / ambulance / yes | duplicate_update / 4 / ambulance / 0.96 | CSUD |
| 7 | call | i see the smoke from Kiln St, is anyone coming?? big black smoke | duplicate_update / 4 / fire_full / yes | duplicate_update / 4 / fire_full / 0.97 | CSUD |
| 32 | call | still no ambulance at 289 Liberty Pl, Midtown, he's still not breat... | duplicate_update / 4 / ambulance / yes | duplicate_update / 4 / ambulance / 0.98 | CSUD |
| 35 | call | Marcus here. A power line came down at 460 Slag Ave, Ironworks, it'... | utility / 3 / utility_crew / no | utility / 4 / utility_crew / 0.22 | CsUD |
| 36 | call | transformer exploded at 470 Aspen Rd, Northgate, loud bang, power o... | utility / 3 / utility_crew / no | utility / 3 / utility_crew / 0.19 | CSUD |
| 37 | call | truck hit a bus at 417 Juniper St, Northgate, lots of people hurt, ... | traffic / 4 / ambulance+fire / no | traffic / 4 / ambulance+fire / 0.04 | CSUD |
| 41 | call | my neighbours at 347 Seawall Dr, Harborfront are playing loud music... | non_emergency / 0 / none / no | non_emergency / 1 / none / 0.02 | CsUD |
| 42 | call | Marcus here. transformer exploded at 82 Union Sq, Midtown, loud ban... | utility / 3 / utility_crew / no | utility / 3 / utility_crew / 0.18 | CSUD |
| 44 | call | Marcus here. nosebleed that won't stop for 20 min at 138 Union Sq, ... | medical / 1 / ambulance / no | medical / 2 / ambulance / 0.06 | CsUD |
| 45 | call | there's a man with a gun in the store at 364 Pier 9, Harborfront, h... | police / 4 / police_2+ / no | police / 4 / police_2+ / 0.02 | CSUD |
| 49 | call | test test is this the emergency line | non_emergency / 0 / none / no | non_emergency / 0 / none / 0.03 | CSUD |
| 50 | call | how do I get a copy of a police report I filed last month? | non_emergency / 0 / none / no | non_emergency / 0 / none / 0.02 | CSUD |
| 51 | call | Dumpster on fire behind 106 Depot Ln, Ironworks. Nobody hurt, just ... | fire / 2 / fire_engine / no | fire / 2 / fire_engine / 0.07 | CSUD |
| 53 | call | water main burst at 146 Foxglove Ct, Northgate, water gushing down ... | utility / 1 / utility_crew / no | utility / 2 / utility_crew / 0.05 | CsUD |
| 54 | sms | guy cut his hand badly w a saw at 54 market st midtown lots of bloo... | medical / 3 / ambulance / no | medical / 3 / ambulance / 0.04 | CSUD |

Sample: 40 reports, seed 20260917, 40 answered by Jev, 0 by fallback
Category (duplicates count as duplicate_update): 37/40
Severity exact: 26/40; within ±1 level: 40/40
Unit package: 37/40
Duplicate detection (merged iff truth is a follow-up): 39/40
Legend: uppercase = match (C category, S severity exact, s severity ±1, U units, D duplicate)
