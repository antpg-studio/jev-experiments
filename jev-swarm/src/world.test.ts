import { describe, expect, it } from "vitest";
import {
  ARENA_H,
  ARENA_W,
  PELLET_COUNT,
  RESPAWN_DELAY,
  SPAWN_SIZE,
  canEat,
  createWorld,
  directionOf,
  opposite,
  step,
  type Agent,
} from "./world.ts";

function world(agentCount = 8) {
  return createWorld({ seed: 7, agentCount, policy: "jev", human: true });
}

function place(a: Agent, x: number, y: number, size: number, heading: Agent["heading"] = "hold") {
  a.x = x;
  a.y = y;
  a.size = size;
  a.heading = heading;
  a.decision = { ...a.decision, move: heading };
}

describe("world", () => {
  it("is deterministic for a given seed", () => {
    const a = world();
    const b = world();
    expect(a.agents.map((x) => [x.x, x.y, x.size])).toEqual(b.agents.map((x) => [x.x, x.y, x.size]));
    expect(a.pellets).toEqual(b.pellets);
    for (let i = 0; i < 120; i++) {
      step(a, 1 / 60);
      step(b, 1 / 60);
    }
    expect(a.agents.map((x) => [x.x, x.y])).toEqual(b.agents.map((x) => [x.x, x.y]));
    expect(world().agents[0].x).not.toBe(createWorld({ seed: 8, agentCount: 8, policy: "jev", human: true }).agents[0].x);
  });

  it("creates the requested agents, one human, and cycles personalities", () => {
    const w = world(8);
    expect(w.agents).toHaveLength(9);
    expect(w.agents.filter((a) => a.controller === "human")).toHaveLength(1);
    expect(w.agents.find((a) => a.id === "you")).toBeDefined();
    expect(w.agents.slice(0, 4).map((a) => a.personality)).toEqual(["aggressive", "cautious", "greedy", "trickster"]);
    expect(w.pellets).toHaveLength(PELLET_COUNT);
    const mixed = createWorld({ seed: 1, agentCount: 4, policy: "mixed", human: false });
    expect(mixed.agents.map((a) => a.controller)).toEqual(["jev", "heuristic", "jev", "heuristic"]);
  });

  it("moves along the heading and clamps at walls", () => {
    const w = world(2);
    const a = w.agents[0];
    place(a, 800, 500, 20, "E");
    const x0 = a.x;
    step(w, 1 / 60);
    expect(a.x).toBeGreaterThan(x0);
    expect(a.y).toBe(500);
    place(a, ARENA_W - 25, 500, 20, "E");
    for (let i = 0; i < 60; i++) step(w, 1 / 60);
    expect(a.x).toBeLessThanOrEqual(ARENA_W - a.size);
    place(a, 800, 30, 20, "N");
    for (let i = 0; i < 60; i++) step(w, 1 / 60);
    expect(a.y).toBeGreaterThanOrEqual(a.size);
    expect(a.y).toBeLessThan(ARENA_H);
  });

  it("eats pellets on contact and respawns them", () => {
    const w = world(2);
    const a = w.agents[0];
    const p = w.pellets[0];
    place(a, p.x, p.y, 20);
    const size0 = a.size;
    const ids = new Set(w.pellets.map((x) => x.id));
    step(w, 1 / 60);
    expect(a.size).toBeGreaterThan(size0);
    expect(a.pellets).toBe(1);
    expect(w.pellets).toHaveLength(PELLET_COUNT);
    expect(ids.has(w.pellets[0].id)).toBe(false);
  });

  it("only lets clearly bigger agents eat", () => {
    const w = world(2);
    const [a, b] = w.agents;
    a.size = 30;
    b.size = 27;
    expect(canEat(a, b)).toBe(false);
    b.size = 20;
    expect(canEat(a, b)).toBe(true);
    expect(canEat(b, a)).toBe(false);
  });

  it("resolves collisions: the bigger agent eats the smaller, which dies and respawns", () => {
    const w = world(2);
    const [big, small] = w.agents;
    place(big, 300, 300, 40);
    place(small, 310, 300, 20);
    step(w, 1 / 60);
    expect(small.alive).toBe(false);
    expect(small.respawnIn).toBeCloseTo(RESPAWN_DELAY, 5);
    expect(big.kills).toBe(1);
    expect(small.deaths).toBe(1);
    expect(w.stats.aggressive.kills).toBe(1);
    expect(w.stats.cautious.deaths).toBe(1);
    expect(w.events.at(-1)).toMatchObject({ kind: "eat", eater: big.id, eaten: small.id });

    const before = w.time;
    while (!small.alive) step(w, 1 / 60);
    expect(w.time - before).toBeGreaterThanOrEqual(RESPAWN_DELAY - 1 / 60);
    expect(small.size).toBeGreaterThanOrEqual(SPAWN_SIZE);
    expect(small.size).toBeLessThan(SPAWN_SIZE + 6.01);
    expect(small.energy).toBe(0.7);
    expect(small.decision.source).toBe("none");
    expect(w.events.at(-1)).toMatchObject({ kind: "respawn", id: small.id });
    // respawn point is far from the eater
    expect(Math.hypot(small.x - big.x, small.y - big.y)).toBeGreaterThan(200);
  });

  it("does not eat similar-sized agents that overlap", () => {
    const w = world(2);
    const [a, b] = w.agents;
    place(a, 800, 500, 30);
    place(b, 805, 500, 28);
    step(w, 1 / 60);
    expect(a.alive && b.alive).toBe(true);
  });

  it("consumes boost once, then enforces the cooldown", () => {
    const w = world(1);
    const a = w.agents[0];
    place(a, 800, 500, 20, "E");
    a.decision = { ...a.decision, boost: true };
    step(w, 1 / 60);
    expect(a.boostLeft).toBeGreaterThan(0);
    expect(a.boostCooldown).toBeGreaterThan(0);
    expect(a.decision.boost).toBe(false);
    const cd = a.boostCooldown;
    a.decision = { ...a.decision, boost: true };
    step(w, 1 / 60);
    expect(a.boostCooldown).toBeLessThan(cd);
    expect(a.decision.boost).toBe(true);
  });

  it("quantises angles to compass directions", () => {
    expect(directionOf(1, 0)).toBe("E");
    expect(directionOf(0, -1)).toBe("N");
    expect(directionOf(-1, 1)).toBe("SW");
    expect(directionOf(1, -1)).toBe("NE");
    expect(opposite("N")).toBe("S");
    expect(opposite("SW")).toBe("NE");
  });
});
