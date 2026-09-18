# Testing Jev Launcher

## Clean install

```sh
git clone https://github.com/dabit3/private-experiments.git
cd private-experiments/jev-launcher
xcodebuild -version                      # Xcode 16+ (verified with 26.6 on macOS 26.5, ARM64)
brew install xcodegen                    # 2.46.0; only needed if you edit project.yml
xcodegen generate                        # regenerates JevLauncher.xcodeproj from project.yml
```

The generated `JevLauncher.xcodeproj` is committed, so `xcodegen` is optional for a plain build.

## Automated checks

All three must pass. None of the tests touch the network or read `TYPESAFE_API_KEY`.

```sh
xcodebuild -project JevLauncher.xcodeproj -scheme JevLauncher -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO build

xcodebuild -project JevLauncher.xcodeproj -scheme JevLauncher -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build CODE_SIGNING_ALLOWED=NO test
# expected: Executed 31 tests, with 0 failures

xcrun swift-format lint --strict --recursive Sources Tests
# expected: no output, exit 0
```

`xcodebuild test` prints a few `com.apple.linkd.autoShortcut` service warnings while launching the host app on macOS 26; they are harmless.

### What the unit tests cover

| File | Covers |
|---|---|
| `Tests/CalculatorTests.swift` | precedence, parentheses, `^`, unary minus, `sqrt`, `x` as multiply, `15% of 240` / `percent of` / `200 * 10%`, `calc` and `=` prefixes, original expression preserved for display, plain words and lone numbers rejected, number formatting |
| `Tests/RankingTests.swift` | fuzzy scoring (exact > prefix > subsequence, stopwords, word initials, subsequence contiguity); `Ranker.prefilter` adds the calculation and web-search candidates, respects the 13-candidate cap and returns nothing for an empty query; `Ranker.rank` is pure fuzzy without a judgment and follows Jev's target probability with one |
| `Tests/JevQuestionsTests.swift` | one request carries exactly the `target`, `action` and `ready` questions; candidate ids are `c0…cN` plus `none`; `state` encodes the query, note, context and candidate summaries; the 15-candidate cap; response parsing maps short ids back to real candidate ids, tolerates missing `action`/`ready`, returns nil without `target`; `timeOfDay` buckets |
| `Tests/StatsAndIndexTests.swift` | latency stats empty state, p50/p95 (nearest-rank), token totals and cost at $0.042/M input tokens, failure and stale counters, decisions/sec window, 500-sample cap; `LocalIndex.recency` phrasing; file candidates built from a temp directory (title, kind, subtitle, keywords); the nine system toggles are present; `Executor.wifiDevice` parses `networksetup -listallhardwareports` output |

## Manual verification (live Jev)

Requires `TYPESAFE_API_KEY` in the shell. Everything below was run on the VM; screenshots of each step are in `docs/`.

### 1. Fixtures

The PDF query needs several files of different ages to disambiguate. Create them once:

```sh
printf 'placeholder\n' > ~/Downloads/Q3-Roadmap-Review.pdf
printf 'placeholder\n' > ~/Downloads/invoice-2026-08.pdf   && touch -t 202608011200 ~/Downloads/invoice-2026-08.pdf
printf 'x' > ~/Downloads/xcode-installer.dmg               && touch -t 202609101200 ~/Downloads/xcode-installer.dmg
printf 'x' > ~/Downloads/screenshot-2026-09-17.png
printf 'placeholder\n' > ~/Desktop/Lease-Agreement.pdf     && touch -t 202607011200 ~/Desktop/Lease-Agreement.pdf
```

### 2. Launch

```sh
./run.sh --show
```

Expected: a translucent 680 pt-wide panel appears centred, slightly above the middle of the screen, with the placeholder `Say what you mean…`, five clickable example chips, `N apps, files and settings indexed` (85 on the VM) and `Jev · one judgment per keystroke` in the footer. `⌥Space` hides and shows it from any app. The menu bar shows a ⚡ item.

If the empty state says `TYPESAFE_API_KEY is not set — local matching only`, the key was not inherited; export it in the same shell or paste it in ⚡ → Settings….

Click a chip: the query fills in and the panel grows to fit the rows (56 pt each, at most seven) and shrinks again when the field is cleared.

### 3. The five queries

Type each query, wait for the leading `N ms` value in the footer to update, and check the top row.

| Query | Expected top row | Expected badge |
|---|---|---|
| `dark` | Toggle Dark Mode | green ↵, ≥ 90% |
| `wifi off` | Turn Wi-Fi Off above Turn Wi-Fi On | green ↵, ≥ 90% |
| `15% of 240` | `= 36` (orange `=` icon) | green ↵ |
| `the pdf I just downloaded` | `Q3-Roadmap-Review.pdf` (newest) above the other PDFs | green ↵ |
| `sleep` | Sleep | green ↵ |

The percentage on the right of each row is Jev's target probability; the selected row shows it in full, the others dimmed. A small blue dot at the right of the field is visible while a request is in flight; the header bolt turns green with the badge. `N decisions` increments once per keystroke and the leading latency settles around 100 ms after the first (TLS) request. At human typing speed the `(N stale)` count stays in single digits. Hover the footer for decisions/s and tokens per decision.

### 4. Enter executes

- `15% of 240` then ↵: panel hides, `pbpaste` prints `36`.
- `dark` then ↵: the first time, macOS prompts to allow Jev Launcher to control System Events; approve and the appearance flips. ↵ again flips it back.
- `wifi off` then ↵: Wi-Fi turns off (`networksetup -getairportpower en0` prints `Off`). `wifi on` then ↵ restores it.
- Any app row then ↵: the app activates.

Do not press ↵ on `sleep` or `Lock Screen` in a remote session unless you can wake the machine.

### 5. Failure handling (fuzzy fallback)

- `export TYPESAFE_API_KEY=invalid; ./run.sh --show`, type `dark`: rows appear in fuzzy order with no probabilities or badge, the footer shows `HTTP 401` in red, and the panel never stalls. Type `the pdf I just downloaded`: the two PDFs that tie on fuzzy score keep their index order, which is the difference Jev makes.
- Disconnect the network and type: same fuzzy fallback, footer shows the transport error instead. Once requests succeed again the footer returns to the latency line with `(N failed)` in the decision count.

## Permissions

| Feature | Permission | When prompted |
|---|---|---|
| Dark Mode, Sleep, Empty Trash | Automation → System Events / Finder (`NSAppleEventsUsageDescription`) | first execution of that toggle |
| Wi-Fi on/off | none on macOS 26; `networksetup` may ask for an admin password on some versions | on execution |
| Indexing `~/Downloads`, `~/Desktop`, `~/Documents` | none (app is unsandboxed); Desktop/Documents may prompt for folder access on first index | first panel show |
| ⌥Space hotkey | none (Carbon `RegisterEventHotKey`) | never |

No Accessibility, Screen Recording, or Full Disk Access is required. The VM user password (`MACOS_DEVIN_ADMIN_PASSWORD`) was not needed during verification.
