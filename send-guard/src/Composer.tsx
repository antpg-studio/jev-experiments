import { useRef } from "react";
import type { Span } from "./lib/types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  spans: Span[];
  culprits: Set<string>;
  regexOnly: boolean;
  regexFlagged: Set<string>;
  disabled: boolean;
  placeholder: string;
}

/** Textarea with a mirrored highlight layer underneath for inline underlines. */
export default function Composer({ value, onChange, spans, culprits, regexOnly, regexFlagged, disabled, placeholder }: Props) {
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

  return (
    <div className="composer">
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
        onScroll={() => {
          if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop;
        }}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        aria-label="Message draft"
      />
    </div>
  );
}
