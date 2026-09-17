import { describe, expect, test } from "vitest";
import { inTowerAirspace, inViolation, predictConflicts, predictPair, trackOf } from "./conflict.ts";
import { mkAircraft } from "./testUtil.ts";
import { Sim } from "./engine.ts";

describe("conflict prediction", () => {
  test("head-on co-altitude traffic 20 NM apart at 300 kt loses separation in about 100 s", () => {
    // Closing speed 600 kt = 1/6 NM per second; 3 NM standard is breached at 17 NM closed => ~102 s.
    const a = mkAircraft({ id: 1, x: -10, hdg: 90 });
    const b = mkAircraft({ id: 2, x: 10, hdg: 270 });
    const c = predictPair(trackOf(a), trackOf(b));
    expect(c).not.toBeNull();
    expect(c!.tLoss).toBeGreaterThanOrEqual(98);
    expect(c!.tLoss).toBeLessThanOrEqual(106);
    expect(c!.cpaNm).toBeCloseTo(0, 6);
    expect(c!.tCpa).toBeCloseTo(120, 6);
  });

  test("vertical separation of 1000 ft or more is not a conflict", () => {
    const a = mkAircraft({ id: 1, x: -10, hdg: 90, alt: 10000 });
    const b = mkAircraft({ id: 2, x: 10, hdg: 270, alt: 11000 });
    expect(predictPair(trackOf(a), trackOf(b))).toBeNull();
    const c = mkAircraft({ id: 3, x: 10, hdg: 270, alt: 10900 });
    expect(predictPair(trackOf(a), trackOf(c))).not.toBeNull();
  });

  test("a climbing aircraft that will reach the other's altitude is predicted as a conflict", () => {
    const level = mkAircraft({ id: 1, x: -10, hdg: 90, alt: 12000 });
    const climbing = mkAircraft({ id: 2, x: 10, hdg: 270, alt: 9000, targetAlt: 12000 });
    const c = predictPair(trackOf(level), trackOf(climbing));
    expect(c).not.toBeNull();
    // 3000 ft at 30 ft/s takes 100 s; the two are laterally inside 3 NM from ~102 s, so loss follows within the horizon.
    expect(c!.tLoss).toBeGreaterThanOrEqual(66);
    expect(c!.tLoss).toBeLessThanOrEqual(120);
    const stopsShort = mkAircraft({ id: 3, x: 10, hdg: 270, alt: 9000, targetAlt: 11000 });
    expect(predictPair(trackOf(level), trackOf(stopsShort))).toBeNull();
  });

  test("an arrival holding cruise is predicted to start down at its top of descent", () => {
    // 40 NM west of NORIF (14, 9) heading for it; TOD is 25 NM out so descent begins ~15 NM / 250 kt = 216 s later.
    const arr = mkAircraft({
      id: 1,
      phase: "arrival",
      x: 14 - 40,
      y: 9,
      hdg: 90,
      spd: 250,
      alt: 12000,
      targetAlt: 12000,
      route: [
        { fix: "WEXLA", alt: 12000, spd: 250 },
        { fix: "NORIF", alt: 7000, spd: 220 },
      ],
      routeIdx: 1,
    });
    const t = trackOf(arr);
    expect(t.vz).toBeLessThan(0);
    expect(t.targetAlt).toBe(7000);
    expect(t.vzStart).toBeGreaterThan(200);
    expect(t.vzStart).toBeLessThan(230);
  });

  test("diverging traffic is not a conflict and pairs are de-duplicated", () => {
    const a = mkAircraft({ id: 1, x: -2, hdg: 270 });
    const b = mkAircraft({ id: 2, x: 2, hdg: 90 });
    expect(predictPair(trackOf(a), trackOf(b))).toBeNull();
    const c = mkAircraft({ id: 3, x: -10, y: 20, hdg: 90 });
    const d = mkAircraft({ id: 4, x: 10, y: 20, hdg: 270 });
    const all = predictConflicts([a, b, c, d]);
    expect(all).toHaveLength(1);
    expect([all[0].a, all[0].b].sort()).toEqual([3, 4]);
  });

  test("tower airspace is excluded from prediction and violation accounting", () => {
    const short = mkAircraft({ id: 1, phase: "arrival", x: 2, y: 0, alt: 1500, hdg: 270 });
    const rolling = mkAircraft({ id: 2, phase: "departure", x: -1, y: 0, alt: 1600, hdg: 270 });
    expect(inTowerAirspace(short)).toBe(true);
    expect(inViolation(short, rolling)).toBe(false);
    expect(predictConflicts([short, rolling])).toHaveLength(0);
    const a = mkAircraft({ id: 3, x: 20, y: 0 });
    const b = mkAircraft({ id: 4, x: 22, y: 0, alt: 10500 });
    expect(inViolation(a, b)).toBe(true);
  });

  test("the sim is deterministic for a seed and stays within the traffic band", () => {
    const run = (seed: number) => {
      const sim = new Sim({ seed });
      let max = 0;
      let min = Infinity;
      while (sim.t < 240) {
        sim.step(0.5);
        max = Math.max(max, sim.aircraft.length);
        min = Math.min(min, sim.aircraft.length);
      }
      return { min, max, snapshot: sim.aircraft.map((a) => [a.callsign, a.x.toFixed(3), a.y.toFixed(3), a.alt]).join("|") };
    };
    const a = run(7);
    const b = run(7);
    expect(a.snapshot).toBe(b.snapshot);
    expect(a.min).toBeGreaterThanOrEqual(15);
    expect(a.max).toBeLessThanOrEqual(40);
    expect(run(8).snapshot).not.toBe(a.snapshot);
  });
});
