/**
 * Sentence segmentation for the live-mic path. Speech recognisers return
 * chunks of text; we cut on terminal punctuation and hold back a trailing
 * fragment until more text arrives or the utterance is flushed.
 */
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|approx|q[1-4])\.$/i;

export interface Segmenter {
  /** Feed text; returns any sentences completed by it. */
  push(text: string): string[];
  /** Flush whatever is buffered as a final sentence (end of speech). */
  flush(): string[];
  readonly pending: string;
}

export function splitSentences(text: string): { complete: string[]; rest: string } {
  const complete: string[] = [];
  let buf = "";
  const tokens = text.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    buf = buf ? `${buf} ${tok}` : tok;
    const last = i === tokens.length - 1;
    const terminal = /[.!?]["')]?$/.test(buf);
    if (terminal && !ABBREVIATIONS.test(buf) && !last) {
      complete.push(buf.trim());
      buf = "";
    } else if (terminal && last && !ABBREVIATIONS.test(buf)) {
      complete.push(buf.trim());
      buf = "";
    }
  }
  return { complete: complete.filter(Boolean), rest: buf.trim() };
}

export function createSegmenter(minWords = 3): Segmenter {
  let pending = "";
  return {
    get pending() {
      return pending;
    },
    push(text: string) {
      const joined = `${pending} ${text}`.replace(/\s+/g, " ").trim();
      const { complete, rest } = splitSentences(joined);
      pending = rest;
      return complete.filter((s) => s.split(/\s+/).length >= minWords);
    },
    flush() {
      const s = pending.trim();
      pending = "";
      if (!s) return [];
      return [/[.!?]$/.test(s) ? s : `${s}.`];
    },
  };
}
