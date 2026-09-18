# Jev AX Pilot — verification

## Clean install and deterministic checks

macOS 14+ with Xcode 16+ and XcodeGen 2.46.0 (`brew install xcodegen`). Nothing else is needed for
the build, the unit tests or lint; none of them touch the network or need the API key.

```sh
cd jev-ax-pilot
xcodegen generate            # regenerates JevAXPilot.xcodeproj from project.yml (already committed)
xcodebuild -project JevAXPilot.xcodeproj -scheme JevAXPilot -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
xcodebuild -project JevAXPilot.xcodeproj -scheme JevAXPilot -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO test
xcrun swift-format lint --strict --recursive Sources Tests
```

Expected: `BUILD SUCCEEDED`, `TEST SUCCEEDED` with 41 tests and 0 failures, and no lint output.

## Automated coverage (`Tests/`, 41 tests, no network)

The tests run against five recorded Accessibility trees in `Tests/Fixtures/` (Notes, System
Settings > General, Calculator, Safari start page, TextEdit), captured on macOS 26.5 with a
small dump tool that serialised the same `AXSnapshot` model the app uses. Each fixture is the
complete tree the app would see, so the flattener, state builder and answer handler run on real
data with no AX API or model calls.

`TreeFlattenerTests`
- Calculator keeps every keypad button, prunes disabled elements, flags the `Delete` key destructive.
- Ids are sequential and unique; the cap keeps goal-relevant elements first.
- System Settings sidebar rows get labels derived from their static text children.
- TextEdit reports the focused text area with its value; Safari's menu items are limited to goal-relevant ones.
- Disabled and zero-sized elements are pruned; a modal sheet hides the elements behind it.
- Destructive detection is word-based and honours goals that name the operation; role shortening and text cleaning.

`StateAndAnswerTests`
- Text candidates: quoted spans first, "titled X" / "type X" spans, URLs, app-name detection, arithmetic evaluated in code for every preset goal.
- State JSON contains elements, facts and history; questions are batched and their options match the element ids; the `text` question appears only with several candidates; request encodes to the documented TypeSafe shape and the response decodes.
- Answer handling: chosen element is pressed; `goal_reached` above threshold finishes; typing happens only when Jev's choice is `type_text` or the focused input; `done` without `goal_reached` waits then falls back; a low-confidence `done` presses the runner-up element; create/new goals cannot finish before an action; repeated key or element switches to the fallback; already-typed text is not retyped; arithmetic goes in as keystrokes when the app has no text input and the fallback finishes once the code-computed result is visible; `key` answer is honoured; low confidence and unknown choices fall back.
- Safety: a destructive element is blocked even when Jev chooses it; Jev's `is_destructive` above 0.5 blocks unless the goal names the operation; the fallback never picks a destructive element (checked on every fixture).
- Metrics: percentiles, tokens, cost and the empty state.

## Live verification (what was run before the PR)

Prerequisites: `TYPESAFE_API_KEY` in the environment and Accessibility granted to the app (see the
README section on permissions and the VM limitation).

1. Launch the built app with `JEV_AX_PILOT_TRACE=1` so every step's flattened state and decision go
   to stderr.
2. Quit the target app so it starts from a clean state (Calculator: press `C` twice first, it
   restores the last expression).
3. Click one preset. Expected end states, all observed in the recorded runs (`docs/`):
   - Calculator: display shows `48×12` then `576`; 7 steps (`4 8 × 1 2 =` then `done`).
   - TextEdit: new document containing `Hello from Jev`; 2 steps.
   - Safari: a new tab on `typesafe.ai`; 4 steps (New Tab, type, Return, done).
   - Notes: a note titled `Grocery list` in the list; 5 steps (dismisses the welcome sheet and the
     iCloud prompt on the way).
   - System Settings: Appearance set to Dark, `defaults read -g AppleInterfaceStyle` prints `Dark`;
     4 steps, one of which was a fallback after an API 429.
4. The HUD's LAST / P50 / P95 values should stay around 100 ms; the step log shows per-step latency
   and marks `fallback` decisions.
5. Switch Mode to "Simulated 3 s LLM" and rerun TextEdit: same decisions, steps/sec drops from
   ~0.6 to ~0.13. "Heuristic only" runs the fallback with no requests; on Calculator it types
   `48*12` + Return and finishes in 2 steps.
6. Press Stop or Escape mid-run: the loop ends with status "Stopped" and the highlight disappears.

## Known limitations

- Accessibility permission could not be granted to the app bundle through System Settings on the
  automated VM; live runs used a shell with inherited trust. The in-app panel and Re-check button
  were verified by launching the app without trust (`docs/permission-panel.png`).
- Only the five presets were exercised end to end; custom goals use the same machinery but rely on
  the heuristic text-candidate extraction.
- Unit tests do not cover `AXReader` (needs live AX) or the SwiftUI views.
