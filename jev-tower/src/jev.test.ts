import { describe, expect, test } from "vitest";
import { LatencyStats, buildRequest, candidateState, isStale, parseAnswers, questionIds, type JevRequest, type JevResponse } from "./jev.ts";
import { Controller, newTelemetry } from "./controller.ts";
import { Sim } from "./engine.ts";
import { FIX_MAP } from "./world.ts";
import { predictConflicts } from "./conflict.ts";
import { mkAircraft } from "./testUtil.ts";

function choiceResponse(count: number, choice: string, extra: Record<string, number> = {}): JevResponse {
  const answers: JevResponse["answers"] = {};
  for (let i = 0; i < count; i++) {
    const ids = questionIds(i);
    answers[ids.instruction] = { type: "choice", choice, confidence: 0.7, probabilities: { [choice]: 0.7, maintain: 0.2, descend_1000: 0.1, ...extra } };
    answers[ids.urgency] = { type: "score", score: 0.5, confidence: 0.8, probabilities: { "2": 0.8 }, legend: { "2": "Action needed now" } };
    answers[ids.handoff] = { type: "noul", noul: 0.1 };
  }
  return { model: "jev-test", answers, usage: { input_tokens: 100 * count, output_tokens: 10 * count } };
}

describe("jev request/response", () => {
  test("state carries precomputed geometry, the intruder's instruction and unavailable options", () => {
    const ac = mkAircraft({ id: 1, x: -10, hdg: 90, alt: 3000 });
    const other = mkAircraft({ id: 2, x: 10, hdg: 270, alt: 3000, instruction: "turn_right_20" });
    const conflicts = predictConflicts([ac, other]);
    const s = candidateState(ac, conflicts, new Map([[1, ac], [2, other]]), 0, FIX_MAP);
    expect(s.intruders).toHaveLength(1);
    expect(s.intruders[0]).toMatchObject({ callsign: "TST2", geometry: "head-on, converging", their_current_instruction: "turn_right_20", they_have_priority: false });
    expect(s.altitude_floor_ft).toBe(3000);
    expect(s.unavailable_instructions.some((u) => u.startsWith("descend_1000"))).toBe(true);
    expect(s.unavailable_instructions.some((u) => u.startsWith("direct_to_next_fix"))).toBe(true);
  });

  test("one request batches three questions per aircraft over shared state", () => {
    const states = [mkAircraft({ id: 1 }), mkAircraft({ id: 2 }), mkAircraft({ id: 3 })].map((a) => candidateState(a, [], new Map([[a.id, a]]), 0, FIX_MAP));
    const req: JevRequest = buildRequest(states);
    expect(req.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(req.questions)).toHaveLength(9);
    expect(req.questions.a2_instruction.type).toBe("choice");
    expect(req.questions.a2_urgency.type).toBe("score");
    expect(req.questions.a2_handoff.type).toBe("noul");
    expect((req.state as { aircraft: unknown[] }).aircraft).toHaveLength(3);
  });

  test("answers parse into typed decisions and tolerate missing or unknown values", () => {
    const resp = choiceResponse(2, "turn_left_20");
    resp.answers.a1_instruction = { type: "choice", choice: "do_a_barrel_roll", confidence: 0.9, probabilities: { do_a_barrel_roll: 0.9, climb_1000: 0.1 } };
    delete resp.answers.a1_urgency;
    const [first, second] = parseAnswers(resp, 2);
    expect(first).toMatchObject({ choice: "turn_left_20", confidence: 0.7, urgency: 0.5, handoff: 0.1 });
    expect(first.probabilities.turn_left_20).toBe(0.7);
    expect(second.choice).toBeNull();
    expect(second.probabilities).toEqual({ climb_1000: 0.1 });
    expect(second.urgency).toBe(0);
  });

  test("stale answers: superseded sequence numbers or too-old sim time", () => {
    expect(isStale(3, 3, 100, 101)).toBe(true);
    expect(isStale(3, 4, 100, 101)).toBe(true);
    expect(isStale(5, 4, 100, 101)).toBe(false);
    expect(isStale(5, undefined, 100, 101)).toBe(false);
    expect(isStale(5, undefined, 100, 116)).toBe(true);
  });

  test("latency percentiles", () => {
    const s = new LatencyStats();
    for (const v of [100, 200, 300, 400, 1000]) s.push(v);
    expect(s.last).toBe(1000);
    expect(s.p50).toBe(300);
    expect(s.p95).toBe(1000);
  });
});

describe("controller", () => {
  test("applies fresh answers, discards a stale one, and never blocks the tick", async () => {
    const sim = new Sim({ seed: 7, initialCount: 0 });
    const a = mkAircraft({ id: 101, x: -10, hdg: 90, alt: 10000 });
    const b = mkAircraft({ id: 102, x: 10, hdg: 270, alt: 10000 });
    sim.aircraft = [a, b];
    sim.step(0.5);
    expect(sim.conflicts).toHaveLength(1);

    let clock = 0;
    const resolvers: Array<(r: JevResponse) => void> = [];
    const requests: JevRequest[] = [];
    const tm = newTelemetry();
    const c = new Controller("jev", sim, tm, {
      now: () => clock,
      call: (req) =>
        new Promise<JevResponse>((resolve) => {
          requests.push(req);
          resolvers.push(resolve);
        }),
    });

    const n = sim.candidates().length;
    expect(n).toBeGreaterThanOrEqual(2);
    c.tick();
    expect(tm.requests).toBe(1);
    expect(tm.inFlight).toBe(1);
    expect(Object.keys(requests[0].questions)).toHaveLength(3 * n);
    // Second request for the same aircraft one second later while the first is still in flight.
    clock += 1000;
    c.tick();
    expect(tm.requests).toBe(2);

    // The newer request answers first and is applied.
    resolvers[1](choiceResponse(n, "turn_left_20"));
    await Promise.resolve();
    await Promise.resolve();
    expect(sim.find(101)!.instruction).toBe("turn_left_20");
    expect(sim.find(102)!.instruction).toBe("turn_left_20");
    expect(tm.stale).toBe(0);

    // The older answer arrives afterwards and is discarded, leaving the applied instructions alone.
    resolvers[0](choiceResponse(n, "climb_1000"));
    await Promise.resolve();
    await Promise.resolve();
    expect(tm.stale).toBe(n);
    expect(sim.find(101)!.instruction).toBe("turn_left_20");
    expect(tm.inFlight).toBe(0);
    expect(tm.inputTokens).toBe(200 * n);
    c.dispose();
  });

  test("an invalid Jev pick falls to the next valid option; a failed request falls back to rules", async () => {
    const sim = new Sim({ seed: 7, initialCount: 0 });
    // Co-altitude head-on at the MSA: descending is not allowed, so a "descend_1000" pick must be replaced.
    sim.aircraft = [mkAircraft({ id: 101, x: -10, hdg: 90, alt: 3000 }), mkAircraft({ id: 102, x: 10, hdg: 270, alt: 3000 })];
    sim.step(0.5);
    const tm = newTelemetry();
    const c = new Controller("jev", sim, tm, {
      now: () => 0,
      call: async (req) => choiceResponse(Object.keys(req.questions).length / 3, "descend_1000", { descend_1000: 0.6, climb_1000: 0.3, maintain: 0.1 }),
    });
    c.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(sim.find(101)!.instruction).toBe("climb_1000");
    expect(sim.ticker.some((e) => e.kind === "fallback" && e.text.includes("Jev chose descend_1000"))).toBe(true);
    c.dispose();

    const sim2 = new Sim({ seed: 7, initialCount: 0 });
    sim2.aircraft = [mkAircraft({ id: 101, x: -10, hdg: 90 }), mkAircraft({ id: 102, x: 10, hdg: 270 })];
    sim2.step(0.5);
    const tm2 = newTelemetry();
    const c2 = new Controller("jev", sim2, tm2, { now: () => 0, call: async () => { throw new Error("boom"); } });
    c2.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(tm2.errors).toBe(1);
    expect(tm2.lastError).toBe("boom");
    // Deterministic rules still separated the pair: the yielding aircraft (higher id) went down.
    expect(sim2.find(102)!.instruction).toBe("descend_1000");
    c2.dispose();
  });

  test("slow mode handles one aircraft per call and waits out the simulated latency", async () => {
    const sim = new Sim({ seed: 7, initialCount: 0 });
    sim.aircraft = [mkAircraft({ id: 101, x: -10, hdg: 90 }), mkAircraft({ id: 102, x: 10, hdg: 270 })];
    sim.step(0.5);
    const tm = newTelemetry();
    const c = new Controller("slow", sim, tm, { now: () => 0, slowDelayMs: 5, call: async () => choiceResponse(1, "turn_right_45") });
    c.tick();
    c.tick();
    expect(tm.requests).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(sim.aircraft.filter((a) => a.instruction === "turn_right_45")).toHaveLength(1);
    c.dispose();
  });
});
