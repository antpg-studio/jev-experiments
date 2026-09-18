# Testing Jev Voice Turn

## Clean install

```sh
brew install xcodegen                 # 2.46.0
cd jev-voice-turn
xcodegen generate                     # regenerates JevVoiceTurn.xcodeproj from project.yml
```

## Automated checks

All three must pass; they need no API key and make no network calls.

```sh
xcrun swift-format lint --strict --recursive Sources Tests

xcodebuild -project JevVoiceTurn.xcodeproj -scheme JevVoiceTurn -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build

xcodebuild -project JevVoiceTurn.xcodeproj -scheme JevVoiceTurn -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO test
```

Expected: `** BUILD SUCCEEDED **`, `Executed 35 tests, with 0 failures`, and no lint output.

### What the unit tests cover

`Tests/TurnStateTests.swift`

- Snapshot builder: transcript, `ms_since_last_word`, word count, assistant state, and
  regex slot candidates (durations, rooms, contacts).
- State omits `assistant_is_saying` while listening; `is_barge_in` is only asked while
  speaking; slot questions appear only when candidates exist and always include `none`.
- Request body serializes to valid JSON with `model: typesafe/jev-1.13`.
- Partial-transcript merging keeps original word timestamps, applies recognizer
  revisions, and shrinks when the recognizer drops words.

`Tests/PolicyAndMathTests.swift`

- `TurnPolicy`: no fire without words; fire at `>= 0.85` only after the minimum pause;
  adjustable threshold; intermediate confidence falls back at the silence timeout;
  low confidence (`< 0.35`) waits for the 2.5× patient timeout; no answer falls back at
  the plain timeout; barge-in threshold; baseline fire-time arithmetic.
- `ResponseComposer`: slot selection follows intent; deterministic reply text.
- Timeline math: time-to-x mapping, step-function probability path, comparison
  aggregates (mean delays, saved time, cut-off count), empty-session handling, number
  formatting.
- `LatencyStats`: p50/p95, token totals, trailing-window decisions/second, failure and
  stale counts.
- `JevAnswers` parsing: full response with Noul/Choice/usage, unknown intent maps to
  `incomplete`, malformed JSON throws.
- Demo script: word timings are monotonic and realistic, the hesitation utterance
  contains a >1 s pause, and the script has a barge-in plus at least five plain
  utterances.

## Manual verification against live Jev

1. `export OPENROUTER_API_KEY=...` in the shell, build as above, and run
   `build/Build/Products/Debug/JevVoiceTurn.app/Contents/MacOS/JevVoiceTurn` from that
   shell (or paste the key into JevVoiceTurn > Settings).
2. The header must not show "OPENROUTER_API_KEY not set".
3. Leave **Simulated microphone** selected and press **Start**. The label under
   "Live transcript" reads "Simulated microphone: scripted transcript with realistic
   word timings".
4. Within ~4 s the first utterance ("set a timer for ten minutes") completes. Check:
   - the assistant card shows "Timer set for ten minutes." and speech plays;
   - the timeline shows a green **JEV FIRED** marker ~260–290 ms after the last word,
     an orange **SILENCE BASELINE** marker ~1000 ms after it, and a shaded "saved" band;
   - the Turns row shows `Set timer · ten minutes`, `p≈0.9`, and a negative saving.
5. Watch the hesitation utterance ("send a message to … Sarah saying I'm on my way",
   ~45 s in): the orange baseline marker appears during the 1.3 s pause while
   `turn_complete` stays below 0.1; Jev fires only after "way"; the row is tagged
   **BASELINE CUT OFF**.
6. Watch the interruption (~58 s in): the assistant starts "Turning the living room
   lights on", the speaker says "stop", a red **barge-in** marker appears, speech stops,
   and the previous row is tagged **BARGED**.
7. After the last utterance (~75 s) the comparison panel should read roughly: silence
   timeout 1000 ms vs Jev 300–400 ms mean delay, 8/1 fires/fallbacks, 1 barge-in,
   several seconds saved cumulatively; latency p50 ≈ 100 ms; stale/failed 0.
8. Flip **Jev endpointing** off and press Start again: every turn now fires at the
   silence baseline with `Silence baseline` as the source, no requests are sent, and the
   saving is ~0 (the 30 Hz policy clock adds a few ms of jitter).
9. Optional robustness check: run two instances at once to provoke HTTP 429. The header
   shows "Jev rate limited (HTTP 429): backing off, silence fallback active" and turns
   still complete via the silence fallback.

Live-microphone mode requires an audio input device and grants for Microphone and
Speech Recognition; it could not be exercised on the mic-less demo VM.
