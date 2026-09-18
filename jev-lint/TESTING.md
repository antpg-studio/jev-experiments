# jev-lint — verification and reproduction

## Clean installation and commands

```sh
cd jev-lint
npm ci
npm run lint          # oxlint --deny-warnings src
npm run typecheck     # tsc --noEmit
npm test              # vitest run, 46 tests, no network
npm run build         # tsc -b && vite build
```

Node 22.12+ or 24. None of the above needs `OPENROUTER_API_KEY`. Running the app does:

```sh
export OPENROUTER_API_KEY=...   # or put it in .env (see .env.example)
npm run dev                   # http://localhost:5173
# or
npm run build && npm run preview   # server.mjs on http://localhost:4173, PORT overrides
```

The key is read by the Node process (Vite middleware or `server.mjs`) and never sent to the browser. With no key the proxy answers `500 {"error":"OPENROUTER_API_KEY is not set on the server"}` and the editor falls back to heuristic markers, which is visible as `fallback` rows in the request log.

## Automated coverage

- `src/analysis.test.ts` — function extraction for all six sample languages (count, names, boundaries, nesting), `enclosingFunction`, `changedLines` (insert, delete, replace, same-length edits, trailing newline), `numberedSource`, `collectIdentifiers`, `extractImports`, `isJudgeable`, and that every planted issue lies inside an extracted function.
- `src/markers.test.ts` — `buildRequest` produces 5 Nouls + 1 Choice per judged line with the documented state keys and skips non-judgeable lines; `markersFromAnswers` thresholds (strong Noul, confident Choice, quiet lines, `ignore`/`info` handling, missing answers, probability fallback for an unknown choice); `clusterMarkers`; `evaluate` precision/recall/F1 and kind matching; heuristics; `Metrics` percentiles, trailing-window rates, tokens and cost.
- `src/linter.test.ts` — `Linter` with a mocked `fetch` and fake timers: the changed line is judged in its enclosing function after the 60 ms throttle; an answer for a line edited in flight is discarded as `stale` and the line re-judged immediately; edits to different functions overlap; a failed request falls back to the heuristic marker; a `429` is retried once after `retry-after`; markers move with inserted lines; heuristic mode never calls `fetch`; `fullScan` fans out per function and reports the burst.

## Live evaluation (network)

```sh
OPENROUTER_API_KEY=... node scripts/evaluate.ts          # all six samples
OPENROUTER_API_KEY=... node scripts/evaluate.ts rs       # one sample: ts, py, go, sql, sh, rs
```

Prints, per file: burst wall-clock, request count, questions, input tokens, every TP / FP / MISS line with its probabilities, then a markdown table and the overall precision/recall. Expect results within a few points of the README table; Nouls near the 0.60 threshold flip between runs.

## UI golden path

Run at 1280 x 720 or larger. Open the app; `orders.ts` loads and a full-file scan starts automatically.

1. **Scan.** Within about a second the **Full-file burst** card shows the wall-clock time (expect 200–700 ms), 10 requests and 264 judgments, the status bar shows last/p50/p95 latency, decisions/s, tokens and cost, and red/yellow/blue gutter dots appear on lines 19, 25, 39, 63, 74 among others. The request log lists each request with its latency and `OK`.
2. **Hover.** Hover a squiggle (line 19, `return items[items.length];`). The tooltip shows the five kinds with probability bars and the severity Choice probabilities.
3. **Reveal.** Click **Reveal planted issues**. The seeded lines get a yellow bar, and the sidebar shows precision / recall / hit / missed / extra / kind-ok for the current markers (expect roughly 85–100% on this file). Click **Hide planted issues**.
4. **Type.** Click **Type it for me**. A new `averagePrice` function is typed at the end of the file. Squiggles appear on `for (... i <= order.items.length ...)`, `isEmpty`, and `if (isEmpty) return 0;` while the remaining lines are still being typed; the request counter climbs and there are no `fallback` rows. Click **Stop typing** to interrupt or wait for it to finish.
5. **Edit by hand.** Change a line, e.g. `===` to `=` in an `if`. A marker appears within a few hundred milliseconds; the request log gains a row for that line only. Keep typing on the same line: the log shows `stale` rows and no more than one in-flight request for that line.
6. **Baselines.** Switch to **Regex only**: markers are recomputed instantly with no requests. Switch to **LLM +3 s** and edit a line: the marker appears after about three seconds. Switch back to **Jev live**.
7. **Other files.** Click each tab (`reports.py`, `server.go`, `reporting.sql`, `deploy.sh`, `inventory.rs`). Each loads, scans and shows findings; **Reveal planted issues** shows that file's precision/recall.
8. **Reset.** Click **Reset file** to restore the sample and rescan.

## Reproducing the screenshots

The images in `docs/` were captured headlessly with Playwright (`chromium`, viewport 1280 x 720, `deviceScaleFactor: 2`) against `npm run dev` with a live key, following steps 1–4 above; the GIF is the typing step sampled at about 4 frames per second and assembled with ffmpeg. Playwright is not a dependency of this package.

## Known gaps

- The TypeSafe API returned `429` during sustained development bursts above roughly 100 requests a minute. The client retries once and then falls back; if you see `fallback` rows during **Type it for me**, wait a minute and rerun.
- There is no end-to-end browser test in the repository; the golden path above is manual.
