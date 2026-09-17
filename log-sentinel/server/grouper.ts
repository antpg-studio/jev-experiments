/**
 * Joins multi-line events (stack traces, "Caused by:" chains, Python tracebacks) back into a single
 * event. Raw lines arrive one at a time; a line is a continuation when it is indented or matches one
 * of the well known trace prefixes. The pending head is flushed when a non-continuation line arrives,
 * or when `flush()` is called (the pipeline calls it on a short timer so the last event is not stuck).
 */
export interface RawLine<M> {
  text: string;
  meta: M;
}

export interface Grouped<M> {
  text: string;
  lines: number;
  meta: M;
}

const CONTINUATION = /^(\s+|Caused by:|\.\.\. \d+ more|Traceback \(most recent call last\)|[A-Za-z_$][\w$.]*(Exception|Error)(: |$))/;

export function isContinuation(line: string): boolean {
  return CONTINUATION.test(line);
}

export class LineGrouper<M> {
  private pending: Grouped<M> | null = null;

  feed(raw: RawLine<M>): Grouped<M> | null {
    if (this.pending && isContinuation(raw.text)) {
      this.pending.text += "\n" + raw.text;
      this.pending.lines += 1;
      return null;
    }
    const out = this.pending;
    this.pending = { text: raw.text, lines: 1, meta: raw.meta };
    return out;
  }

  flush(): Grouped<M> | null {
    const out = this.pending;
    this.pending = null;
    return out;
  }
}
