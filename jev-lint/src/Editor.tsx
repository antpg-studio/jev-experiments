// CodeMirror 6 wrapper. Markers become lint diagnostics (squiggles + gutter + hover),
// planted issues become line decorations when revealed.

import { useEffect, useRef, type RefObject } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { go } from "@codemirror/lang-go";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Language } from "./analysis.ts";
import type { Planted } from "./eval.ts";
import { KIND_LABEL, type Marker } from "./markers.ts";

function languageExtension(lang: Language): Extension {
  switch (lang) {
    case "typescript":
      return javascript({ typescript: true });
    case "python":
      return python();
    case "go":
      return go();
    case "rust":
      return rust();
    case "sql":
      return sql();
    case "bash":
      return StreamLanguage.define(shell);
  }
}

const setPlanted = StateEffect.define<Planted[]>();

const plantedField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setPlanted)) continue;
      const ranges = e.value
        .filter((p) => p.line >= 1 && p.line <= tr.state.doc.lines)
        .map((p) => Decoration.line({ class: "cm-planted", attributes: { title: `planted ${KIND_LABEL[p.kind]}: ${p.note}` } }).range(tr.state.doc.line(p.line).from));
      ranges.sort((a, b) => a.from - b.from);
      deco = Decoration.set(ranges);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: [tags.string, tags.special(tags.string)], color: "#9ad36a" },
  { tag: tags.comment, color: "#5c6773", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null], color: "#f7a35c" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#82aaff" },
  { tag: [tags.typeName, tags.className], color: "#ffd580" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: [tags.definition(tags.variableName), tags.propertyName], color: "#d8dee9" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13.5px", backgroundColor: "#0b0e14", color: "#d8dee9" },
    ".cm-scroller": { fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace', lineHeight: "1.55" },
    ".cm-content": { caretColor: "#7ee787", padding: "8px 0" },
    ".cm-cursor": { borderLeftColor: "#7ee787", borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: "#0b0e14", color: "#4b5563", border: "none", paddingRight: "4px" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#9ca3af" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(126,231,135,0.18) !important" },
    ".cm-planted": { boxShadow: "inset 3px 0 0 #f0c239", backgroundColor: "rgba(240,194,57,0.07)" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #ff5c5c 1.5px", textUnderlineOffset: "3px" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #f0c239 1.5px", textUnderlineOffset: "3px" },
    ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline dotted #58a6ff 1.5px", textUnderlineOffset: "3px" },
    ".cm-tooltip": { backgroundColor: "#141922", border: "1px solid #2a3140", color: "#d8dee9", borderRadius: "6px" },
    ".cm-tooltip-lint": { maxWidth: "440px" },
    ".cm-diagnostic": { borderLeft: "none", padding: "6px 10px" },
    ".cm-lint-marker-error": { content: 'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="%23ff5c5c"/></svg>\')' },
    ".cm-lint-marker-warning": { content: 'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="%23f0c239"/></svg>\')' },
    ".cm-lint-marker-info": { content: 'url(\'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="11" fill="%2358a6ff"/></svg>\')' },
  },
  { dark: true },
);

function renderHover(m: Marker): Node {
  const root = document.createElement("div");
  root.className = "hover";
  const head = document.createElement("div");
  head.className = `hover-head sev-${m.severity}`;
  head.textContent = `${m.severity.toUpperCase()} · ${m.source === "jev" ? "jev-latest" : "heuristic fallback"}`;
  root.appendChild(head);
  for (const k of m.kinds) {
    const row = document.createElement("div");
    row.className = "hover-row";
    const label = document.createElement("span");
    label.textContent = KIND_LABEL[k.kind];
    const bar = document.createElement("span");
    bar.className = "hover-bar";
    const fill = document.createElement("span");
    fill.style.width = `${Math.round(k.p * 100)}%`;
    fill.className = k.p >= 0.6 ? "hot" : "";
    bar.appendChild(fill);
    const pct = document.createElement("span");
    pct.className = "hover-pct";
    pct.textContent = `${Math.round(k.p * 100)}%`;
    row.append(label, bar, pct);
    root.appendChild(row);
  }
  if (m.severityProbabilities) {
    const sp = document.createElement("div");
    sp.className = "hover-sev";
    sp.textContent =
      "severity " +
      (["ignore", "info", "warning", "error"] as const).map((s) => `${s} ${Math.round((m.severityProbabilities?.[s] ?? 0) * 100)}%`).join(" · ");
    root.appendChild(sp);
  }
  if (m.source === "heuristic") {
    const msg = document.createElement("div");
    msg.className = "hover-sev";
    msg.textContent = m.message;
    root.appendChild(msg);
  }
  return root;
}

function toDiagnostics(state: EditorState, markers: Marker[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const m of markers) {
    if (m.line < 1 || m.line > state.doc.lines) continue;
    const line = state.doc.line(m.line);
    const lead = line.text.length - line.text.trimStart().length;
    const from = line.from + lead;
    const to = Math.max(from + 1, line.to);
    out.push({ from, to: Math.min(to, line.to), severity: m.severity, message: m.message, renderMessage: () => renderHover(m) });
  }
  return out;
}

export interface EditorProps {
  docId: string;
  language: Language;
  initialText: string;
  markers: Marker[];
  planted: Planted[] | null;
  onChange: (text: string) => void;
  viewRef: RefObject<EditorView | null>;
}

export function Editor({ docId, language, initialText, markers, planted, onChange, viewRef }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const langCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: initialText,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        langCompartment.current.of(languageExtension(language)),
        syntaxHighlighting(highlight),
        lintGutter({ hoverTime: 120 }),
        plantedField,
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // a new document id means a brand new editor state; language/initialText travel with it
  }, [docId]); // oxlint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, toDiagnostics(view.state, markers)));
  }, [markers, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setPlanted.of(planted ?? []) });
  }, [planted, viewRef, docId]);

  return <div className="editor" ref={host} />;
}
