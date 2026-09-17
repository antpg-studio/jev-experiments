import { describe, expect, it } from "vitest";
import {
  NEAREST_AGENTS,
  NEAREST_PELLETS,
  buildBatchRequest,
  buildPerception,
  buildQuestions,
  describeMoves,
  describeTargets,
  renderPerception,
} from "./perception.ts";
import { ARENA_H, ARENA_W, createWorld } from "./world.ts";

const world = () => createWorld({ seed: 3, agentCount: 16, policy: "jev", human: true });

describe("perception", () => {
  it("contains only local information: nearest 6 agents and 5 pellets, sorted by distance", () => {
    const w = world();
    const me = w.agents[0];
    const p = buildPerception(w, me);
    expect(p.nearby_agents).toHaveLength(NEAREST_AGENTS);
    expect(p.nearby_pellets).toHaveLength(NEAREST_PELLETS);
    const ad = p.nearby_agents.map((a) => a.dist);
    expect(ad).toEqual([...ad].sort((a, b) => a - b));
    const pd = p.nearby_pellets.map((a) => a.dist);
    expect(pd).toEqual([...pd].sort((a, b) => a - b));
    expect(p.nearby_agents.some((a) => a.id === me.id)).toBe(false);
    expect(JSON.stringify(p)).not.toContain('"x":');
  });

  it("excludes dead agents and reports relation, wall distances and own status", () => {
    const w = world();
    const me = w.agents[0];
    me.x = 100;
    me.y = 200;
    me.size = 30;
    me.energy = 0.5;
    me.boostCooldown = 3.2;
    const other = w.agents[1];
    other.x = 130;
    other.y = 200;
    other.size = 50;
    other.heading = "W";
    const dead = w.agents[2];
    dead.alive = false;
    const p = buildPerception(w, me);
    expect(p.wall_dist).toEqual({ N: 200, S: ARENA_H - 200, E: ARENA_W - 100, W: 100 });
    expect(p.you).toMatchObject({ id: me.id, personality: "aggressive", size: 30, energy: "50%", boost: "cooling down (3.2s)" });
    const seen = p.nearby_agents[0];
    expect(seen.id).toBe(other.id);
    expect(seen.rel).toBe("bigger");
    expect(seen.dir).toBe("E");
    expect(seen.moving).toBe("W (toward you)");
    expect(p.nearby_agents.some((a) => a.id === dead.id)).toBe(false);
    const text = renderPerception(p);
    expect(text).toContain("you: aggressive, size 30, energy 50%, boost cooling down (3.2s)");
    expect(text).toContain(`${other.id}: bigger, size 50, 30px E, moving W (toward you)`);
    expect(text).toContain(`walls px: N 200, S ${ARENA_H - 200}, E ${ARENA_W - 100}, W 100`);
    expect(text).not.toContain(dead.id);
  });

  it("describes each compass move with what lies there and flags walls", () => {
    const w = world();
    const me = w.agents[0];
    me.x = 50;
    me.y = 500;
    me.size = 20;
    const prey = w.agents[1];
    prey.x = 250;
    prey.y = 500;
    prey.size = 10;
    const p = buildPerception(w, me);
    const moves = describeMoves(p);
    expect(Object.keys(moves)).toEqual(["N", "NE", "E", "SE", "S", "SW", "W", "NW", "hold"]);
    expect(moves.E).toContain(`toward ${prey.id} (prey, 200px)`);
    expect(moves.W).toContain("WALL 50px");
    expect(moves.hold).toBe("stay still");
  });

  it("never offers a bigger agent as a target", () => {
    const w = world();
    const me = w.agents[0];
    me.size = 20;
    for (const o of w.agents) if (o !== me) o.size = 60;
    const p = buildPerception(w, me);
    const t = describeTargets(p);
    expect(t.ids.every((id) => id.startsWith("p"))).toBe(true);
    expect(t.criteria.none).toBeDefined();
    expect(Object.keys(t.criteria)).toHaveLength(t.ids.length + 1);
  });

  it("builds one move choice, one boost noul and one target choice pointing at the agent's path", () => {
    const w = world();
    const p = buildPerception(w, w.agents[0]);
    const q = buildQuestions(p, "agents.a00");
    expect(Object.keys(q.questions)).toEqual(["move", "boost", "target"]);
    expect(q.questions.move.type).toBe("choice");
    expect(q.questions.boost.type).toBe("noul");
    expect(q.questions.target.type).toBe("choice");
    expect(q.questions.move.instructions).toContain("`agents.a00`");
    expect(q.questions.move.instructions).toContain("`personalities.aggressive`");
    expect(Object.keys(q.questions.target.criteria ?? {})).toEqual(["none", ...q.targets]);
  });

  it("fans several agents out into one request with namespaced question ids", () => {
    const w = world();
    const batch = buildBatchRequest(w, w.agents.slice(0, 3));
    expect(batch.agentIds).toEqual(["a00", "a01", "a02"]);
    expect(Object.keys(batch.state.agents)).toEqual(["a00", "a01", "a02"]);
    expect(batch.state.agents.a00).toMatch(/^you: aggressive/);
    expect(Object.keys(batch.state.personalities)).toEqual(["aggressive", "cautious", "greedy", "trickster"]);
    expect(batch.state.rules).toContain("eat");
    expect(Object.keys(batch.questions)).toHaveLength(9);
    expect(batch.questions["a01.move"]).toBeDefined();
    expect(batch.questions["a02.target"]?.instructions).toContain("agents.a02");
    expect(batch.targets.a00.length).toBeGreaterThan(0);
  });
});
