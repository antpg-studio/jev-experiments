#!/usr/bin/env python3
"""Point the @typesafe-ai/sdk clients at OpenRouter's Decisions API.

Three apps (turbo-rerank, agent-assist, log-sentinel) use the vendored SDK rather
than raw fetch. The SDK hardcodes the `/v1/systemone` path, so each needs two
structural edits that no rename rule can express:

  1. a module-level `openRouterFetch` wrapper that rewrites the outgoing path
  2. four extra options passed to `new TypeSafeClient({ ... })`

This is deliberately anchor-based rather than a patch file: it survives upstream
edits elsewhere in these files, and fails loudly (exit 1) the moment upstream
reshapes the client construction itself, which is exactly when a human should look.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TARGETS = [
    "turbo-rerank/server/jev.ts",
    "agent-assist/server/jev.ts",
    "log-sentinel/server/jev.ts",
]

# The sentinels let scripts/rules.sed skip this block wholesale. Without them a
# second rename pass would rewrite the `/v1/systemone` literal below into
# `/api/alpha/decisions`, quietly turning the path rewrite into a no-op.
BLOCK = '''/* openrouter-shim:begin */
/**
 * OpenRouter's Decisions API speaks the same protocol as TypeSafe's System One, at a different
 * path. The SDK hardcodes `/v1/systemone`, so rewrite it on the way out and keep the SDK's typed
 * question builders, retry policy and response parsing.
 */
const OPENROUTER_BASE_URL = "https://openrouter.ai";
const OPENROUTER_MODEL = "typesafe/jev-1.13";
const openRouterFetch: typeof fetch = (input, init) => {
  if (typeof input === "string" || input instanceof URL) {
    return fetch(String(input).replace("/v1/systemone", "/api/alpha/decisions"), init);
  }
  return fetch(input, init);
};
/* openrouter-shim:end */
'''

OPTIONS = [
    "apiKey: process.env.OPENROUTER_API_KEY,",
    "baseURL: OPENROUTER_BASE_URL,",
    "defaultModel: OPENROUTER_MODEL,",
    "fetch: openRouterFetch,",
]

CONSTRUCT = re.compile(r"new TypeSafeClient\(\{")


def fail(msg: str) -> None:
    print(f"sdk_override: FAIL {msg}", file=sys.stderr)
    sys.exit(1)


def insert_block(text: str) -> str:
    """Insert the wrapper directly above the lazily-constructed client.

    Anchoring on `let client` rather than the imports keeps the wrapper next to
    the thing it configures, and leaves any module constants above it untouched.
    """
    if "openRouterFetch" in text:
        return text  # already applied

    anchor = re.search(r"^let client\b", text, re.MULTILINE)
    if anchor:
        at = anchor.start()
        return text[:at] + BLOCK + "\n" + text[at:]

    imports = list(re.finditer(r"^import .*?;\s*$", text, re.MULTILINE))
    if not imports:
        fail("no `let client` or import statement found to anchor the wrapper block")
    at = imports[-1].end()
    rest = text[at:].lstrip("\n")
    return text[:at] + "\n\n" + BLOCK.rstrip("\n") + "\n\n" + rest


def insert_options(text: str, path: str) -> str:
    """Add the four client options to every `new TypeSafeClient({ ... })` call."""
    matches = list(CONSTRUCT.finditer(text))
    if not matches:
        fail(f"{path}: no `new TypeSafeClient({{` call found -- upstream reshaped the client")

    # Rewrite right-to-left so earlier offsets stay valid.
    for m in reversed(matches):
        head, tail = text[: m.end()], text[m.end() :]
        if tail.lstrip().startswith("apiKey: process.env.OPENROUTER_API_KEY"):
            continue  # already applied

        # Indentation of the line holding the construction, plus one level.
        line_start = head.rfind("\n") + 1
        indent = re.match(r"[ \t]*", text[line_start:]).group(0) + "  "
        rendered = "".join(f"\n{indent}{opt}" for opt in OPTIONS)

        # A single-line construction needs its body broken onto its own lines.
        close = tail.find("})")
        newline = tail.find("\n")
        if close != -1 and (newline == -1 or close < newline):
            body = tail[:close].strip().rstrip(",")
            rest = tail[close + 2 :]
            outer = indent[:-2]
            parts = [p.strip() for p in _split_top_level(body) if p.strip()]
            rendered += "".join(f"\n{indent}{p}," for p in parts)
            tail = f"{rendered}\n{outer}}})" + rest
            text = head + tail
        else:
            text = head + rendered + tail
    return text


def _split_top_level(body: str) -> list[str]:
    """Split `a: 1, b: { c: 2 }` on commas that are not nested."""
    parts, depth, cur = [], 0, ""
    for ch in body:
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    touched = 0
    for rel in TARGETS:
        path = root / rel
        if not path.exists():
            print(f"sdk_override: skip {rel} (gone from upstream)", file=sys.stderr)
            continue
        original = path.read_text()
        updated = insert_options(insert_block(original), rel)
        if updated != original:
            path.write_text(updated)
            touched += 1
        for needle in ("openRouterFetch", "OPENROUTER_BASE_URL", "baseURL: OPENROUTER_BASE_URL"):
            if needle not in updated:
                fail(f"{rel}: `{needle}` missing after transform")
        print(f"sdk_override: ok {rel}")
    print(f"sdk_override: {touched} file(s) changed")


if __name__ == "__main__":
    main()
