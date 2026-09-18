import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Benchmark } from "./components/Benchmark.tsx";
import { Palette, type Mode } from "./components/Palette.tsx";
import { execute, goToLine, initialState, openNote, renameNote, replaceAll, setSelection, setText } from "./editor/execute.ts";
import { activeNote, cursorPosition, exportText, outlineOf, renderMarkdown, toAppState, wordCount, type EditorState } from "./editor/model.ts";
import type { Command } from "./shared/commands.ts";

interface PendingConfirm {
  command: Command;
  arg?: string;
}

export function App() {
  const [state, setState] = useState<EditorState>(initialState);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("jev");
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [promptValue, setPromptValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const applySelection = useRef(false);

  const note = activeNote(state);
  const appState = useMemo(() => toAppState(state), [state]);

  const run = useCallback((id: string, arg?: string) => {
    applySelection.current = true;
    setState((s) => execute(s, id, arg));
  }, []);

  // Keyboard: Ctrl/Cmd+K opens the palette, Ctrl+B toggles sidebar, Ctrl+Z/Y undo/redo when not in textarea.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBenchOpen(false);
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "b" && !paletteOpen) {
        e.preventDefault();
        run("toggle_sidebar");
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p" && !paletteOpen) {
        e.preventDefault();
        run("toggle_preview");
      } else if (e.key === "Escape" && state.prompt) {
        setState((s) => ({ ...s, prompt: null }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, run, state.prompt]);

  // Side effects requested by the reducer (downloads, fullscreen) and selection sync after commands.
  useEffect(() => {
    const ta = textareaRef.current;
    if (applySelection.current && ta && !paletteOpen && !state.prompt) {
      applySelection.current = false;
      ta.focus();
      ta.setSelectionRange(state.selection.start, state.selection.end);
    }
    if (!state.effect) return;
    if (state.effect.kind === "download") {
      const { filename, mime, body } = exportText(state.effect.format, state.effect.title, state.effect.text);
      if (state.effect.format === "pdf") {
        const w = window.open("", "_blank");
        if (w) {
          w.document.write(body);
          w.document.close();
          w.focus();
          setTimeout(() => w.print(), 200);
        }
      } else {
        const url = URL.createObjectURL(new Blob([body], { type: mime }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } else if (state.effect.kind === "fullscreen") {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => undefined);
    }
    setState((s) => ({ ...s, effect: null }));
  }, [state.effect, state.selection, state.prompt, paletteOpen]);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => setState((s) => ({ ...s, toast: null })), 2200);
    return () => clearTimeout(t);
  }, [state.toast]);

  useEffect(() => {
    setPromptValue(state.prompt === "rename" ? note.title : "");
  }, [state.prompt, note.title]);

  function onPick(pick: { command: Command; arg?: string; needsConfirmation: boolean }) {
    setPaletteOpen(false);
    if (pick.needsConfirmation) setConfirm({ command: pick.command, arg: pick.arg });
    else run(pick.command.id, pick.arg);
  }

  const pos = cursorPosition(note.text, state.selection.start);
  const outline = outlineOf(note.text);
  const zenClass = state.zen ? "zen" : "";
  const fontClass = `font-${state.fontFamily}`;
  const editorStyle: React.CSSProperties = {
    fontSize: `${state.fontSize}px`,
    fontVariantLigatures: state.ligatures ? "normal" : "none",
  };
  const lineCount = note.text.split("\n").length;
  const highlightCount = findText ? note.text.split(findText).length - 1 : 0;

  return (
    <div className={`app theme-${state.theme} ${zenClass}`} style={{ zoom: state.zoom / 100 }}>
      {!state.zen && (
        <header className="topbar">
          <span className="brand">
            <span className="logo">NL</span> Palette <span className="muted">— natural-language commands, one Jev call per keystroke pause</span>
          </span>
          <div className="topbar-actions">
            <button className="ghost" onClick={() => setPaletteOpen(true)} type="button">
              Command palette <kbd>Ctrl K</kbd>
            </button>
            <button className="primary" onClick={() => setBenchOpen(true)} type="button">
              Benchmark
            </button>
          </div>
        </header>
      )}

      <div className="workspace">
        {state.sidebar && !state.zen && (
          <aside className="sidebar">
            <div className="side-title">Notes</div>
            {[...state.notes]
              .sort((a, b) => Number(b.pinned) - Number(a.pinned))
              .map((n) => (
                <button key={n.id} className={`note-row ${n.id === state.activeTab ? "active" : ""}`} onClick={() => setState((s) => openNote(s, n.id))} type="button">
                  {n.pinned ? <span className="pin">★</span> : <span className="pin dim">·</span>}
                  <span className="note-title">{n.title}</span>
                  <span className="muted small">{wordCount(n.text)}w</span>
                </button>
              ))}
            <div className="side-title">Settings</div>
            <div className="side-kv">
              <span>theme</span>
              <b>{state.theme.replace("_", " ")}</b>
              <span>font</span>
              <b>
                {state.fontSize}px {state.fontFamily}
              </b>
              <span>zoom</span>
              <b>{state.zoom}%</b>
              <span>wrap</span>
              <b>{state.wordWrap ? "on" : "off"}</b>
              <span>spell</span>
              <b>{state.spellCheck ? "on" : "off"}</b>
              <span>autosave</span>
              <b>{state.autosave ? "on" : "off"}</b>
              <span>ligatures</span>
              <b>{state.ligatures ? "on" : "off"}</b>
              <span>typewriter</span>
              <b>{state.typewriter ? "on" : "off"}</b>
            </div>
          </aside>
        )}

        <main className="editor-area">
          {!state.zen && (
            <div className="tabs">
              {state.tabs.map((id) => {
                const n = state.notes.find((x) => x.id === id);
                if (!n) return null;
                return (
                  <button key={id} className={`tab ${id === state.activeTab ? "active" : ""}`} onClick={() => setState((s) => openNote(s, id))} type="button">
                    {n.title}
                  </button>
                );
              })}
            </div>
          )}

          {state.prompt && (
            <form
              className="prompt"
              onSubmit={(e) => {
                e.preventDefault();
                if (state.prompt === "find_replace") setState((s) => replaceAll(s, findText, replaceText));
                else if (state.prompt === "go_to_line") setState((s) => goToLine(s, Number(promptValue) || 1));
                else if (state.prompt === "rename") setState((s) => renameNote(s, promptValue));
                else setState((s) => ({ ...s, prompt: null }));
                applySelection.current = true;
              }}
            >
              {(state.prompt === "find" || state.prompt === "find_replace") && (
                <>
                  <input autoFocus placeholder="Find" value={findText} onChange={(e) => setFindText(e.target.value)} />
                  <span className="muted small">{highlightCount} match{highlightCount === 1 ? "" : "es"}</span>
                </>
              )}
              {state.prompt === "find_replace" && (
                <>
                  <input placeholder="Replace with" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
                  <button type="submit">Replace all</button>
                </>
              )}
              {state.prompt === "go_to_line" && (
                <>
                  <input autoFocus type="number" min={1} max={lineCount} placeholder={`Line 1–${lineCount}`} value={promptValue} onChange={(e) => setPromptValue(e.target.value)} />
                  <button type="submit">Go</button>
                </>
              )}
              {state.prompt === "rename" && (
                <>
                  <input autoFocus placeholder="Note title" value={promptValue} onChange={(e) => setPromptValue(e.target.value)} />
                  <button type="submit">Rename</button>
                </>
              )}
              <button type="button" className="ghost" onClick={() => setState((s) => ({ ...s, prompt: null }))}>
                Close
              </button>
            </form>
          )}

          <div className={`panes ${state.preview ? "with-preview" : ""} ${state.split ? "split" : ""}`}>
            {Array.from({ length: state.split ? 2 : 1 }, (_, i) => (
              <div className={`editor ${fontClass} ${state.typewriter ? "typewriter" : ""}`} key={i} style={editorStyle}>
                {state.lineNumbers && (
                  <div className="gutter" aria-hidden>
                    {Array.from({ length: lineCount }, (_, k) => (
                      <div key={k} className={k + 1 === pos.line ? "cur" : ""}>
                        {k + 1}
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={i === 0 ? textareaRef : undefined}
                  className={state.wordWrap ? "" : "nowrap"}
                  value={note.text}
                  spellCheck={state.spellCheck}
                  wrap={state.wordWrap ? "soft" : "off"}
                  onChange={(e) => setState((s) => setText(s, e.target.value, { start: e.target.selectionStart, end: e.target.selectionEnd }))}
                  onSelect={(e) => {
                    const t = e.currentTarget;
                    setState((s) => setSelection(s, { start: t.selectionStart, end: t.selectionEnd }));
                  }}
                />
                {state.minimap && (
                  <div className="minimap" aria-hidden>
                    {note.text.split("\n").map((l, k) => (
                      <div key={k} style={{ width: `${Math.min(100, l.length * 1.2)}%`, opacity: l.startsWith("#") ? 1 : 0.5 }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {state.preview && <article className="preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.text) }} />}
          </div>

          {state.statusBar && (
            <footer className="statusbar">
              <span>
                Ln {pos.line}, Col {pos.col}
              </span>
              <span>{state.selection.end > state.selection.start ? `${state.selection.end - state.selection.start} selected` : "no selection"}</span>
              <span>{wordCount(note.text)} words</span>
              <span>Markdown</span>
              <span className="grow" />
              <span>{state.autosave ? "autosave" : "manual save"}</span>
              <span>{state.spellCheck ? "spell ✓" : "spell ✗"}</span>
              <span>{state.zoom}%</span>
            </footer>
          )}
        </main>

        {state.outline && !state.zen && (
          <aside className="outline">
            <div className="side-title">Outline</div>
            {outline.length === 0 ? <div className="muted small">No headings</div> : null}
            {outline.map((h, i) => (
              <button key={i} className="outline-row" style={{ paddingLeft: `${8 + (h.level - 1) * 12}px` }} onClick={() => setState((s) => goToLine(s, h.line))} type="button">
                <span className="muted">H{h.level}</span> {h.title}
              </button>
            ))}
          </aside>
        )}
      </div>

      {state.toast && <div className="toast">{state.toast}</div>}

      {paletteOpen && <Palette appState={appState} mode={mode} onMode={setMode} onPick={onPick} onClose={() => setPaletteOpen(false)} />}
      {benchOpen && <Benchmark appState={appState} onClose={() => setBenchOpen(false)} />}

      {confirm && (
        <div className="palette-backdrop" onMouseDown={() => setConfirm(null)}>
          <div className="confirm" onMouseDown={(e) => e.stopPropagation()}>
            <h3>Run “{confirm.command.title}”?</h3>
            <p className="muted">{confirm.command.description}</p>
            <p className="muted small">Jev flagged this as destructive (or the command is marked destructive), so the palette asks before running it.</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                autoFocus
                onClick={() => {
                  run(confirm.command.id, confirm.arg);
                  setConfirm(null);
                }}
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
