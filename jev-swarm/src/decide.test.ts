import { describe, expect, it } from "vitest";
import {
  BOOST_THRESHOLD,
  applyAnswer,
  avoidWalls,
  heuristicDecision,
  parseAgentAnswers,
  refineHeading,
  type Answer,
} from "./decide.ts";
import { ARENA_H, ARENA_W, createWorld, type Agent } from "./world.ts";

const world = () => createWorld({ seed: 5, agentCount: 4, policy: "jev", human: false });

function answers(agent: string, move: string, conf: number, noul: number, target: string): Record<string, Answer> {
  return {
    [`${agent}.move`]: { type: "choice", choice: move, confidence: conf, probabilities: { [move]: conf } },
    [`${agent}.boost`]: { type: "noul", noul },
    [`${agent}.target`]: { type: "choice", choice: target, confidence: 0.5, probabilities: {} },
  };
}

function isolate(w: ReturnType<typeof world>, me: Agent) {
  for (const o of w.agents) if (o !== me) o.alive = false;
  w.pellets = [];
}

describe("parseAgentAnswers", () => {
  it("extracts typed answers for one agent from a batched response", () => {
    const p = parseAgentAnswers(answers("a01", "NE", 0.44, 0.9, "p3"), "a01", ["p3", "a02"]);
    expect(p).toEqual({ move: "NE", moveConfidence: 0.44, moveProbabilities: { NE: 0.44 }, boost: true, target: "p3" });
  });

  it("rejects unknown moves, unlisted targets and sub-threshold boost without throwing", () => {
    const p = parseAgentAnswers(answers("a01", "up", 0.9, BOOST_THRESHOLD - 0.01, "a99"), "a01", ["p3"]);
    const none = { move: null, moveConfidence: 0, moveProbabilities: {}, boost: false, target: null };
    expect(p).toEqual(none);
    expect(parseAgentAnswers({}, "a01", [])).toEqual(none);
    expect(parseAgentAnswers({ "a01.move": { type: "score" } }, "a01", []).move).toBeNull();
  });
});

describe("applyAnswer", () => {
  it("applies a fresh answer to heading and decision", () => {
    const w = world();
    const a = w.agents[0];
    const r = applyAnswer(w, a, 1, { move: "SW", moveConfidence: 0.5, moveProbabilities: {}, boost: true, target: "p1" }, 1000);
    expect(r).toEqual({ applied: true, reason: "ok" });
    expect(a.heading).toBe("SW");
    expect(a.decision).toMatchObject({ move: "SW", boost: true, target: "p1", seq: 1, source: "jev", at: 1000 });
  });

  it("discards answers whose sequence number is not newer than the applied one", () => {
    const w = world();
    const a = w.agents[0];
    applyAnswer(w, a, 3, { move: "N", moveConfidence: 0.5, moveProbabilities: {}, boost: false, target: null }, 1000);
    const stale = applyAnswer(w, a, 2, { move: "S", moveConfidence: 0.9, moveProbabilities: {}, boost: true, target: null }, 1100);
    expect(stale).toEqual({ applied: false, reason: "stale" });
    expect(a.heading).toBe("N");
    expect(applyAnswer(w, a, 3, { move: "S", moveConfidence: 0.9, moveProbabilities: {}, boost: true, target: null }, 1100).reason).toBe("stale");
    expect(applyAnswer(w, a, 4, { move: "S", moveConfidence: 0.9, moveProbabilities: {}, boost: true, target: null }, 1200).applied).toBe(true);
    expect(a.heading).toBe("S");
  });

  it("chases a chosen prey when the move distribution gives its direction enough mass", () => {
    const w = world();
    const me = w.agents[0];
    isolate(w, me);
    me.x = 800;
    me.y = 500;
    me.size = 40;
    const prey = w.agents[1];
    prey.alive = true;
    prey.x = 950;
    prey.y = 500;
    prey.size = 15;
    const parsed = { move: "SW" as const, moveConfidence: 0.52, moveProbabilities: { SW: 0.52, E: 0.46 }, boost: false, target: prey.id };
    expect(applyAnswer(w, me, 1, parsed, 1)).toEqual({ applied: true, reason: "ok" });
    expect(me.heading).toBe("E");
    // not when the target is a pellet or the direction has little mass
    applyAnswer(w, me, 2, { ...parsed, moveProbabilities: { SW: 0.9, E: 0.1 } }, 2);
    expect(me.heading).toBe("SW");
    applyAnswer(w, me, 3, { ...parsed, target: "p0" }, 3);
    expect(me.heading).toBe("SW");
  });

  it("ignores answers for dead agents", () => {
    const w = world();
    const a = w.agents[0];
    a.alive = false;
    expect(applyAnswer(w, a, 1, { move: "N", moveConfidence: 0.5, moveProbabilities: {}, boost: false, target: null }, 1)).toEqual({ applied: false, reason: "dead" });
  });

  it("falls back to the heuristic move on missing or low-confidence answers but keeps the seq", () => {
    const w = world();
    const a = w.agents[0];
    isolate(w, a);
    w.pellets = [{ id: "p0", x: a.x + 300, y: a.y }];
    const r = applyAnswer(w, a, 2, { move: "W", moveConfidence: 0.05, moveProbabilities: {}, boost: false, target: null }, 1);
    expect(r).toEqual({ applied: true, reason: "fallback" });
    expect(a.heading).toBe("E");
    expect(a.decision).toMatchObject({ seq: 2, source: "heuristic" });
    expect(applyAnswer(w, a, 3, { move: null, moveConfidence: 0, moveProbabilities: {}, boost: false, target: null }, 2).reason).toBe("fallback");
  });
});

describe("heuristicDecision", () => {
  it("flees a nearby bigger agent and boosts when it is very close", () => {
    const w = world();
    const me = w.agents[0];
    isolate(w, me);
    me.x = 800;
    me.y = 500;
    me.size = 20;
    const threat = w.agents[1];
    threat.alive = true;
    threat.x = 880;
    threat.y = 500;
    threat.size = 50;
    const d = heuristicDecision(w, me);
    expect(d.move).toBe("W");
    expect(d.boost).toBe(true);
    expect(d.target).toBeNull();
    expect(d.source).toBe("heuristic");
  });

  it("chases nearby prey, otherwise heads to the closest pellet", () => {
    const w = world();
    const me = w.agents[0];
    isolate(w, me);
    me.x = 800;
    me.y = 500;
    me.size = 40;
    const prey = w.agents[1];
    prey.alive = true;
    prey.x = 800;
    prey.y = 650;
    prey.size = 15;
    expect(heuristicDecision(w, me)).toMatchObject({ move: "S", target: prey.id });
    prey.alive = false;
    w.pellets = [
      { id: "far", x: 100, y: 100 },
      { id: "near", x: 700, y: 400 },
    ];
    expect(heuristicDecision(w, me)).toMatchObject({ move: "NW", target: "near", boost: false });
  });

  it("steers away from walls", () => {
    const w = world();
    const me = w.agents[0];
    me.x = 30;
    me.y = 500;
    me.size = 20;
    expect(avoidWalls(me, "W", ARENA_W, ARENA_H)).not.toContain("W");
    expect(avoidWalls(me, "E", ARENA_W, ARENA_H)).toBe("E");
    me.y = 30;
    expect(avoidWalls(me, "NW", ARENA_W, ARENA_H)).not.toMatch(/[NW]/);
  });
});

describe("refineHeading", () => {
  it("tracks a moving target only within one compass step of the decided move", () => {
    const w = world();
    const me = w.agents[0];
    isolate(w, me);
    me.x = 800;
    me.y = 500;
    me.size = 40;
    const prey = w.agents[1];
    prey.alive = true;
    prey.size = 15;
    prey.x = 900;
    prey.y = 450;
    me.decision = { ...me.decision, move: "E", target: prey.id };
    me.heading = "E";
    refineHeading(w, me);
    expect(me.heading).toBe("NE");
    prey.x = 800;
    prey.y = 300;
    refineHeading(w, me);
    expect(me.heading).toBe("NE");
    prey.size = 60;
    prey.x = 900;
    prey.y = 500;
    me.heading = "W";
    me.decision = { ...me.decision, move: "W" };
    refineHeading(w, me);
    expect(me.heading).toBe("W");
  });
});
