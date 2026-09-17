import {
  ARENA_H,
  ARENA_W,
  DIRECTIONS,
  type Agent,
  type Direction,
  type Personality,
  type World,
  canEat,
  directionOf,
  distance,
} from "./world.ts";

export const PERSONALITY_RULES: Record<Personality, string> = {
  aggressive: "hunts smaller agents relentlessly, accepts risk, spends boost to close on prey",
  cautious: "keeps far from anything bigger, prefers pellets in open space, spends boost only to escape",
  greedy: "maximizes pellet intake, tolerates moderate risk, goes for the closest pellets",
  trickster: "changes direction often, skirts close past bigger agents to pull them away, prefers unexpected moves",
};

export const RULES =
  "bigger agents eat smaller agents on contact (fatal); pellets add size; walls stop movement; boost = 1.5s speed burst, 8s cooldown, drains energy";

export type Relation = "bigger" | "smaller" | "similar";

export interface SeenAgent {
  id: string;
  rel: Relation;
  size: number;
  dist: number;
  dir: Direction;
  moving: string;
}

export interface SeenPellet {
  id: string;
  dist: number;
  dir: Direction;
}

export interface Perception {
  you: {
    id: string;
    personality: Personality;
    size: number;
    energy: string;
    boost: string;
    heading: string;
  };
  nearby_agents: SeenAgent[];
  nearby_pellets: SeenPellet[];
  wall_dist: Record<"N" | "S" | "E" | "W", number>;
}

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export interface AgentRequest {
  state: Perception;
  questions: Record<string, Question>;
  /** entity ids listed as valid targets */
  targets: string[];
}

export const NEAREST_AGENTS = 6;
export const NEAREST_PELLETS = 5;

export function relationOf(me: Agent, other: Agent): Relation {
  if (canEat(other, me)) return "bigger";
  if (canEat(me, other)) return "smaller";
  return "similar";
}

export function buildPerception(world: World, me: Agent): Perception {
  const seen: SeenAgent[] = [];
  for (const o of world.agents) {
    if (o === me || !o.alive) continue;
    const d = distance(me.x, me.y, o.x, o.y);
    const rel = relationOf(me, o);
    const dir = directionOf(o.x - me.x, o.y - me.y);
    let moving = o.heading === "hold" ? "still" : o.heading;
    if (o.steerTo) moving = directionOf(o.steerTo.x - o.x, o.steerTo.y - o.y);
    const approaching = moving !== "still" && moving === directionOf(me.x - o.x, me.y - o.y);
    seen.push({
      id: o.id,
      rel,
      size: Math.round(o.size),
      dist: Math.round(d),
      dir,
      moving: approaching ? `${moving} (toward you)` : moving,
    });
  }
  seen.sort((a, b) => a.dist - b.dist);

  const pellets: SeenPellet[] = world.pellets
    .map((p) => ({ id: p.id, dist: Math.round(distance(me.x, me.y, p.x, p.y)), dir: directionOf(p.x - me.x, p.y - me.y) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, NEAREST_PELLETS);

  return {
    you: {
      id: me.id,
      personality: me.personality,
      size: Math.round(me.size),
      energy: `${Math.round(me.energy * 100)}%`,
      boost: me.boostLeft > 0 ? "active" : me.boostCooldown > 0 ? `cooling down (${me.boostCooldown.toFixed(1)}s)` : "ready",
      heading: me.heading,
    },
    nearby_agents: seen.slice(0, NEAREST_AGENTS),
    nearby_pellets: pellets,
    wall_dist: {
      N: Math.round(me.y),
      S: Math.round(ARENA_H - me.y),
      E: Math.round(ARENA_W - me.x),
      W: Math.round(me.x),
    },
  };
}

function dirIndex(d: Direction): number {
  return DIRECTIONS.indexOf(d);
}

function angularSteps(a: Direction, b: Direction): number {
  const diff = Math.abs(dirIndex(a) - dirIndex(b));
  return Math.min(diff, 8 - diff);
}

/** Describe what lies in each compass direction so the model picks among concrete options. */
export function describeMoves(p: Perception): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const d of DIRECTIONS) {
    const parts: string[] = [];
    for (const a of p.nearby_agents) {
      const steps = angularSteps(a.dir, d);
      const rel = a.rel === "bigger" ? "BIGGER" : a.rel === "smaller" ? "prey" : "similar";
      if (steps === 0) parts.push(`toward ${a.id} (${rel}, ${a.dist}px)`);
      else if (steps === 4 && rel === "BIGGER" && a.dist < 350) parts.push(`away from ${a.id} (BIGGER)`);
    }
    for (const pel of p.nearby_pellets) {
      if (pel.dir === d) parts.push(`pellet ${pel.id} ${pel.dist}px`);
    }
    const wallKey = d.length === 1 ? (d as "N" | "S" | "E" | "W") : null;
    const wall = wallKey
      ? p.wall_dist[wallKey]
      : Math.min(p.wall_dist[d[0] as "N" | "S"], p.wall_dist[d[1] as "E" | "W"]);
    if (wall < 120) parts.push(`WALL ${Math.round(wall)}px`);
    out[d] = parts.length ? parts.join("; ") : "open";
  }
  out.hold = "stay still";
  return out;
}

export function describeTargets(p: Perception): { criteria: Record<string, string | null>; ids: string[] } {
  const criteria: Record<string, string | null> = { none: "no target: flee or wander" };
  const ids: string[] = [];
  for (const a of p.nearby_agents) {
    if (a.rel === "bigger") continue;
    criteria[a.id] = `${a.rel}, ${a.dist}px ${a.dir}`;
    ids.push(a.id);
  }
  for (const pel of p.nearby_pellets) {
    criteria[pel.id] = `pellet, ${pel.dist}px ${pel.dir}`;
    ids.push(pel.id);
  }
  return { criteria, ids };
}

/**
 * Build the three questions for one agent. `path` is the JSON path of this agent's
 * perception inside the request state (e.g. `agents.a03`), so several independent
 * agents can share one request (fan-out) while each question stays local to its agent.
 */
export function buildQuestions(p: Perception, path: string): { questions: Record<string, Question>; targets: string[] } {
  const t = describeTargets(p);
  const you = `\`${path}\``;
  const persona = `\`personalities.${p.you.personality}\``;
  return {
    targets: t.ids,
    questions: {
      move: {
        type: "choice",
        instructions: `Best next direction for agent ${you}, given what lies each way and its ${persona}? Toward BIGGER is fatal; prey and pellets grow you.`,
        criteria: describeMoves(p),
      },
      boost: {
        type: "noul",
        instructions: `Should agent ${you} spend its boost now (see \`rules\`, ${persona})?`,
        criteria: {
          true: "boost is ready and a BIGGER agent is within ~150px approaching, or prey/pellet is within a burst's reach and the personality spends boost on it",
          false: "no urgent threat or opportunity, boost not ready, or energy low",
        },
      },
      target: {
        type: "choice",
        instructions: `Which listed entity should agent ${you} pursue now, per ${persona}? none if fleeing matters more.`,
        criteria: t.criteria,
      },
    },
  };
}

/**
 * Compact text rendering of one perception. Same content as the object form, but
 * roughly a quarter fewer input tokens per agent than nested JSON, with identical
 * answers in side-by-side probes.
 */
export function renderPerception(p: Perception): string {
  const you = `you: ${p.you.personality}, size ${p.you.size}, energy ${p.you.energy}, boost ${p.you.boost}, heading ${p.you.heading}`;
  const agents = p.nearby_agents.map((a) => `${a.id}: ${a.rel}, size ${a.size}, ${a.dist}px ${a.dir}, moving ${a.moving}`);
  const pellets = p.nearby_pellets.map((a) => `${a.id} ${a.dist}px ${a.dir}`).join(", ");
  const walls = (Object.keys(p.wall_dist) as (keyof Perception["wall_dist"])[]).map((k) => `${k} ${p.wall_dist[k]}`).join(", ");
  return `${you}\nnearby agents:\n  ${agents.length ? agents.join("\n  ") : "none"}\npellets: ${pellets || "none"}\nwalls px: ${walls}`;
}

export interface BatchState {
  rules: string;
  personalities: Record<Personality, string>;
  agents: Record<string, string>;
}

export interface BatchRequest {
  state: BatchState;
  questions: Record<string, Question>;
  /** per agent: valid target ids */
  targets: Record<string, string[]>;
  agentIds: string[];
}

/** One request carrying several agents' independent perceptions (speculative fan-out). */
export function buildBatchRequest(world: World, agents: Agent[]): BatchRequest {
  const state: BatchState = { rules: RULES, personalities: PERSONALITY_RULES, agents: {} };
  const questions: Record<string, Question> = {};
  const targets: Record<string, string[]> = {};
  for (const a of agents) {
    const p = buildPerception(world, a);
    state.agents[a.id] = renderPerception(p);
    const q = buildQuestions(p, `agents.${a.id}`);
    for (const [k, v] of Object.entries(q.questions)) questions[`${a.id}.${k}`] = v;
    targets[a.id] = q.targets;
  }
  return { state, questions, targets, agentIds: agents.map((a) => a.id) };
}
