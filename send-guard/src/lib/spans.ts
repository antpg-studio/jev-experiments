import type { Span, SpanKind } from "./types";

const PATTERNS: Array<[SpanKind, RegExp]> = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["url", /https?:\/\/[^\s)]+/g],
  [
    "key",
    /\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[bap]-[A-Za-z0-9-]{10,}|\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(?:password|passwd|pwd|secret|token)\s*[:=]\s*\S{6,}/gi,
  ],
  ["phone", /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g],
  ["money", /(?:\$|€|£|USD\s?)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?[kKmM]\b)?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|USD|percent|%)/g],
  [
    "date",
    /\b(?:by|on|before|until|this|next|every)\s+(?:end of\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|tonight|week|month|quarter|EOD|EOW|Q[1-4](?:\s?\d{4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi,
  ],
];

const MAX_SPANS = 8;

/** Locate candidate culprit spans in code; Jev decides which ones are the problem. */
export function findSpans(draft: string): Span[] {
  const spans: Span[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of draft.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ id: "", kind, text: m[0], start, end });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans.slice(0, MAX_SPANS).map((s, i) => ({ ...s, id: `span_${i}` }));
}

/** What a classic regex-only DLP rule would flag: key-like tokens, emails and phone numbers. */
export function regexOnlyFlags(spans: Span[]): Span[] {
  return spans.filter((s) => s.kind === "key" || s.kind === "email" || s.kind === "phone");
}
