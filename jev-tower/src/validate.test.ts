import { describe, expect, test } from "vitest";
import { applyInstruction, resolves, selectValidInstruction, validateInstruction } from "./validate.ts";
import { FIX_MAP } from "./world.ts";
import { mkAircraft } from "./testUtil.ts";
import { INSTRUCTIONS, type Instruction } from "./types.ts";
import { ruleCandidates } from "./rules.ts";
import { predictConflicts } from "./conflict.ts";
import { desiredHeading, norm360 } from "./kinematics.ts";

describe("instruction validation", () => {
  test("one instruction per aircraft per 20 s", () => {
    const ac = mkAircraft({ id: 1, instructionAt: 100 });
    expect(validateInstruction(ac, "turn_left_20", [], 110, FIX_MAP)).toEqual({ ok: false, reason: "cooldown" });
    expect(validateInstruction(ac, "turn_left_20", [], 120, FIX_MAP)).toEqual({ ok: true });
    // "maintain" is always allowed; it changes nothing.
    expect(validateInstruction(ac, "maintain", [], 101, FIX_MAP)).toEqual({ ok: true });
  });

  test("no descent below the MSA or approach floor, no climb above the ceiling", () => {
    const enroute = mkAircraft({ id: 1, x: 30, alt: 3000 });
    expect(validateInstruction(enroute, "descend_1000", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "below_floor" });
    expect(validateInstruction({ ...enroute, alt: 4000 }, "descend_1000", [], 0, FIX_MAP)).toEqual({ ok: true });
    const onApproach = mkAircraft({ id: 2, phase: "arrival", x: 8, y: 2, alt: 2000, routeIdx: 0, route: [{ fix: "FINAL", alt: 2000, spd: 180 }, { fix: "RW27", alt: 0, spd: 140 }] });
    expect(validateInstruction(onApproach, "descend_1000", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "below_floor" });
    expect(validateInstruction({ ...onApproach, alt: 2500 }, "descend_1000", [], 0, FIX_MAP)).toEqual({ ok: true });
    expect(validateInstruction(mkAircraft({ id: 3, alt: 17500 }), "climb_1000", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "above_ceiling" });
  });

  test("speed instructions respect the phase envelope", () => {
    const arr = mkAircraft({ id: 1, phase: "arrival", spd: 170, targetSpd: 170 });
    expect(validateInstruction(arr, "speed_minus_30", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "too_slow" });
    expect(validateInstruction({ ...arr, spd: 300, targetSpd: 300 }, "speed_plus_30", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "too_fast" });
    expect(validateInstruction({ ...arr, spd: 250, targetSpd: 250 }, "speed_minus_30", [], 0, FIX_MAP)).toEqual({ ok: true });
  });

  test("a turn into another aircraft is rejected", () => {
    // Subject flies an assigned 090 heading; a co-altitude intruder 14 NM to its right-front heads north-west across its nose.
    const ac = mkAircraft({ id: 1, hdg: 90, vectorHdg: 90 });
    const intruder = mkAircraft({ id: 2, x: 10, y: -10, hdg: 315 });
    expect(predictConflicts([ac, intruder])).toHaveLength(0);
    expect(validateInstruction(ac, "turn_right_45", [intruder], 0, FIX_MAP)).toEqual({ ok: false, reason: "creates_conflict" });
    expect(validateInstruction(ac, "turn_left_45", [intruder], 0, FIX_MAP)).toEqual({ ok: true });
  });

  test("direct_to_next_fix only applies to vectored aircraft", () => {
    const onRoute = mkAircraft({ id: 1 });
    expect(validateInstruction(onRoute, "direct_to_next_fix", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "already_on_route" });
    const vectored = applyInstruction(onRoute, "turn_left_20", 0, FIX_MAP);
    expect(vectored.vectorHdg).not.toBeNull();
    expect(validateInstruction(vectored, "direct_to_next_fix", [], 30, FIX_MAP)).toEqual({ ok: true });
    const resumed = applyInstruction(vectored, "direct_to_next_fix", 30, FIX_MAP);
    expect(resumed.vectorHdg).toBeNull();
    expect(resumed.assignedAlt).toBeNull();
  });

  test("established arrivals on final take only speed and resume instructions", () => {
    const final = mkAircraft({ id: 1, phase: "arrival", x: 7, y: 0.2, alt: 2200, hdg: 270, spd: 200, targetSpd: 200, routeIdx: 1, route: [{ fix: "FINAL", alt: 2000, spd: 180 }, { fix: "RW27", alt: 0, spd: 140 }] });
    expect(validateInstruction(final, "turn_left_20", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "established_on_final" });
    expect(validateInstruction(final, "climb_1000", [], 0, FIX_MAP)).toEqual({ ok: false, reason: "established_on_final" });
    expect(validateInstruction(final, "speed_minus_30", [], 0, FIX_MAP)).toEqual({ ok: true });
  });

  test("applyInstruction produces the expected state changes", () => {
    const ac = mkAircraft({ id: 1, hdg: 90, alt: 10000, spd: 300, targetSpd: 300 });
    // Turns are relative to the heading the aircraft should be flying (its route bearing, or its current vector).
    const routeHdg = desiredHeading(ac, FIX_MAP);
    expect(applyInstruction(ac, "turn_right_45", 5, FIX_MAP)).toMatchObject({ vectorHdg: norm360(routeHdg + 45), vectorSince: 5, instruction: "turn_right_45", instructionAt: 5 });
    expect(applyInstruction({ ...ac, vectorHdg: 90 }, "turn_left_20", 5, FIX_MAP).vectorHdg).toBe(70);
    expect(applyInstruction(ac, "climb_1000", 5, FIX_MAP)).toMatchObject({ assignedAlt: 11000, targetAlt: 11000 });
    expect(applyInstruction(ac, "descend_1000", 5, FIX_MAP)).toMatchObject({ assignedAlt: 9000, targetAlt: 9000 });
    expect(applyInstruction(ac, "speed_minus_30", 5, FIX_MAP)).toMatchObject({ assignedSpd: 270, targetSpd: 270 });
    expect(applyInstruction(ac, "maintain", 5, FIX_MAP).instructionAt).toBe(-1000);
  });
});

describe("fallback selection", () => {
  const rejectTurns = (i: Instruction) => (i.startsWith("turn") ? { ok: false, reason: "creates_conflict" as const } : { ok: true });

  test("takes Jev's pick when it validates", () => {
    const sel = selectValidInstruction({ climb_1000: 0.6, turn_left_20: 0.3, maintain: 0.1 }, () => ({ ok: true }));
    expect(sel).toMatchObject({ instruction: "climb_1000", fellBack: false });
  });

  test("falls to the next-highest-probability valid option and records why", () => {
    const sel = selectValidInstruction({ turn_left_45: 0.5, turn_right_20: 0.3, descend_1000: 0.15, maintain: 0.05 }, rejectTurns);
    expect(sel.instruction).toBe("descend_1000");
    expect(sel.fellBack).toBe(true);
    expect(sel.rejected).toEqual({ turn_left_45: "creates_conflict", turn_right_20: "creates_conflict" });
  });

  test("ends at maintain when nothing else validates", () => {
    const sel = selectValidInstruction({ turn_left_45: 1 }, (i) => ({ ok: i === "maintain" }));
    expect(sel.instruction).toBe("maintain");
    expect(sel.fellBack).toBe(true);
  });

  test("every instruction is ranked even when probabilities are partial", () => {
    const seen: Instruction[] = [];
    selectValidInstruction({}, (i) => {
      seen.push(i);
      return { ok: false };
    });
    expect(new Set(seen)).toEqual(new Set(INSTRUCTIONS));
  });

  test("rule-based candidates separate a head-on pair vertically and resolve the conflict", () => {
    const a = mkAircraft({ id: 1, x: -10, hdg: 90 });
    const b = mkAircraft({ id: 2, x: 10, hdg: 270 });
    const conflicts = predictConflicts([a, b]);
    const byId = new Map([[1, a], [2, b]]);
    // Equal priority: the later arrival (higher id) yields and goes down; the other holds while there is time.
    expect(ruleCandidates(b, conflicts, byId)[0]).toBe("descend_1000");
    expect(ruleCandidates(a, conflicts, byId)).toEqual(["maintain"]);
    // Once loss is under 30 s away the priority aircraft acts too, in the opposite sense.
    const a2 = { ...a, x: -3.5 };
    const b2 = { ...b, x: 3.5 };
    const urgent = predictConflicts([a2, b2]);
    expect(urgent[0].tLoss).toBeLessThan(30);
    expect(ruleCandidates(a2, urgent, new Map([[1, a2], [2, b2]]))[0]).toBe("climb_1000");
    expect(resolves(b, "descend_1000", 1, [a], 0, FIX_MAP)).toBe(true);
    expect(resolves(b, "speed_minus_30", 1, [a], 0, FIX_MAP)).toBe(false);
  });
});
