# Jev experiments — OpenRouter edition

[![Built by Devin](assets/built-by-devin.svg)](https://www.devin.ai)

A fork of [dabit3/jev-experiments](https://github.com/dabit3/jev-experiments). **Same demos, different
connection:** every app here reaches Jev through [OpenRouter](https://openrouter.ai)'s Decisions API
instead of calling the [TypeSafe](https://docs.typesafe.ai/) API directly.

That is the only intended difference. If you are on the TypeSafe waitlist and don't have a
`TYPESAFE_API_KEY` yet, you can still run all of these with an OpenRouter key today.

## What changed versus upstream

| | Upstream | This fork |
| --- | --- | --- |
| Endpoint | TypeSafe System One | `POST https://openrouter.ai/api/alpha/decisions` |
| Env var | `TYPESAFE_API_KEY` | `OPENROUTER_API_KEY` |
| Model id | `jev-latest` | `typesafe/jev-1.13` |

The request shape is unchanged — `{ model, state, questions }` with `noul` / `choice` / `score`
questions, and the same typed answers with probabilities come back. The three apps that use
`@typesafe-ai/sdk` (`turbo-rerank`, `agent-assist`, `log-sentinel`) keep the SDK and pass a `fetch`
override that rewrites its hardcoded `/v1/systemone` path to `/api/alpha/decisions`.

Everything else — the apps, the UIs, the benchmarks, the policy-in-code and threshold-slider
behaviour, the `MOCK=1` paths — is upstream's.

## Getting a key

1. Sign up at [openrouter.ai](https://openrouter.ai) and create an API key.
2. `export OPENROUTER_API_KEY=...` in your shell. It is read from `process.env` server-side only and
   must never reach a browser bundle; each app's `.env.example` documents this.
3. No key yet? Most apps run offline with `MOCK=1 npm run dev`, which replays canned answers and
   shows a MOCK pill in the UI.

## Running the demos

Each app lives in its own top-level directory with its own README, TESTING.md and screenshots. There
is no workspace or monorepo tool — `cd` into an app first:

```sh
cd turbo-rerank && npm ci && npm run dev
```

The Swift apps (`jev-launcher`, `jev-ax-pilot`, `jev-voice-turn`, `jev-shell-guard`) build with
XcodeGen / SwiftPM; see each one's README.

## Staying in sync with upstream

This fork is a **build output, not a hand-edited repo**. `main` is always exactly
upstream's tree plus a scripted transform, so upstream renames can never produce a merge
conflict — there is nothing to merge.

[`.github/workflows/sync-upstream.yml`](.github/workflows/sync-upstream.yml) runs daily at
06:00 UTC (and on demand from the Actions tab). It resets to `dabit3/jev-experiments@main`,
re-applies the transform, typechecks the three SDK apps, and force-pushes. If anything
fails it opens an issue and leaves `main` on the last good sync.

The transform is four stages, in [`scripts/`](scripts/):

| Stage | What it does |
| --- | --- |
| [`rules.sed`](scripts/rules.sed) | The mechanical renames — ~123 of the ~128 changed files |
| [`sdk_override.py`](scripts/sdk_override.py) | The `openRouterFetch` wrapper for the three `@typesafe-ai/sdk` apps |
| [`overlay/`](scripts/overlay/) | Files that are ours outright: this README, `CLAUDE.md` |
| [`verify.sh`](scripts/verify.sh) | Fails the sync if any `TYPESAFE_*` identifier survived |

Run it yourself to preview what CI will push:

```sh
git fetch upstream && git checkout -B preview upstream/main
./scripts/openrouterize.sh          # idempotent; safe to re-run
```

**When a sync fails**, it is almost always one of two things, and the issue will say which:
upstream reshaped `new TypeSafeClient({ ... })` so `sdk_override.py` lost its anchor, or
upstream introduced a `TYPESAFE_*` name no rule covers yet. The second is a one-line fix in
`rules.sed`.

> **Enable Actions first.** GitHub disables workflows on forked repos by default. Open the
> Actions tab on this fork once and confirm, or the schedule will never fire.
