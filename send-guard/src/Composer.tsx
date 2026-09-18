import { useRef } from "react";
import type { Span, Verdict } from "./lib/types";
import { Aa, At, Bold, Chevron, Code, CodeBlock, Emoji, Italic, Link, ListOl, ListUl, Mic, Plus, Quote, Send, Slash, Strike, Video } from "./Icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  spans: Span[];
  culprits: Set<string>;
  regexOnly: boolean;
  regexFlagged: Set<string>;
  disabled: boolean;
  placeholder: string;
  /** Guard state that drives the Send button. */
  verdict: Verdict;
  awaiting: boolean;
  canSend: boolean;
  reason: string;
  status: React.ReactNode;
}

const TOOLS = [Bold, Italic, Strike, null, Link, ListOl, ListUl, null, Quote, Code, CodeBlock] as const;

/** Slack-style message box: formatting bar, textarea with a mirrored underline layer, action row, Send. */
export default function Composer({
  value,
  onChange,
  onSend,
  spans,
  culprits,
  regexOnly,
  regexFlagged,
  disabled,
  placeholder,
  verdict,
  awaiting,
  canSend,
  reason,
  status,
}: Props) {
  const mirror = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const parts: Array<{ text: string; span?: Span; cls?: string }> = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) parts.push({ text: value.slice(cursor, s.start) });
    const flagged = regexOnly ? regexFlagged.has(s.id) : culprits.has(s.id);
    parts.push({ text: value.slice(s.start, s.end), span: s, cls: flagged ? "hl hl-bad" : "hl hl-candidate" });
    cursor = s.end;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });

  const empty = value.trim().length === 0;
  const state = empty ? "empty" : awaiting ? "pending" : verdict;
  const label = awaiting ? "Judging…" : verdict === "block" ? "Blocked" : verdict === "warn" ? "Send anyway" : "Send";

  return (
    <div className={`composer composer-${state}`}>
      <div className="fmt-bar">
        {TOOLS.map((T, i) =>
          T === null ? <span key={i} className="fmt-sep" /> : (
            <button key={i} className="icon-btn fmt" tabIndex={-1}>
              <T size={16} />
            </button>
          ),
        )}
      </div>

      <div className="editor">
        <div className="mirror" ref={mirror} aria-hidden>
          {parts.map((p, i) =>
            p.span ? (
              <mark key={i} className={p.cls} title={`${p.span.kind}: ${p.span.text}`}>
                {p.text}
              </mark>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
          {"\n"}
        </div>
        <textarea
          ref={ta}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          onScroll={() => {
            if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop;
          }}
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          aria-label="Message draft"
          rows={1}
        />
      </div>

      {!empty && (
        <div className={`guard-line guard-${state}`}>
          <span className="guard-reason">{awaiting ? "Jev is reading the current draft…" : reason}</span>
        </div>
      )}

      <div className="action-row">
        <button className="icon-btn action plus" tabIndex={-1}>
          <Plus size={16} />
        </button>
        <button className="icon-btn action" tabIndex={-1}>
          <Aa size={16} />
        </button>
        <button className="icon-btn action" tabIndex={-1}>
          <Emoji size={16} />
        </button>
        <button className="icon-btn action" tabIndex={-1}>
          <At size={16} />
        </button>
        <span className="fmt-sep" />
        <button className="icon-btn action" tabIndex={-1}>
          <Video size={16} />
        </button>
        <button className="icon-btn action" tabIndex={-1}>
          <Mic size={16} />
        </button>
        <span className="fmt-sep" />
        <button className="icon-btn action" tabIndex={-1}>
          <Slash size={16} />
        </button>
        <div className="status">{status}</div>
        <div className={`send-group send-${state}`}>
          <button className="send-btn" disabled={!canSend} onClick={onSend} title={empty ? "" : reason}>
            <span className="send-label">{label}</span>
            <Send size={16} />
          </button>
          <button className="send-more" disabled={!canSend} tabIndex={-1}>
            <Chevron size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
