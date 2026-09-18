# Testing jev-swarm

## Clean install and checks

Node 22.12+ or 24.

```sh
cd jev-swarm
npm ci
npm run lint        # oxlint --deny-warnings src
npm run typecheck   # tsc --noEmit
npm test            # vitest run (37 tests, no network)
npm run build       # tsc -b && vite build
```

All four must exit 0. Last verified: 37 passed, lint clean, build produces `dist/`.

## Automated tests (Vitest, `src/*.test.ts`)

No test touches the network; the Jev client is injected as a controllable fake.

| file | covers |
| --- | --- |
| `world.test.ts` | seeded determinism; agent/personality/human creation; movement and wall clamping; pellet eating and respawn; the 1.15× eat ratio; collision resolution with death, kill/death stats and respawn after 2 s; boost consumption and cooldown; angle quantisation |
| `perception.test.ts` | perception contains only local information (nearest 6 agents, nearest 5 pellets, sorted by distance, dead agents excluded); relation/wall/status fields and the compact text rendering; per-direction move descriptions with wall flags; bigger agents never offered as targets; the three questions reference the agent's JSON path; fan-out of several agents into one request with namespaced question ids |
| `decide.test.ts` | parsing typed answers out of a batched response; rejecting unknown moves, unlisted targets and sub-threshold boost; applying a fresh answer; discarding stale sequence numbers; prey-chase refinement from the move distribution; ignoring answers for dead agents; heuristic fallback on low-confidence answers; heuristic threat/prey/pellet/wall behaviour; `refineHeading` tracking |
| `swarm.test.ts` | batching due agents into fixed-size requests and capping in-flight requests; agents keep acting on the last decision while a request is in flight; late answers discarded after a newer one applied; max 2 in-flight per agent; partial-batch slack; failed requests keep the last decision, 429 triggers backoff; time-based deterministic fallback; heuristic policy makes zero requests; slow-LLM delay; reset rebuilds the identical world and ignores answers from the old one; metrics percentiles, rates, Jev-vs-heuristic decision accounting and cost |

## Deterministic manual verification

The world is seeded (`seed: 7` in `src/swarm.ts`), so every reset produces the identical spawn layout. Pressing **pause** immediately after **reset** always shows the same arena.

1. `cp .env.example .env`, put a real `OPENROUTER_API_KEY` in it (or export it), `npm run dev`, open http://localhost:5173.
2. Within two seconds the big green number (Jev decisions / s) should climb toward 60 with 32 agents; **in-flight requests** oscillates between 0 and 12; **round-trip latency** p50 should be in the 150–250 ms range from a US machine. **errors · 429** should stay at 0 or grow only occasionally.
3. Move the mouse: the green agent follows; press space: it bursts for 1.5 s and the boost is unavailable for 8 s.
4. Click **targets**: dashed lines show each agent's chosen target; agents with a dashed ring have a request in flight; agents flash when a fresh Jev answer lands.
5. Toggle **slow LLM (2.5 s)**: decisions/s drops to roughly 14–20 and in-flight sits at or near the 12 cap; and agents visibly run into bigger neighbours and walls. Toggle off and the number recovers within a few seconds.
6. Choose **Heuristic bots**: the label changes to *Heuristic decisions / s*, requests stay at 0, tokens and cost stay at 0, all agents are grey squares. **Mixed** alternates Jev circles and heuristic squares so the two policies can be compared side by side.
7. Drag the **agents** slider to 64: the world resets with 64 agents and the request rate doubles; drag to 4 and the arena is nearly empty.
8. Watch the **leaderboard**: kills, deaths, pellets and win% per personality update live.
9. Press **reset**: the timer, metrics and world restart; answers from requests sent before the reset are ignored (no stale count, no decisions applied to the new world).

## Production server

```sh
npm run build
OPENROUTER_API_KEY=... npm run preview    # http://localhost:4173
```

`server.mjs` serves `dist/` and proxies `/api/jev` with the same handler as the dev middleware. Confirm the built bundle contains no key:

```sh
grep -rl "TYPESAFE\|sk-" dist/assets && echo LEAKED || echo clean
```

## Proxy smoke test (needs the key)

```sh
curl -s -X POST localhost:5173/api/jev -H 'content-type: application/json' \
  -d '{"state":{"a":"you: greedy, size 16"},"questions":{"m":{"type":"choice","instructions":"direction for `a`","criteria":{"N":"open","hold":"stay"}}}}'
```

Expect `{"model":"jev-1.x","answers":{"m":{"type":"choice",...}},"usage":{...}}`. Without a key the proxy answers `500 {"error":"OPENROUTER_API_KEY is not set on the server"}` and the UI counts errors while the heuristic fallback keeps agents moving.
