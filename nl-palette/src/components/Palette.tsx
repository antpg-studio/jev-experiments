import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, type Command } from "../shared/commands.ts";
import type { AppState } from "../shared/questions.ts";
import { CONFIDENCE_GATE, previewLabel, type RankedCommand } from "../shared/resolve.ts";
import { summarize } from "../shared/stats.ts";
import { usePalette } from "../lib/usePalette.ts";

export type Mode = "jev" | "fuzzy" | "both";

interface Pick {
  command: Command;
  arg?: string;
  needsConfirmation: boolean;
}

interface Props {
  appState: AppState;
  mode: Mode;
  onMode: (m: Mode) => void;
  onPick: (pick: Pick) => void;
  onClose: () => void;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function Palette({ appState, mode, onMode, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [explicitPick, setExplicitPick] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { result, pending, error, log } = usePalette(query, appState, true);

  useEffect(() => setExplicitPick(false), [result?.query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setCursor(0), [result?.query, mode]);

  const trimmed = query.trim();
  const jevList: RankedCommand[] = result?.jev?.ranked ?? [];
  const gate = result?.jev?.gate;
  const uncertain = gate === "uncertain";

  /** What Enter acts on. Empty query → the plain catalog. Fuzzy mode → fuzzy list. */
  const primary: Array<{ command: Command; arg?: string; probability?: number }> = useMemo(() => {
    if (!trimmed) return COMMANDS.slice(0, 12).map((command) => ({ command }));
    if (mode === "fuzzy") return (result?.fuzzy ?? []).slice(0, 8).map((f) => ({ command: f.command }));
    return (uncertain ? jevList.slice(0, 3) : jevList).map((r) => ({ command: r.command, arg: r.arg, probability: r.probability }));
  }, [trimmed, mode, result, uncertain, jevList]);

  const stale = result !== null && result.query !== trimmed;
  const latency = summarize(log.samples);

  function choose(i: number) {
    const item = primary[i];
    if (!item) return;
    onPick({ command: item.command, arg: item.arg, needsConfirmation: Boolean(result?.jev?.wantsConfirmation && mode !== "fuzzy" && trimmed) || Boolean(item.command.destructive) });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(primary.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (pending && !result) return;
      // Low confidence: Enter must be an explicit pick (arrow keys moved the cursor), not the default top item.
      if (uncertain && mode !== "fuzzy" && trimmed && !explicitPick) return;
      choose(cursor);
    } else if (e.key === "Tab") {
      e.preventDefault();
      onMode(mode === "jev" ? "both" : mode === "both" ? "fuzzy" : "jev");
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <span className="palette-icon">›</span>
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Describe what you want… e.g. “make this louder”, “hide the left thing”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") setExplicitPick(true);
              onKey(e);
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="mode-toggle" title="Tab cycles modes">
            {(["jev", "both", "fuzzy"] as Mode[]).map((m) => (
              <button key={m} className={m === mode ? "on" : ""} onClick={() => onMode(m)} type="button">
                {m === "jev" ? "Jev" : m === "both" ? "Side by side" : "Fuzzy only"}
              </button>
            ))}
          </div>
        </div>

        <div className="palette-status">
          {!trimmed ? (
            <span className="muted">{COMMANDS.length} commands · type a description, not a command name</span>
          ) : error ? (
            <span className="err">{error}</span>
          ) : result?.jev && mode !== "fuzzy" ? (
            <>
              <span className={`gate ${gate}`}>{gate === "confident" ? "confident" : "low confidence — pick one"}</span>
              <span className="muted">
                top {pct(result.jev.confidence)} · gate {CONFIDENCE_GATE}
                {result.jev.wantsConfirmation ? " · destructive → confirm" : ""}
              </span>
              <span className="lat">
                <b>{Math.round(result.clientMs)} ms</b> round trip · Jev {Math.round(result.jevMs)} ms · fuzzy {result.fuzzyMs.toFixed(2)} ms
                {result.mock ? <em className="mock"> MOCK</em> : null}
              </span>
            </>
          ) : result && mode === "fuzzy" ? (
            <span className="muted">
              fzf-style scoring on command titles · {result.fuzzy.length} match{result.fuzzy.length === 1 ? "" : "es"} · {result.fuzzyMs.toFixed(2)} ms
            </span>
          ) : (
            <span className="muted">thinking…</span>
          )}
          {pending ? <span className="spinner" aria-label="request in flight" /> : null}
        </div>

        <div className={`palette-columns ${mode === "both" ? "two" : ""} ${stale || pending ? "stale" : ""}`}>
          {mode !== "fuzzy" && (
            <ul className="results" role="listbox">
              {mode === "both" ? <li className="col-title">Jev · natural language</li> : null}
              {primary.length === 0 && trimmed && result && !pending ? <li className="empty">No result</li> : null}
              {primary.map((item, i) => {
                const hidden = uncertain && trimmed && i >= 3;
                if (hidden) return null;
                const isTop = i === 0 && trimmed && gate === "confident";
                return (
                  <li
                    key={item.command.id}
                    role="option"
                    aria-selected={i === cursor}
                    className={`row ${i === cursor ? "cursor" : ""} ${isTop ? "top" : ""} ${uncertain && trimmed ? "pickme" : ""}`}
                    onMouseEnter={() => {
                      setCursor(i);
                      setExplicitPick(true);
                    }}
                    onClick={() => choose(i)}
                  >
                    <span className="row-title">{trimmed ? previewLabel({ command: item.command, probability: item.probability ?? 0, arg: item.arg }) : item.command.title}</span>
                    <span className="row-group">{item.command.group}</span>
                    {item.probability !== undefined ? (
                      <span className="bar">
                        <span className="bar-fill" style={{ width: `${Math.max(2, item.probability * 100)}%` }} />
                        <span className="bar-label">{pct(item.probability)}</span>
                      </span>
                    ) : item.command.shortcut ? (
                      <kbd>{item.command.shortcut}</kbd>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {mode !== "jev" && trimmed && (
            <ul className={`results fuzzy ${mode === "fuzzy" ? "primary" : ""}`}>
              {mode === "both" ? <li className="col-title">Fuzzy · fzf-style</li> : null}
              {(result?.fuzzy ?? []).length === 0 ? <li className="empty">No fuzzy match — the words aren't in any command name</li> : null}
              {(result?.fuzzy ?? []).slice(0, 8).map((f, i) => (
                <li
                  key={f.command.id}
                  className={`row ${mode === "fuzzy" && i === cursor ? "cursor" : ""} ${i === 0 ? "top-fuzzy" : ""}`}
                  onMouseEnter={() => mode === "fuzzy" && setCursor(i)}
                  onClick={() => mode === "fuzzy" && choose(i)}
                >
                  <span className="row-title">{f.command.title}</span>
                  <span className="row-group">{f.command.group}</span>
                  <span className="score">score {f.score}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑↓</kbd> move · <kbd>↵</kbd> run · <kbd>Tab</kbd> mode · <kbd>Esc</kbd> close
          </span>
          <span className="muted">
            session: {latency.count} calls · mean {Math.round(latency.mean)} ms · p50 {Math.round(latency.p50)} · p95 {Math.round(latency.p95)} · {log.cancelled} cancelled stale
          </span>
        </div>
      </div>
    </div>
  );
}
