#!/usr/bin/env bash
# Fail if any upstream TypeSafe-API identifier survived the transform.
#
# This is the guard that makes the force-push safe: a silent miss here would ship
# a demo that reads an env var nobody has set.
#
# Deliberately uses `grep -r` over the working tree rather than `git grep`.
# git grep only searches tracked files, so it silently skips a freshly written
# overlay and can report success on a tree it never actually looked at.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

# scripts/ holds the rules themselves; README.md documents the upstream->fork
# mapping in a table; CLAUDE.md explains the /v1/systemone rewrite. All three
# contain these strings on purpose.
scan() {
  grep -rnI \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=scripts \
    --exclude-dir=.github --exclude-dir=build --exclude-dir=dist \
    --exclude=README.md --exclude=CLAUDE.md \
    -e "$1" . 2>/dev/null || true
}

fail=0
while IFS='|' read -r label pattern; do
  [ -z "$label" ] && continue
  hits=$(scan "$pattern")
  if [ -n "$hits" ]; then
    echo "verify: FAIL $label still present:" >&2
    echo "$hits" | sed 's/^/  /' >&2
    fail=1
  fi
done <<'PATTERNS'
TYPESAFE_API_KEY|TYPESAFE_API_KEY
TYPESAFE_BASE_URL|TYPESAFE_BASE_URL
TYPESAFE_ENDPOINT|TYPESAFE_ENDPOINT
TYPESAFE_MODEL|TYPESAFE_MODEL
model id jev-latest|jev-latest
api.typesafe.ai host|api\.typesafe\.ai
PATTERNS

# Catch-all: any TYPESAFE_* env var, or any typesafe.ai host other than the docs
# site, that no rename rule covers yet. This is what turns "upstream added a new
# variable" from a silent miss into a failed sync with the name in the log.
unknown=$(scan 'TYPESAFE_[A-Z0-9_]\{1,\}')
if [ -n "$unknown" ]; then
  echo "verify: FAIL unrecognised TYPESAFE_* identifier; add a rule to scripts/rules.sed:" >&2
  echo "$unknown" | sed 's/^/  /' >&2
  fail=1
fi

host=$(scan '[a-z0-9-]\{1,\}\.typesafe\.ai' | grep -v 'docs\.typesafe\.ai' || true)
if [ -n "$host" ]; then
  echo "verify: FAIL non-docs typesafe.ai host still referenced:" >&2
  echo "$host" | sed 's/^/  /' >&2
  fail=1
fi

# The SDK path may only appear inside the rewrite wrapper that puts it there.
stray=$(scan '/v1/systemone' | grep -v 'replace("/v1/systemone"' | grep -v 'hardcodes `/v1/systemone`' || true)
if [ -n "$stray" ]; then
  echo "verify: FAIL /v1/systemone used outside the rewrite wrapper:" >&2
  echo "$stray" | sed 's/^/  /' >&2
  fail=1
fi

# Positive checks: prove the transform actually ran, so an empty or broken
# rename pass cannot masquerade as a clean tree.
for needle in 'openrouter.ai/api/alpha/decisions' 'OPENROUTER_API_KEY'; do
  if [ -z "$(scan "$needle")" ]; then
    echo "verify: FAIL expected '$needle' somewhere in the tree; did the transform run?" >&2
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "verify: ok"
else
  echo "verify: FAILED -- do not push this tree" >&2
fi
exit "$fail"
