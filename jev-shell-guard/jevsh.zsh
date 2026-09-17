# jevsh.zsh — ask Jev before every command runs.
# Sourced from ~/.zshrc by install.sh. Set JEVSH_DISABLE=1 to bypass for a session.

(( ${+commands[jevsh]} )) || return 0

_jevsh_accept_line() {
  if [[ -n "$JEVSH_DISABLE" || -z "${BUFFER//[[:space:]]/}" ]]; then
    zle .accept-line
    return
  fi

  # Program name of the first simple command, skipping wrappers and VAR=value prefixes;
  # only the shell knows about aliases and functions, so resolve it here.
  local -a words
  words=(${(z)BUFFER})
  while (( $#words )) && [[ "$words[1]" == (sudo|env|time|nohup|command|builtin|exec) || "$words[1]" == *=* ]]; do
    shift words
  done
  if [[ "$words[1]" == jevsh ]]; then
    zle .accept-line
    return
  fi
  local tool_found=0
  whence -w -- "$words[1]" &>/dev/null && tool_found=1

  local prev
  prev=$(fc -ln -3 -1 2>/dev/null)

  # No `zle -I` up front: on `run` nothing is printed and the line must not be redrawn.
  # jevsh itself moves below the command line (JEVSH_ZLE) before printing a banner.
  JEVSH_ZLE=1 jevsh check --prev "$prev" --tool-found "$tool_found" --cwd "$PWD" -- "$BUFFER" </dev/tty
  case $? in
    0) zle .accept-line ;;
    3) print -s -- "$BUFFER"; BUFFER=""; zle -I; zle reset-prompt ;;  # blocked: keep in history, clear line
    *) zle -I; zle reset-prompt ;;                                    # declined: leave the line to edit
  esac
}

zle -N accept-line _jevsh_accept_line
