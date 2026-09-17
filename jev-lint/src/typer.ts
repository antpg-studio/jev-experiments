// "Type it for me": appends `snippet` to the end of the document one character at a
// time so judgments visibly land while a function is still being written.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface TyperOptions {
  charMs?: number;
  lineEndPauseMs?: number;
  onDone?: () => void;
}

export function typeIntoEditor(view: EditorView, snippet: string, opts: TyperOptions = {}): () => void {
  const charMs = opts.charMs ?? 38;
  const lineEndPauseMs = opts.lineEndPauseMs ?? 420;
  let stopped = false;
  let i = 0;
  const doc = view.state.doc.toString();
  const prefix = doc.length === 0 || doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  const text = prefix + snippet.replace(/\n+$/, "\n");
  const step = () => {
    if (stopped) return;
    if (i >= text.length) {
      opts.onDone?.();
      return;
    }
    const ch = text[i++];
    const at = view.state.doc.length;
    view.dispatch({ changes: { from: at, insert: ch }, selection: EditorSelection.cursor(at + 1), scrollIntoView: true });
    setTimeout(step, ch === "\n" ? lineEndPauseMs : charMs);
  };
  step();
  return () => {
    stopped = true;
  };
}
