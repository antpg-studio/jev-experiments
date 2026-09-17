import { describe, expect, it } from "vitest";
import { Limiter } from "./limiter.ts";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("Limiter", () => {
  it("never exceeds the concurrency limit", async () => {
    const lim = new Limiter(3);
    let peak = 0;
    const jobs = Array.from({ length: 12 }, () =>
      lim.run(async () => {
        peak = Math.max(peak, lim.inFlight);
        await tick();
      }),
    );
    expect(lim.queued).toBe(9);
    await Promise.all(jobs);
    expect(peak).toBe(3);
    expect(lim.inFlight).toBe(0);
    expect(lim.queued).toBe(0);
  });

  it("reports queue wait time and drains when the limit is raised", async () => {
    const lim = new Limiter(1);
    let release!: () => void;
    const first = lim.run(() => new Promise<void>((r) => (release = r)));
    const second = lim.run(async (queuedMs) => queuedMs);
    expect(lim.queued).toBe(1);
    lim.setLimit(2);
    expect(lim.queued).toBe(0);
    expect(await second).toBeGreaterThanOrEqual(0);
    release();
    await first;
  });
});
