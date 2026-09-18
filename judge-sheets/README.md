# Judge Sheets — spreadsheets that think, at spreadsheet speed

A compact spreadsheet (own grid, own formula engine) where three extra formulas call
[TypeSafe Jev](https://docs.typesafe.ai) for semantic judgments:

| Formula | Jev primitive | Returns | Rendered as |
|---|---|---|---|
| `=JUDGE(text, "yes/no question")` | `noul` | probability 0–1 | % heat cell |
| `=PICK(text, "instructions", "a\|b\|c")` | `choice` | the chosen option | label, tint = confidence |
| `=RATE(text, "instructions", "lvl0\|lvl1\|lvl2\|lvl3")` | `score` | ordinal score (expected level) | red→green by score, opacity = confidence |

![Judge Sheets](screenshots/judge-sheets.jpg)

![Editing the rubric in D2, Ctrl+Shift+D, 300 rows re-judge in ~3 s](screenshots/judge-sheets-demo.webp)

## The problem

Analysts label text in spreadsheets by hand, or with brittle
`=IF(ISNUMBER(SEARCH("broken",C2)),"defect","")` formulas that miss everything the
keyword list didn't anticipate. "AI in sheets" add-ons call an LLM per cell: 3–10 s per
cell, minutes per column, and a text answer you still have to parse. Nobody iterates on
a rubric when each iteration costs five minutes.

Jev answers a typed question in ~100–150 ms and takes many questions about the same
text in one request, so an entire 300-row column re-judges in about three seconds. The
rubric becomes something you *edit*, like any other formula: change the criteria string,
fill down, watch the column and the summary block update.

## How Jev is used

All TypeSafe calls live in `server/jev.ts` (the browser never sees the API key). The
formula engine (`src/engine/`) treats `JUDGE/PICK/RATE` as ordinary functions whose
value is asynchronous:

1. On each recalculation tick the workbook collects every dirty Jev cell into a `JevSpec`
   `(kind, text, instructions, options)`.
2. `batchSpecs()` groups specs by **source text**: all questions about one review go in
   ONE `systemone` request as fan-out (`state` = the review, `questions` = 4 typed
   questions). 300 reviews × 4 formulas = 300 requests, not 1200.
3. The proxy runs those requests through a 12-lane pool (`JEV_CONCURRENCY`), streams
   answers back as NDJSON as they arrive, and retries 429/529/5xx and stalled connections
   with exponential backoff + jitter.
4. Answers are cached by `(kind, text, instructions, options)`. Editing an unrelated cell,
   changing the `IF` threshold, or re-typing the same rubric costs zero requests.
5. Cells depending on judged cells (`COUNTIF`, `AVERAGE`, `IF(F2>2,"HOT","")`) recompute
   through the normal dependency graph as answers land.

The seeded questions:

**Reviews** (300 synthetic product reviews)

```
=RATE($C2,"Overall sentiment of this product review","very negative|negative|neutral|positive|very positive")
=PICK($C2,"What is the main topic of this review?","shipping|quality|price|support|other")
=JUDGE($C2,"Does the review report a defect, damage or malfunction of the product itself?")
=JUDGE($C2,"Would this reviewer recommend the product to others?")
```

**Leads** (150 synthetic inbound messages)

```
=PICK($D2,"This is an inbound message to a B2B software company. What does the sender want?","pricing|demo request|support|partnership|job inquiry|spam")
=RATE($D2,"How strong is the sender's intent to purchase our product?","no interest or unrelated|curious, just exploring|actively evaluating|ready to buy now")
=IF(F2>2,"HOT","")
```

Each sheet has a live summary block (`COUNTIF`, `AVERAGE`, `SUM` over the judged columns)
and the status bar shows measured numbers only: cells, requests, wall time, p50/p95 request
latency (measured server-side with `performance.now()` around each TypeSafe call), cells/s,
and what the same cells would cost at a simulated 4 s-per-cell LLM call.

## Measured run (real API, `jev-latest`, 12 concurrent lanes, Linux VM)

| Scenario | Cells | Requests | Wall time | p50 | p95 | Throughput | Per-cell LLM @ 4 s |
|---|---|---|---|---|---|---|---|
| Open workbook (both sheets, 7 Jev columns) | 1,478 | 443 | 4.8–7.4 s | 105–116 ms | 226–358 ms | 199–273 cells/s | 1.6 h |
| Edit rubric in D2 → Ctrl+Shift+D (300-row column) | 295 | 295 | 2.8–3.0 s | 102 ms | 202 ms | 98 cells/s | 20 min |

Variance across runs comes from the API's tail latency: p50/p95 are stable, but occasionally
a single request stalls. A stalled request is aborted after 2.5 s and retried, and the status
bar counts it as a retry (in testing, one stall added several seconds to an otherwise
3-second column re-judge). Everything shown in the status bar is from the run you are
looking at.

Judgment quality was checked by hand against the fixtures: strongly negative reviews score
≤ 1 and get a low "recommend" probability, positive ones score ≥ 3 with ≥ 90 %
"recommend"; reviews that mention a broken part get 90–98 % on the defect question while
"the color is nothing like the photos" stays at ~20–35 %; leads asking for quotes with
budget are scored 2.6–2.9 and flagged HOT, hiring and spam messages land near 0.

## Run it

```sh
cd judge-sheets
npm ci
export TYPESAFE_API_KEY=...      # server-side only; never reaches the browser
npm run dev                      # proxy on :8787 + Vite on :5173
```

Open http://localhost:5173, wait ~5 s for the workbook to judge itself, then:

1. Click **D2**, change the rubric text in the formula bar (e.g. *"How urgent is it for
   our support team to follow up with this customer?"* with levels
   `no follow-up needed|low|medium|high|urgent`), press Enter.
2. Press **Ctrl+Shift+D** (or the *Fill column ↓* button) — 300 rows re-judge in a few seconds.
3. Watch the summary block and the status bar update live.

Other controls: double-click / F2 to edit, drag the fill handle, drag column borders to
resize, Ctrl+Shift+D fills to the end of the data, *Re-judge sheet ⟳* drops the cache and
asks Jev again for every cell.

`MOCK=1 npm run dev` replays deterministic answers without an API key; the UI shows a red
**MOCK MODE** badge. Without a key and without `MOCK=1` the proxy answers 503 and the UI
says so.

```sh
npm test          # vitest: parser, dependency graph, fill-down shifting, batching, metrics
npm run lint      # oxlint --deny-warnings src server
npm run typecheck
npm run build     # tsc -b && vite build
```

## Layout

```
server/index.ts    node:http proxy: /api/health, /api/judge (NDJSON stream), pool, mock
server/jev.ts      the only module that talks to api.typesafe.ai; timing + backoff
server/types.ts    typed question builders: noul(), choice(), score()
src/engine/        tokenizer, parser, evaluator, workbook (dep graph, dirty set, Jev cache)
src/data/          seeded generators (mulberry32) + workbook definition
src/lib/           JevRunner (batching, streaming, metrics) + Store (React binding)
src/ui/            virtualized Grid, StatusBar, cell formatting
```
