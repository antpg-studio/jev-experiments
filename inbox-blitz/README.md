# Inbox Blitz

**500 emails × 7 judgments = 3,500 judgments in 5.3 s** — a whole support/sales inbox triaged
with [TypeSafe Jev](https://docs.typesafe.ai) at ~95 emails/sec, then re-ranked instantly when
the policy changes, with a keyword-rule baseline on screen so you can see where regex fails.

![Inbox Blitz after triaging 500 emails](screenshots/inbox-blitz.jpg)

![Live run: triage, re-rank with sliders, keyword-rules comparison](screenshots/inbox-blitz-demo.webp)

## The problem

Support and sales inboxes get hundreds of messages an hour. Triage today is either a human
skimming subject lines, a keyword/regex classifier (fast but wrong on sarcasm, negation, quoted
history and marketing copy), or an LLM "summarise and classify" prompt per email — 2–5 s each,
minutes per batch, dollars per run, and a JSON-parsing step that breaks.

Jev is a *judgment* model: it does not generate text, it answers typed questions (choice / noul /
score) with probabilities in ~100–300 ms. That changes the shape of the solution:

- **All seven questions about one email go in one request.** Extra questions cost tokens, not
  latency. Seven dimensions arrive together in one round-trip.
- **Judgments are data.** The priority score is computed *in code* from the raw judgments. Move a
  weight slider and the queue re-sorts in the same frame — no new inference, no re-run.
- **Confidence is a first-class value.** Category confidence below 0.7 routes the email to a
  "needs human" lane instead of guessing.
- **Whole-inbox re-triage is cheap.** A full pass over 500 emails is ~5 s and ~$0.03, so changing
  the questions themselves (a new policy) is a re-run, not a project.

## What Jev is asked

One `POST https://api.typesafe.ai/v1/systemone` per email, `model: "jev-latest"`, with
`state = { email: { from, subject, body } }` and these seven questions (verbatim from
[`server/jev.ts`](server/jev.ts)):

| id | type | question |
|---|---|---|
| `category` | choice | Which single category best describes what this email is primarily about? — `billing`, `bug`, `feature_request`, `sales_lead`, `security`, `legal_privacy`, `spam_marketing`, `internal`, `other`, each with a one-line criterion |
| `needs_reply` | noul | Does the sender expect a human at our company to write back? (mass mailings, automated notifications and newsletters do not) |
| `urgency` | score | How quickly does this email need action, based on the real situation (ignore sarcastic framing and marketing pressure tactics)? — Can wait a week / This week / Today / Right now |
| `sentiment` | score | The sender's actual emotional tone toward us, reading past politeness and sarcasm — Friendly / Neutral / Frustrated / Furious |
| `is_phishing_or_scam` | noul | Is this a phishing attempt or scam (credential theft, fake invoice, gift cards, fake authority)? Pushy but legitimate marketing is `false`. |
| `mentions_churn_or_cancel` | noul | Is the *sender themselves* cancelling or threatening to leave? (cancellation mentioned in marketing copy does not count) |
| `asks_for_refund` | noul | Does the sender ask us to refund or credit back money they paid? |

Everything else is plain code: priority weights, lane routing, the 0.7 confidence gate, the
keyword baseline, agreement stats, percentiles and cost.

## Measured run (real API, concurrency 12)

Measured server-side with `performance.now()` around each HTTP request; nothing is simulated.
Best of three full runs on a Linux VM; the other two took 5.8 s and 5.9 s.

| metric | value |
|---|---|
| emails | 500 |
| judgments | 3,500 (7 per email, one request each) |
| total elapsed | **5.27 s** |
| throughput | **94.9 emails/s** (664 judgments/s) |
| p50 request latency | **96 ms** |
| p95 request latency | 270 ms |
| errors / retries | 0 / 0 |
| input tokens | 609,250 |
| estimated cost | ≈ $0.03 (at $0.042 / M input tokens, output free) |

The run recorded in the animation above is a production build with screen capture running
alongside (6.7 s, p50 114 ms, p95 333 ms).

For comparison, a 2 s-per-email LLM summarisation pass would take ~17 minutes sequentially, or
~80 s at the same concurrency, and needs a text-parsing step Jev does not.

### Keyword rules vs Jev

Press `b` to run the classic regex/keyword classifier over the same 500 emails
([`src/lib/rules.ts`](src/lib/rules.ts)). It agrees with Jev on all seven dimensions for ~84% of
emails; the "Rules ≠ Jev" lane lists the rest with the full email body so you can judge who is
right. The fixture includes 20 hand-written traps that keyword rules get wrong and Jev gets right,
for example:

- *"Not urgent at all, take your time… just kidding. Prod is down for all of our warehouses"* —
  rules: can wait a week, neutral; Jev: **Right now, Frustrated**.
- *"Question about my invoice (I'm NOT cancelling!)"* — 'cancel' three times; rules flag churn; Jev: churn 2%.
- A newsletter whose copy says *"cancel anytime, full refund"* — rules flag churn + refund; Jev: no.
- *"Password reset link goes to a blank page"* — 'password', 'link', 'verify' → rules flag phishing;
  Jev: legitimate **bug**, phishing 4%. Meanwhile *"[Final notice] Account suspension"* from
  `no-reply@micros0ft-secure.com` is phishing 99%.
- *"quick favor"* — CEO gift-card scam with zero phishing keywords; rules miss it, Jev: phishing 74%.
- *"URGENT: your security score dropped this week"* — a vendor's cold pitch; rules: urgent
  security; Jev: `spam_marketing`, urgency *can wait a week*.

## How it runs

```
browser (Vite + React 19)  ──/api/triage──▶  node server (tsx)  ──12 concurrent──▶  api.typesafe.ai
        ◀── NDJSON stream: one line per email as its judgment lands ──
```

- `server/index.ts` — `POST /api/triage` fans out one request per email with a 12-wide worker
  pool, streams `{type:"result", id, judgment, latencyMs, inputTokens}` lines back as they arrive,
  retries 429/529/5xx with exponential backoff + jitter (honouring `retry-after`), 6 s per-request
  timeout. The API key never leaves the server.
- `server/jev.ts` — typed question builders (`choice`, `noul`, `score`), the seven questions,
  request/response mapping.
- `src/useTriage.ts` — consumes the stream, batches UI updates every 50 ms, tracks live p50/p95.
- `src/lib/priority.ts` — priority score from raw judgments + slider weights; lane routing
  (priority / needs-human / FYI / spam); pure and unit-tested.
- `src/lib/rules.ts` — the keyword baseline and agreement/disagreement stats.
- `src/lib/stats.ts` — percentiles, throughput, token cost.
- `src/data/emails.ts` + `src/data/traps.ts` — deterministic generator (seed `20260917`) for 500
  synthetic emails: support bugs, billing, sales leads, vendor spam, newsletters, internal mail,
  security alerts, angry escalations, GDPR requests, phishing, threads with quoted history, and the
  20 traps. No real people, companies or addresses.

### Run it

```sh
cd inbox-blitz
npm ci
export TYPESAFE_API_KEY=...   # never shipped to the browser
npm run dev                   # server on :8787 + Vite on :5173, one command
```

Open http://localhost:5173 and press **Triage inbox** (or `Enter`).

Other commands:

```sh
npm run start        # production build + preview server + API server
MOCK=1 npm run dev   # replay recorded answers (UI shows a yellow MOCK badge); no key needed
RECORD_MOCK=1 npm run dev   # live run that also (re)writes server/mock-answers.json
npm run lint && npm run typecheck && npm test && npm run build
```

Keyboard: `j`/`k` or arrows move, `e` archive, `r` toggle reply-needed, `b` toggle keyword
rules, `Enter` start triage.

## Notes on question design

Wording was tuned against real API output on the trap fixtures. Changes that mattered:

- `urgency` explicitly says to ignore sarcastic framing and marketing pressure tactics — before
  that, "final notice" marketing scored as *Right now*.
- `is_phishing_or_scam`'s `false` criterion explicitly includes pushy/fear-based marketing and
  cold sales pitches from real companies — otherwise a legitimate security vendor's pitch was
  flagged as a scam.
- `mentions_churn_or_cancel` / `asks_for_refund` state that mentions in marketing copy or
  someone else's story do not count — that fixed the newsletter traps.
- `internal` names the company domain so a competitor's "we're switching" email is not
  classified as internal; `other` lists offboarding/export requests so they stop landing in
  `billing`.
- Phishing is surfaced at the top of the priority lane even though its category is
  `spam_marketing` — that is a policy decision in `priority.ts`, not something Jev decides.
