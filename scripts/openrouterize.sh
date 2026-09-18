#!/usr/bin/env bash
# Turn a pristine dabit3/jev-experiments tree into this fork.
#
# Run from the repo root against a working tree that is already at upstream/main.
# Idempotent: running it twice is a no-op, so it is safe to run locally to preview
# what CI will push.
#
#   ./scripts/openrouterize.sh          # transform the current tree
#
# Stages, in order (order matters -- the overlay lands last so its intentional
# TypeSafe references survive the rename pass):
#   1. rename pass   scripts/rules.sed over every tracked text file
#   2. sdk overrides scripts/sdk_override.py for the three @typesafe-ai/sdk apps
#   3. overlay       scripts/overlay/* copied verbatim over the tree
#   4. verify        scripts/verify.sh fails if any upstream identifier survived

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
here="scripts"

# Never rewrite our own tooling: rules.sed and the overlay README contain the
# upstream identifiers on purpose.
is_excluded() {
  case "$1" in
    scripts/* | .github/* | README.md | CLAUDE.md) return 0 ;;
    *) return 1 ;;
  esac
}

echo "==> 1/4 rename pass"
renamed=0
while IFS= read -r f; do
  is_excluded "$f" && continue
  # Text files only; skip the committed PNGs and other binaries.
  grep -Iq . "$f" 2>/dev/null || continue
  before=$(cksum <"$f")
  sed -i.bak -f "$here/rules.sed" "$f" && rm -f "$f.bak"
  [ "$(cksum <"$f")" != "$before" ] && renamed=$((renamed + 1))
done < <(git ls-files)
echo "    $renamed file(s) rewritten"

echo "==> 2/4 sdk overrides"
python3 "$here/sdk_override.py" .

echo "==> 3/4 overlay"
if [ -d "$here/overlay" ]; then
  (cd "$here/overlay" && find . -type f -print0) | while IFS= read -r -d '' rel; do
    mkdir -p "$(dirname "${rel#./}")"
    cp "$here/overlay/${rel#./}" "${rel#./}"
    echo "    overlay ${rel#./}"
  done
fi

# swift-format is not available on ubuntu runners; normalise locally when it is,
# so the Swift line-length reflows match what Xcode's lint would want.
if command -v swift-format >/dev/null 2>&1; then
  echo "    swift-format available; normalising Swift sources"
  for d in jev-launcher jev-ax-pilot jev-voice-turn; do
    [ -d "$d/Sources" ] && swift-format format --in-place --recursive "$d/Sources" 2>/dev/null || true
  done
fi

echo "==> 4/4 verify"
"$here/verify.sh"

echo "done."
