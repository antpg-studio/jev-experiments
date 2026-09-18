# Testing jev-shell-guard

## Clean install

```sh
git clone https://github.com/dabit3/private-experiments.git
cd private-experiments/jev-shell-guard
swift build -c release --product jevsh          # macOS 14+, Xcode 16+ CLT
export OPENROUTER_API_KEY=...                     # never committed; without it jevsh uses the regex fallback
./install.sh                                    # ~/.local/bin/jevsh, ~/.local/share/jevsh/jevsh.zsh, guarded line in ~/.zshrc
exec zsh
```

To try the hook without touching your real `~/.zshrc`, point the installer at a scratch file and
start a bare shell from it:

```sh
JEVSH_ZSHRC=/tmp/jevsh-zshrc ./install.sh
zsh -f -c 'export PATH=$HOME/.local/bin:$PATH; source /tmp/jevsh-zshrc; exec zsh -f'
```

## Deterministic verification (no network)

```sh
swift test                                                       # 25 tests
xcrun swift-format lint --strict --recursive Sources Tests Package.swift
swift build -c release --product jevsh
```

Automated tests (`Tests/JevShellGuardTests`):

- `StateBuilderTests` — quote-aware tokenisation; skipping `sudo`/`env`/`VAR=x` wrappers; path
  resolution and `exists`/`is_directory`/`is_home_or_root`/`inside_cwd` flags for `~`, `/`,
  relative, missing and glob paths; `--flag=value` and URL filtering; token-like argument
  detection; the JSON keys of the encoded state; question ids in the request; `.git/HEAD`
  parsing.
- `PolicyTests` — with fixture Jev answers: clean commands run, each Noul over its threshold
  confirms, reasons are sorted, destructive+wrong_target ≥ 0.90 blocks, a `block` verdict
  blocks, per-question thresholds and partial `config.json` decoding, response parsing
  (including a missing answer), the regex fallback's block/confirm/run cases, stats
  percentiles/means/cost, and banner text (reasons, latency, `jev offline`).

Nothing in the test target touches the network; `JevClient` is only exercised by the CLI.

## Offline behaviour without a key

```sh
env -u OPENROUTER_API_KEY jevsh explain 'rm -rf ~/'      # prints "jev offline (OPENROUTER_API_KEY is not set)" and the fallback block
env -u OPENROUTER_API_KEY jevsh check -- 'ls'; echo $?   # 0, no output
```

Deadline: `echo '{"deadline_ms": 1}' > ~/.config/jevsh/config.json`, then any `jevsh explain`
reports `deadline exceeded (1ms)` and the fallback decision. Remove the file afterwards.

## Live verification (needs OPENROUTER_API_KEY)

```sh
jevsh explain 'git push --force origin main'   # confirm: wrong_target + destructive over threshold
jevsh explain 'rm -rf ~/'                       # block
jevsh explain 'gti status'                      # confirm: likely_typo
jevsh explain 'rm -rf ./build'                  # run
jevsh bench                                     # 50 commands, p50/p95/mean latency, tokens, cost
jevsh bench --heuristic                         # same commands through the regex fallback only
jevsh stats                                     # summary of every real check since install
```

Interactive, in a shell with the hook sourced, inside a scratch git repo on `main` with an
uncommitted change and a `build/` directory:

| type | expect |
|---|---|
| `ls`, `git status`, `npm test` | run silently |
| `rm -rf ./build` | runs silently |
| `rm -rf ~/` | `✖ blocked …`, line cleared |
| `git push --force origin main` | `⚠ … [y/N]`; `n` leaves the line editable |
| `git reset --hard` | `⚠ destructive … [y/N]`; `y` runs it |
| `curl -H "Authorization: Bearer sk-live-…" …` | `⚠ leaks_secret … [y/N]` |
| `gti status` | `⚠ likely_typo … [y/N]` |
| `jevsh explain ...` | never judged by the hook |
| `JEVSH_DISABLE=1` exported | everything runs silently |

Exit codes of `jevsh check`: 0 run/confirmed, 1 declined, 3 blocked, 2 usage error.
