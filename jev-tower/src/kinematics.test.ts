import { describe, expect, test } from "vitest";
import { ACCEL_KTPS, CLIMB_FPS, DESCENT_FPS, TURN_RATE_DPS, bearingTo, integrate, norm360, turnDelta, velocity } from "./kinematics.ts";
import { mkAircraft } from "./testUtil.ts";

describe("kinematics", () => {
  test("heading helpers", () => {
    expect(norm360(-90)).toBe(270);
    expect(norm360(725)).toBe(5);
    expect(turnDelta(350, 10)).toBe(20);
    expect(turnDelta(10, 350)).toBe(-20);
    expect(turnDelta(0, 180)).toBe(180);
    expect(bearingTo(0, 0, 0, 10)).toBe(0);
    expect(bearingTo(0, 0, 10, 0)).toBe(90);
    expect(bearingTo(0, 0, 0, -10)).toBe(180);
  });

  test("velocity is in NM/s along the heading", () => {
    const v = velocity(90, 360);
    expect(v.vx).toBeCloseTo(0.1, 9);
    expect(v.vy).toBeCloseTo(0, 9);
  });

  test("turns are rate-limited and take the short way round", () => {
    const ac = mkAircraft({ id: 1, hdg: 350 });
    const after = integrate(ac, 30, 1);
    expect(after.hdg).toBeCloseTo(350 + TURN_RATE_DPS, 6);
    const settled = integrate(ac, 30, 60);
    expect(settled.hdg).toBeCloseTo(30, 6);
  });

  test("climb, descent and acceleration rates are applied and clamped at the target", () => {
    const up = integrate(mkAircraft({ id: 1, alt: 5000, targetAlt: 6000 }), 90, 10);
    expect(up.alt).toBe(5000 + CLIMB_FPS * 10);
    const down = integrate(mkAircraft({ id: 1, alt: 5000, targetAlt: 4000 }), 90, 10);
    expect(down.alt).toBe(5000 - DESCENT_FPS * 10);
    const clamped = integrate(mkAircraft({ id: 1, alt: 5000, targetAlt: 5100 }), 90, 60);
    expect(clamped.alt).toBe(5100);
    const faster = integrate(mkAircraft({ id: 1, spd: 250, targetSpd: 280 }), 90, 4);
    expect(faster.spd).toBe(250 + ACCEL_KTPS * 4);
  });

  test("a 300 kt aircraft heading east covers 5 NM in a minute", () => {
    let ac = mkAircraft({ id: 1, hdg: 90, spd: 300 });
    for (let i = 0; i < 120; i++) ac = integrate(ac, 90, 0.5);
    expect(ac.x).toBeCloseTo(5, 6);
    expect(ac.y).toBeCloseTo(0, 6);
  });
});
