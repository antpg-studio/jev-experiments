/** Tiny FIFO concurrency limiter; `limit` can be changed at runtime. */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private limit: number) {}

  get inFlight(): number {
    return this.active;
  }
  get queued(): number {
    return this.waiting.length;
  }
  get concurrency(): number {
    return this.limit;
  }

  setLimit(n: number): void {
    this.limit = Math.max(1, Math.floor(n));
    this.drain();
  }

  /** Resolves once a slot is free; returns the ms spent waiting. */
  acquire(): Promise<number> {
    const t0 = performance.now();
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(0);
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active++;
        resolve(performance.now() - t0);
      });
    });
  }

  release(): void {
    this.active--;
    this.drain();
  }

  private drain(): void {
    while (this.active < this.limit && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (next) next();
    }
  }

  async run<T>(fn: (queuedMs: number) => Promise<T>): Promise<T> {
    const queuedMs = await this.acquire();
    try {
      return await fn(queuedMs);
    } finally {
      this.release();
    }
  }
}
