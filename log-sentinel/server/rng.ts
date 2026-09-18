/** Deterministic mulberry32 PRNG so the fixture stream is reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  hex(n: number): string {
    let out = "";
    for (let i = 0; i < n; i++) out += this.int(0, 15).toString(16);
    return out;
  }
  ip(): string {
    return `${this.int(10, 203)}.${this.int(0, 255)}.${this.int(0, 255)}.${this.int(1, 254)}`;
  }
}
