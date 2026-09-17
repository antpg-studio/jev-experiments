# Jev Tower — verification and reproduction

## Clean installation and commands

```sh
cd jev-tower
npm ci
npm run lint        # oxlint --deny-warnings src
npm run typecheck   # tsc --noEmit
npm test            # vitest, src/**/*.test.ts, no network
npm run build       # tsc -b && vite build
```

Node 22.12+ or 24. Lint, typecheck, tests and build need no API key. Running the app or the measurement harness needs `TYPESAFE_API_KEY` in the shell (see `.env.example`); the key is read only by `jev-proxy.mjs` / `server.mjs` / `measure/run.live.ts` and never reaches the browser bundle.

## Automated coverage (`npm test`)

`src/kinematics.test.ts`
- heading normalisation, short-way turn deltas, bearings
- velocity in NM/s, rate-limited turns, climb/descent/acceleration clamped at target, 300 kt covers 5 NM in a minute

`src/conflict.test.ts`
- head-on co-altitude pair 20 NM apart loses separation in about 100 s; 1000 ft vertical is not a conflict
- a climbing aircraft that will reach the other's altitude is predicted; an arrival is predicted to start down at its top of descent
- diverging traffic is not a conflict, pairs are de-duplicated, tower airspace is excluded
- the sim is deterministic for a seed and stays within the 15-40 aircraft band

`src/validate.test.ts`
- one instruction per aircraft per 20 s; no descent below MSA/approach floor, no climb above the ceiling; speed envelopes per phase
- a turn into another aircraft is rejected; `direct_to_next_fix` only for vectored aircraft; established arrivals on final take only speed/resume
- `applyInstruction` state changes; probability-ranked fallback takes Jev's pick when valid, else the next-highest valid option (recording why), ending at `maintain`
- rule-based candidates separate a head-on pair and the result actually resolves the conflict

`src/jev.test.ts`
- state builder carries precomputed geometry, the intruder's instruction and unavailable options
- one request batches three questions per aircraft over shared state; answers parse into typed decisions and tolerate missing/unknown values
- stale answers (superseded sequence number or too-old sim time) are discarded; latency percentiles
- `Controller` with a fake transport: applies fresh answers, discards a stale one, never blocks the tick; an invalid pick falls to the next valid option and a failed request falls back to rules; slow mode handles one aircraft per call and waits out the simulated latency

Tests use an injected transport and an injected clock; nothing touches the network.

## Deterministic verification

The simulation is seeded (`Seed` field, default 7). With the same seed, speed and policy, the traffic, conflicts and rule-based decisions are identical run to run; only the Jev modes vary with the live answers and their arrival times.

Headless, no key needed:

```sh
npx vitest run -c /dev/null -t "deterministic" src/conflict.test.ts
```

## Live measurement

```sh
export TYPESAFE_API_KEY=...
JEV_MODE=rules SPEED=1 npm run measure        # JEV_MODE = rules | jev | slow
JEV_MODE=jev   SPEED=4 RUSH=1 npm run measure # SEED=<n> DUR=<seconds> also accepted
```

The harness (`measure/run.live.ts`) drives the same `Sim` and `Controller` the browser uses, paced to wall-clock at the chosen speed, against the real API. It prints progress every 60 s of sim time and writes `measure/results/<mode>-seed<seed>-x<speed>[-rush]-<dur>s.json` with the scorecard, latency percentiles, tokens, cost, stale/error counts and the full instruction ticker. The README tables were produced from these files.

## Browser golden path

1. `npm run dev`, open http://localhost:5173 at 1280x720. Expect the scope with range rings, runway 27, fixes, 15-25 aircraft with data blocks, a moving sweep and a clean console.
2. Default policy is **Jev**. Within a few seconds the latency panel shows request count, last / p50 / p95 in ms (about 100 ms p50 from a US machine), tokens and cost; halos appear on aircraft Jev decides for and the ticker fills with `JEV` instructions. Fallbacks say why the first pick was rejected.
3. Toggle **4x** and **Rush hour**: aircraft count climbs toward 40, decisions/sec rises, losses stay at 0.
4. Switch to **Rules**: telemetry resets, the ticker shows `RULES` instructions, no requests are made.
5. Switch to **Slow**: last latency reads about 2600 ms, stale answers accumulate, and at 4x or rush hour losses of separation appear (red aircraft, `LOSS OF SEPARATION` in the ticker, counter increments).
6. Change the seed and press **Reset**: new traffic, same layout; the same seed reproduces the same traffic.
7. DevTools Network: every request goes to same-origin `/api/jev` with no `Authorization` header; the response is the raw Jev JSON.

Screenshots and the GIF in `docs/` were captured from this path.

## Results (this session)

Node 24.19.0, macOS: `npm ci`, lint (0 warnings), typecheck, all 32 Vitest tests and the production build passed. The browser golden path above passed in Chrome at 1280x720 against the live API (`jev-1.13.0`), with no key or `Authorization` header visible to the browser and a clean console. Five-minute measured runs for all three modes at 1x and 4x, plus 4x rush hour, are tabulated in the README.
