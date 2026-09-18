#!/usr/bin/env bash
# Build jevsh, install it to ~/.local/bin, and hook it into ~/.zshrc.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="${JEVSH_BIN_DIR:-$HOME/.local/bin}"
zshrc="${JEVSH_ZSHRC:-$HOME/.zshrc}"
share_dir="${JEVSH_SHARE_DIR:-$HOME/.local/share/jevsh}"

echo "building jevsh (swift build -c release)"
(cd "$here" && swift build -c release --product jevsh 2>&1 | tail -1)

mkdir -p "$bin_dir" "$share_dir"
cp "$here/.build/release/jevsh" "$bin_dir/jevsh"
cp "$here/jevsh.zsh" "$share_dir/jevsh.zsh"
echo "installed $bin_dir/jevsh and $share_dir/jevsh.zsh"

marker="# jevsh: Jev-judged shell guard"
if ! grep -qF "$marker" "$zshrc" 2>/dev/null; then
  {
    echo ""
    echo "$marker"
    echo "[[ -r \"$share_dir/jevsh.zsh\" ]] && source \"$share_dir/jevsh.zsh\""
  } >> "$zshrc"
  echo "appended guarded source line to $zshrc"
else
  echo "$zshrc already sources jevsh.zsh"
fi

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "note: add $bin_dir to PATH before the source line so the hook can find jevsh" ;;
esac
[[ -n "${TYPESAFE_API_KEY:-}" ]] || echo "note: export TYPESAFE_API_KEY in your shell; without it jevsh runs the regex fallback"
echo "open a new shell (or: source $zshrc) to activate"
