# Testing jev-firehose

## Clean install

```sh
cd jev-firehose
rm -rf node_modules dist
npm ci
npm run lint        # oxlint --deny-warnings src
npm run typecheck   # tsc --noEmit
npm test            # vitest run (22 tests, no network)
npm run build       # tsc -b && vite build
```

All four must exit 0. Node 20+ (uses `fetch`, `node:crypto`, `Buffer.writeBigUInt64BE`).

## What the automated tests cover

| file | covers |
| --- | --- |
| `src/generator.test.ts` | same seed -> identical stream; different seeds differ; sequential ids; templates filled; every category and several languages appear; `mulberry32` range and repeatability |
| `src/jev.test.ts` | the question map has all seven judgments and the 8+1 language choice; `buildState()` shape; `parseJudgment()` on a real-shaped response (nouls, choice + confidence, usage); tolerance of missing/malformed answers; heuristic fallback flags obvious scam/harassment and passes hype; policy filters (`inModQueue`, `isStreamerQuestion`, `modReason`) re-filter stored probabilities at moved thresholds |
| `src/pool.test.ts` | bounded in-flight; a fast answer completes while a slower one is still pending (no head-of-line blocking); refill as answers arrive; failures fall back to heuristic; stale/over-age backlog is shed and counted; simulated delay is applied; plus `stats.ts`: percentiles, ring buffer, rate meter, histogram buckets, cost |
| `src/wsframe.test.ts` | server text-frame encoding for all three length classes round-trips through the decoder; masked client frames are unmasked; coalesced and partial frames across TCP chunks |

Nothing in the test suite opens a socket or reads `TYPESAFE_API_KEY`. The transport is a fake passed into `JudgePool`.

## Deterministic verification (no API key)

```sh
node --experimental-strip-types -e '
  import("./src/generator.ts").then(({ createGenerator }) => {
    const a = createGenerator(2024), b = createGenerator(2024);
    for (let i = 0; i < 1000; i++) { const x = a.next(), y = b.next(); if (x.text !== y.text || x.id !== y.id) throw new Error("diverged at " + i); }
    console.log("1000 messages identical for seed 2024");
  })'
```

Or in the UI: type a seed, RESET, START, PAUSE after a few seconds, note the first firehose rows; RESET and START again and the same rows appear in the same order.

The **heuristic only** toggle runs the whole console with zero network calls (in-flight stays 0, tokens stay flat), which is the way to check layout, sliders, spoiler blur and the action ticker without a key.

## Golden path against the live API

```sh
export TYPESAFE_API_KEY=...   # never committed; the browser never sees it
npm run dev                   # open http://localhost:5173
```

1. START at the default 300 msg/s / 96 in flight. Within ~5 s: ingest ~300, judged ~300, backlog 0, Jev p50 ~120-180 ms, p95 ~350-450 ms, `0.0% fallback`, tokens ~835 / msg, est. cost ~$37/h. The histogram is a green hump between 100 and 300 ms.
2. Mod queue cards show four probability bars, a reason badge (`HARASSMENT`, `SPAM / SCAM` which also covers self-promotion, `SPOILER`, `REVIEW`) and language tag; `HEURISTIC` badge appears only on shed/failed items.
3. Streamer feed shows only questions (>= 0.80) and collapses repeats into `+N asked the same`.
4. Drag `mod >=` to 0.30: the queue count jumps immediately; the footer `requests` counter keeps growing only at the ingestion rate (no re-query burst).
5. Toggle **simulate slow LLM (2 s)**: backlog climbs past 1,000 in seconds, e2e p95 shows 4-6 s in amber (2 s simulated + up to 4 s of queue wait before shedding), `fallback %` starts rising. Untoggle: backlog drains to 0 within ~10 s.
6. Click Timeout on a card: it disappears from the queue and `TIMEOUT @user - reason - "text"` appears in the footer ticker. Nothing is sent anywhere.
7. Hover a blurred firehose row (spoiler shield on): text unblurs.
8. Push the rate to 400+: expect `429 retries` in the footer to climb and `fallback %` to rise; this is the account rate limit, see README.

`curl -s -X POST localhost:5173/api/jev -H 'content-type: application/json' -d '{"items":[{"id":"x","state":{"stream":{},"message":{"user":"a","text":"kys trash streamer"}}}],"questions":{"h":{"type":"noul","instructions":"Is message.text harassment?"}}}'` exercises the HTTP proxy directly (also on 4173 under `npm run preview`).

## Offline evaluation

```sh
TYPESAFE_API_KEY=... node --experimental-strip-types eval.mjs 400 2024 32
```

Judges 400 seeded messages straight against TypeSafe with 32-way concurrency and prints throughput, latency percentiles, tokens/message, per-category mean probabilities, and mod-queue / streamer-feed precision and recall against the generator's hidden category labels. Every judged message is written to `eval-out.jsonl` (git-ignored) for hand-checking.

## How the screenshots were made

Headless Chromium (Playwright, not a project dependency) at 1280x720 against `npm run dev` with the live key: 30 s at 300 msg/s for `screenshot-console.png`, then the threshold drag (`screenshot-policy.png`), 7 s of slow-LLM mode (`screenshot-slow-llm.png`), and 20 s at 400 msg/s / 128 in flight (`screenshot-ceiling.png`). The numbers in the README tables are the values read off those pages.

## Known limitations

- Above ~300 msg/s the TypeSafe key used here returns HTTP 429; the app retries with backoff and falls back, but sustained judged throughput is capped by quota, not by Jev latency.
- The heuristic fallback is a small regex lexicon and is deliberately weak; it exists so the console never stalls.
- `eval.mjs` and the dev/preview servers require Node 22.6+ for `--experimental-strip-types` (or Node 23+ where it is on by default). Vite itself does not.
