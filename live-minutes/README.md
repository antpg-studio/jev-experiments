# Fern (folder `live-minutes`)

**Meeting notes that write themselves as you talk — who owns what by when, as it is said.**

![Fern after a full 4× replay of the standup](screenshots/live-minutes.jpg)

![Live replay: action items, decisions, questions and risks appearing ~150 ms after each utterance](screenshots/live-minutes-demo.webp)

## The problem

Meeting-notes tools produce action items *minutes after the call ends*: they wait for the full
transcript, run one big summarisation prompt, then parse the prose. By the time "Marcus owns the
rounding write-up by tomorrow" shows up, Marcus has left the call and nobody can say "no, Sofia
took that".

Fern judges **every finished sentence as it is spoken**. Each utterance becomes one
[TypeSafe](https://typesafe.ai) Jev request that answers seven independent questions at once,
and the card lands in the Action items / Decisions / Open questions / Risks list about **150 ms
after the sentence ends** — while the speaker is still talking, so people can correct it in the room.

Why latency matters here: the value of an extracted action item decays with the distance from the
moment it was said. Inside ~200 ms it is a shared artefact the room can react to ("that's not what
I meant", click the *Who owns this?* chip to fix the owner). Ten minutes later it is a diff somebody reviews alone.

## What is on screen

Deliberately little. One centred column with four elements, in the order a person in the room needs
them:

1. **The meeting** — title, who is here, date, one *Start meeting* button (replay speed and the live-mic
   switch sit quietly next to it).
2. **The notes** — a single chronological feed. Each card is one thing worth writing down: *To do* /
   *Decided* / *Open question* / *Risk*, the sentence as said, the owner (or an amber **Who owns this?**
   chip when Jev is not confident — click it to see the probability over attendees and fix it), the
   resolved due date, *Blocked* when relevant, and a small measured **end-of-sentence → on-screen** time.
   A decision that gets reversed is struck through and relabelled *Reversed*.
3. **One line of numbers** — notes, sentences judged, p50 (p95) end-of-sentence → on-screen, and whether
   the answers came from TypeSafe Jev or the mock file. Every number is measured.
4. **A caption strip** — what is being said right now and what Jev called it. A subtitle, not a transcript.

Everything also has a key binding:

| key | action |
|---|---|
| `s` | start / stop |
| `x` | reset |
| `r` / `m` | replay / live mic |
| `1` / `4` / `a` | 1× / 4× / all at once |

The "old way" baselines (post-meeting summary timer, keyword heuristic and its miss rate) are no longer
on screen; the keyword baseline still lives in `src/lib/keyword.ts` and is reported by `npm run eval`.

### Input modes

- **Replay** — a seeded, hand-written 12-minute, 4-person product standup (180 utterances: tangents, jokes, a
  half-decision that gets reversed, "I'll take that" without a name, "end of next sprint", a blocker on
  infra). Play at **1×**, **4×**, or **all at once** (180 parallel requests through a concurrency limiter).
- **Live mic** — Chrome's Web Speech API. Interim text is shown in the caption strip, sentences are segmented
  in code (`src/lib/segment.ts`), and each complete sentence is judged. If the browser has no speech
  recognition the button explains why and Replay stays available.

## How Jev is used

One request per utterance (`server/jev.ts`), state:

```jsonc
{
  "today": "2026-09-17 (Thursday)",
  "current_sprint_ends": "2026-09-25",
  "launch_date": "2026-10-01",
  "attendees": [{ "name": "Priya Nair", "role": "Engineering Manager" }, ...],
  "speaker": "Priya Nair",
  "previous_3_utterances": [{ "speaker": "...", "text": "..." }, ...],
  "recent_decisions": ["..."],
  "utterance": "Marcus, can you write up the rounding discrepancy and send it to finance before end of day tomorrow?"
}
```

and seven questions fanned out in that single call:

| id | type | question |
|---|---|---|
| `kind` | choice | `action_item` / `decision` / `open_question` / `risk` / `status_update` / `chit_chat`, with explicit tie-breaks (accepting assigned work is an action item; an un-agreed proposal is a status update; bare agreement is chit-chat). |
| `assignee` | choice | each attendee by name + `speaker_themself` + `unassigned`. `speaker_themself` is resolved to the speaker in code. |
| `has_deadline` | noul | does the utterance set a due date *for the work* (dates mentioned as content don't count)? |
| `deadline_kind` | choice | `specific_date` / `this_week` / `next_sprint` / `before_launch` / `end_of_quarter` / `none` — resolved to a real date **in code** (`src/lib/deadline.ts`: weekday names, "tomorrow", "the 24th", "October 1st", sprint end, launch date, quarter end). |
| `reverses_earlier_decision` | noul | does this utterance itself undo a decision in `recent_decisions`? |
| `is_blocked` | noul | is the work stuck *right now* on another team / vendor / approval? |
| `importance` | score | 4-level legend, trivial → critical. |

Jev supplies only these judgments. Sentence segmentation, date arithmetic, owner resolution,
decision supersession, confidence gating (owner confidence < 0.6 → `?` chip), aggregation and all
metrics are plain TypeScript. The API key lives only in the Node proxy (`server/index.ts`), which
adds a 6 s per-attempt timeout and exponential backoff on 429 / 529 / 5xx.

## Run

Requires Node 22+ (uses `--experimental-strip-types`) and `TYPESAFE_API_KEY` in the environment.

```sh
cd live-minutes
npm ci
TYPESAFE_API_KEY=... npm run dev     # proxy on :8787 + Vite on :5173, one command
```

Open http://localhost:5173, press `4` then `s` (or click **[4×]** and **▶ start**).

- `MOCK=1 npm run dev` replays recorded answers from `server/mock-answers.json` (no key needed). The header
  badge turns amber and reads **MOCK · recorded answers**.
- `npm run eval` runs all 180 utterances against the real API at concurrency 12 and prints latency and
  accuracy against the fixture's ground truth. `npm run eval -- --write-mock` refreshes the mock recording.
- `npm test` · `npm run lint` · `npm run typecheck` · `npm run build`

## Measured

Real TypeSafe API (`jev-latest`), Linux VM, 2026-09-17. Fixture: 180 utterances, 50 labelled action items.

**Browser, 4× replay (screenshot above)**

| metric | value |
|---|---|
| items surfaced live | 116 of 180 utterances (49 action items, 12 decisions, 23 questions, 32 risks) |
| end-of-utterance → on-screen, p50 | **131 ms** |
| end-of-utterance → on-screen, p95 | 484 ms |
| browser round-trip p50 | 116 ms |
| Jev API time p50 (server-side) | 107 ms |
| errors | 0 |

**Browser, all at once** (180 requests, concurrency 12): 180 judged in 9.1 s (19.9 utt/s), 0 errors. The
→ screen latency then includes queueing behind the limiter, so it is reported but not the headline.

**`npm run eval`, accuracy vs. ground truth**

| metric | value |
|---|---|
| Jev latency p50 / p95 / max | 121 ms / 352 ms / 1.17 s |
| `kind` accuracy | 88.3 % (159/180) |
| action-item recall / precision | 96.0 % / 92.3 % |
| owner correct (action items) | 96.0 % (48/50) |
| deadline kind correct (action items) | 98.0 % (49/50) |
| reversal detection | 98.9 % (178/180) |
| blocked detection | 97.8 % (176/180) |
| **keyword heuristic**: action items missed | **40 %** (20/50), 9 false positives, precision 77 % |

Remaining `kind` confusions are mostly chit-chat ↔ status update on filler like "Sounds good, that's
enough for today" — none of them surface on the right-hand side.

## Layout of the code

```
server/index.ts      node:http proxy — /api/health, /api/judge, MOCK=1
server/jev.ts        state + question builders, retry/backoff, timings
scripts/dev.ts       spawns proxy + Vite
scripts/eval.ts      real-API evaluation against the labelled fixture
src/data/transcript.ts  the 180-utterance fixture with ground truth
src/lib/segment.ts   sentence segmentation for live mic
src/lib/deadline.ts  deadline_kind → date, in code
src/lib/resolve.ts   Jev answers → Judgment, confidence gating
src/lib/aggregate.ts lists, supersession, owner fixes, latency per item
src/lib/keyword.ts   the keyword baseline
src/lib/useMeeting.ts replay / mic orchestration, concurrency limit, metrics
src/components/*     Header, Notes, NoteCard, Pulse, Caption
```
