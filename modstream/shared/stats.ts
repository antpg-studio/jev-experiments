export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Fixed-capacity ring of recent numbers for rolling percentiles. */
export class Rolling {
  private buf: number[] = [];
  constructor(private readonly capacity: number) {}
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  values(): readonly number[] {
    return this.buf;
  }
  get size(): number {
    return this.buf.length;
  }
}
