export class SequenceGate {
  private next = 0;
  private painted = -1;
  private discarded = 0;

  issue(): number {
    return this.next++;
  }

  get latest(): number {
    return this.next - 1;
  }

  get paintedSeq(): number {
    return this.painted;
  }

  get discardedCount(): number {
    return this.discarded;
  }

  isStale(seq: number): boolean {
    return seq <= this.painted;
  }

  accept(seq: number): boolean {
    if (this.isStale(seq)) {
      this.discarded++;
      return false;
    }
    this.painted = seq;
    return true;
  }
}

export class LatencyStats {
  private samples: number[] = [];
  private readonly cap: number;
  last = 0;
  count = 0;

  constructor(cap = 200) {
    this.cap = cap;
  }

  push(ms: number) {
    this.last = ms;
    this.count++;
    this.samples.push(ms);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  percentile(p: number): number {
    if (!this.samples.length) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  get p50() {
    return this.percentile(50);
  }

  get p95() {
    return this.percentile(95);
  }

  get mean() {
    return this.samples.length ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length : 0;
  }
}

/**
 * Caps concurrent requests. When the cap is hit, only the newest request is
 * held back (older held requests are superseded, never sent) and it starts as
 * soon as a slot frees. A `start` callback may return false to decline the slot
 * (e.g. because its sequence went stale while waiting).
 */
export class InFlightLimiter {
  private active = 0;
  private held: (() => boolean) | null = null;
  private superseded = 0;

  constructor(readonly max: number) {}

  get inFlight(): number {
    return this.active;
  }

  get supersededCount(): number {
    return this.superseded;
  }

  run(start: () => boolean): boolean {
    if (this.active < this.max) {
      if (start()) this.active++;
      return true;
    }
    if (this.held) this.superseded++;
    this.held = start;
    return false;
  }

  done(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.held;
    this.held = null;
    if (next && next()) this.active++;
  }
}
