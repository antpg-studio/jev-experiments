# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A collection of ~20 independent latency demos for **TypeSafe's Jev**, reached through OpenRouter's Decisions API (`POST https://openrouter.ai/api/alpha/decisions`, `model: typesafe/jev-1.13`, key `OPENROUTER_API_KEY`). Each top-level directory is a self-contained app with its own `package.json` (or `project.yml` / `Package.swift`), `README.md`, usually a `TESTING.md`, and committed screenshots. There is no workspace, monorepo tool, or shared package — never run commands from the repo root; always `cd` into the app directory first.

The shared point of every demo is the same: Jev returns typed judgments (Noul / Choice / Score) with probabilities in ~100-200 ms, so the app can judge *every* item in a stream instead of sampling, and apply policy in code over stored probabilities. Most demos include a "simulate slow LLM" toggle to show the contrast, and a heuristic/regex fallback path as the "before" baseline.

## Commands

### TypeScript apps (all but the four Swift ones)

```sh
cd <app> && npm ci      # node_modules are not committed
npm run dev             # http://localhost:5173
npm run build           # tsc -b && vite build
npm run typecheck
npm run lint            # oxlint --deny-warnings
npm test                # vitest run
npx vitest run src/foo.test.ts            # single file
npx vitest run -t "substring of it()"     # single test
```

Extra scripts vary per app: `bench`, `eval`, `measure`, `accuracy`, `demo` (commit-sentry), `preview`/`start`. Check the app's `package.json`.

### Swift apps

`jev-launcher`, `jev-ax-pilot`, `jev-voice-turn` are XcodeGen apps (`project.yml` is the source of truth; the `.xcodeproj` is committed, so `xcodegen generate` is only needed after editing `project.yml`):

```sh
xcodebuild -project <Name>.xcodeproj -scheme <Name> -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build   # or `test`
xcrun swift-format lint --strict --recursive Sources Tests
./run.sh                # jev-launcher: builds Debug and launches it so the API key env var is inherited
```

`jev-shell-guard` is a SwiftPM package: `swift build -c release --product jevsh`, `swift test`, `./install.sh`.

## Credentials and mock mode

`OPENROUTER_API_KEY` is **server-side only** and must never reach the browser bundle or a screenshot. Every web app keeps the key in a Node process and exposes `/api/...` on the same origin; `.env.example` documents this per app.

Most apps accept `MOCK=1` (e.g. `MOCK=1 npm run dev`), which replays canned answers from `server/mock.ts` or a recorded JSON file and shows an explicit MOCK pill in the UI. Keep mock-mode evidence separate from live evidence when capturing screenshots.

## The two web architectures

Both end at the same upstream; pick whichever the app already uses.

1. **Separate Node proxy process** — `npm run dev` runs `concurrently`: `server/index.ts` (a hand-written `node:http` server on `:8787`, started with `tsx` or `node --experimental-strip-types`) plus Vite on `:5173` proxying `/api`. `server/jev.ts` is the *only* file that talks to TypeSafe, and it owns retry with backoff on 429/529, mock short-circuiting, and the measured `apiMs` round trip. Used by turbo-rerank, send-guard, judge-sheets, nl-palette, log-sentinel, modstream, inbox-blitz, agent-assist, live-minutes.

2. **Vite plugin middleware** — a single dev process: `vite.config.ts` registers a `jev-proxy` plugin whose handler lives in a plain `.mjs` file (`jevProxy.mjs`, `jev-proxy.mjs`, `proxy.mjs`) with a hand-written `.d.mts` beside it. The same module is imported by `server.mjs`, which serves `dist/` plus the proxy on `:4173` for preview/production. These proxies use a keep-alive `https.Agent` and fan out many concurrent per-item requests; some also expose a WebSocket (`/api/jev/ws`) so a slow answer never blocks the fast ones behind it. Used by jev-firehose, jev-lint, jev-tower, jev-swarm, jev-dispatch, jev-instant-search.

`commit-sentry` is neither: a `tsx`/Node CLI that installs a git pre-commit hook and judges staged hunks in parallel.

## Jev integration conventions

- One request body is `{ model: "typesafe/jev-1.13", state, questions }`, where `questions` maps a code-only id to `{ type: "noul" | "choice" | "score", instructions, criteria }`. Question ids are never sent to the model, so the instructions must carry the full meaning; state fields are referenced from instructions with backticked paths like `` `message.text` ``.
- `turbo-rerank`, `agent-assist` and `log-sentinel` use `@typesafe-ai/sdk` rather than raw `fetch`. The SDK hardcodes the old `/v1/systemone` path, so each passes a `fetch` override that rewrites it to `/api/alpha/decisions`, plus an explicit `apiKey`, `baseURL` and `defaultModel` (its own env fallbacks still name `TYPESAFE_*`).
- Jev answers **one state per call**. Fan-out means many independent requests, not a batch — bounded by a pool (see `src/pool.ts` in jev-firehose) rather than unbounded concurrency.
- Ask all independent questions about the same state in a single request; they run in parallel and cannot see each other's answers.
- Store raw probabilities in the client and apply thresholds/policy in code (`policy.ts`, `rules.ts`, `accuracy.ts`). Moving a threshold slider must re-filter existing judgments without issuing new requests — that property is the point of several demos, so don't collapse it into a server-side boolean.
- Every app has a deterministic non-network fallback (heuristic/regex) plus seeded generators (`rng.ts`, mulberry32) so tests and benchmarks are reproducible. Unit tests never hit the network or read the API key.

## Skills

`.agents/skills/typesafe-ai/SKILL.md` (vendored, tracked by `skills-lock.json`) is the authority on designing Jev questions, and points at the live docs at `https://docs.typesafe.ai` (append `.md` to any page path for Markdown). Read it before writing or reshaping questions. `.agents/skills/turbo-rerank-e2e/SKILL.md` covers browser-testing turbo-rerank.

## Code style

Strict TypeScript (`strict`, `verbatimModuleSyntax`, `allowImportingTsExtensions`) with explicit `.ts` extensions on relative imports; React 19 with no UI framework and hand-written CSS per app; `oxlint --deny-warnings` must be clean. Swift uses `swift-format --strict` and, in jev-launcher, complete strict concurrency.
