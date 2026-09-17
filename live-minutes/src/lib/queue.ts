/** Minimal promise concurrency limiter (per-item Jev requests run in parallel, bounded). */
export function createLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    active--;
    waiting.shift()?.();
  };
  return {
    get active() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
    run<T>(fn: () => Promise<T>): Promise<T> {
      const start = (): Promise<T> => {
        active++;
        return fn().finally(next);
      };
      if (active < limit) return start();
      return new Promise<T>((resolve, reject) => {
        waiting.push(() => start().then(resolve, reject));
      });
    },
  };
}
