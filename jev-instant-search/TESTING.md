# jev-instant-search — verification and reproduction

## Clean installation and commands

Node 22.12+ or 24. Everything except `dev`, `preview`, `bench` and `eval` works offline.

```sh
cd jev-instant-search
npm ci
npm run lint        # oxlint --deny-warnings src server.mjs server
npm run typecheck   # tsc --noEmit
npm test            # vitest run — 37 tests, no network
npm run build       # tsc -b && vite build
```

Live runs need the key in the environment (never in the bundle, never committed):

```sh
TYPESAFE_API_KEY=... npm run dev        # Vite on :5173 with /api/jev middleware
TYPESAFE_API_KEY=... npm run preview    # node server.mjs serving dist/ on :4173
TYPESAFE_API_KEY=... npm run bench      # batching vs concurrency table
TYPESAFE_API_KEY=... npm run eval       # top-5 for the 5 example queries, both columns
TYPESAFE_API_KEY=... node bench/dump.ts "quiet keyboard for open office"   # all 30 for one query
```

Without a key the proxy answers `503 {"error":"TYPESAFE_API_KEY is not set on the server"}`
and the right column falls back to the deterministic heuristic; the error count on screen
increments and the UI keeps working.

## Deterministic fixture

The catalog is generated in `src/catalog.ts` from a fixed seed (`CATALOG_SEED = 20260917`,
`CATALOG_SIZE = 5000`) with a mulberry32 PRNG; the same seed always yields the same 5,000
products in the same order, so ids such as `el-0031` are stable across machines. Changing the
seed changes every product. Lexical retrieval is deterministic for a given catalog and query.
Jev answers are not byte-deterministic (scores vary by a few hundredths between calls), so
tests never call the API; they feed hand-built answers into the parser and ranker.

## Automated coverage (`npm test`)

- `src/catalog.test.ts` — same seed ⇒ identical catalog, different seed ⇒ different catalog,
  unique ids, valid categories, price/rating ranges, every category has hundreds of products.
- `src/retriever.test.ts` — at most `TOP_K` hits normalized to the top score, empty query
  returns nothing, prefix matching while typing, per-query time under budget, stemming
  (`hike` ↔ `hiking`) and stopwords, per-type diversification (`MAX_PER_TYPE`), determinism.
- `src/jev.test.ts` — the request holds exactly 30 `score` questions + the 5 query-level
  questions with the specified criteria, the state contains only the fields Jev needs,
  answers map back to product ids with ordered probability arrays, missing/malformed
  answers fall back to heuristics, the heuristic detects cheap/premium/gift/rating cues,
  cost uses the published $0.042/M input-token price.
- `src/rank.test.ts` — lexical-only ordering; Jev relevance overriding lexical order; zero
  relevance weight restores lexical order; relevance floor pushes items to the bottom;
  cheap/premium/gift/category bonuses apply only above their confidence gates; inferred
  sort applies only above the sort gate and only when enabled; sort works within relevance
  bands so a cheap poor match cannot outrank a good one; sort never resurrects below-floor
  items; deterministic tie-breaks.
- `src/sequence.test.ts` — `SequenceGate` accepts in-order answers, discards a stale answer
  that arrives after a newer one painted, allows skipping ahead, rejects duplicates;
  `LatencyStats` last/p50/p95 and bounded window; `InFlightLimiter` caps concurrency,
  keeps only the newest held request and runs it when a slot frees.

## Golden path in the browser

1. `TYPESAFE_API_KEY=... npm run dev`, open http://localhost:5173.
2. Click the chip **something to keep coffee hot on a hike**. It types character by
   character. Expect: left column shows coffee makers; right column shows vacuum bottles
   within ~150–400 ms of the last keystroke; header shows `retriever` under ~2 ms,
   `jev last` / `p50` / `p95`, `to paint`, `decisions/s` in the low hundreds,
   `requests`, `stale / skipped`, `tokens in`, `cost / 1k searches` ≈ $0.33; the right
   column subtitle shows `intent kitchen NN% · cheap … · sort relevance NN% ✓`.
3. Click **cheap headphones that dont leak sound**. Expect `cheap 99%`, `sort price_low`,
   and a ~$38 closed-back pair at #1 on the right while a $200+ pair is #1 on the left.
   Green ▲N badges show how far an item moved up versus the lexical column.
4. Click **something to keep coffee hot on a hike** again (a query with no inferred sort),
   then move the **relevance** slider to 0. The right column collapses toward the left
   column's order and the `requests` counter does not change (sliders re-rank locally).
   On the headphones query the inferred `price_low` sort orders within relevance bands, so
   the relevance weight alone changes little there; untick **apply inferred sort** to see
   the weights take over. Press **reset**.
5. Type quickly into the box (or paste a few characters at a time). `stale / skipped`
   increases; the previous ranking stays painted (dimmed) until a newer answer arrives and the status
   flips from `seq N in flight` to `seq N painted`; an answer for an older sequence never
   replaces a newer one.
6. Click **Baseline: simulated 2.5s LLM**, then a chip. The right column stays dimmed for
   2.5 s after each keystroke and `to paint` shows ~2,500+ ms. Click **Lexical + Jev** to
   return. **Baseline: heuristics only** never calls the API and uses the regex fallback.

## How the screenshots were produced

The PNGs and GIF in `docs/` were captured from the running dev server against the live API
using headless Chromium driven by Playwright at 1280×720 (typing each example query at
70 ms/char, then one query at 15 ms/char to exercise stale-answer dropping, then the slow
baseline), and the GIF was assembled from frames with ffmpeg. The numbers visible in them
are the numbers the app measured at that moment; they are not edited.
