export const ARENA_W = 1600;
export const ARENA_H = 1000;
export const PELLET_COUNT = 140;
export const SPAWN_SIZE = 16;
export const MAX_SIZE = 64;
export const PELLET_MASS = 2.2;
export const EAT_RATIO = 1.15;
export const BOOST_DURATION = 1.5;
export const BOOST_COOLDOWN = 8;
export const BOOST_MULT = 1.9;
export const RESPAWN_DELAY = 2;
export const ENERGY_DRAIN = 0.02; // per second, idle
export const ENERGY_BOOST_DRAIN = 0.25; // per second while boosting
export const SHRINK_RATE = 0.9; // size per second when starving
export const SIZE_DECAY = 0.04; // fraction of size above spawn lost per second (big agents must keep eating)

export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Move = Direction | "hold";

export const DIR_VEC: Record<Direction, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  NE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  E: { x: 1, y: 0 },
  SE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  S: { x: 0, y: 1 },
  SW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  W: { x: -1, y: 0 },
  NW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
};

export const PERSONALITIES = ["aggressive", "cautious", "greedy", "trickster"] as const;
export type Personality = (typeof PERSONALITIES)[number];
export type Controller = "jev" | "heuristic" | "human";

export interface Decision {
  move: Move;
  boost: boolean;
  target: string | null;
  seq: number;
  source: "jev" | "heuristic" | "human" | "none";
  confidence: number;
  at: number;
}

export interface Agent {
  id: string;
  personality: Personality;
  controller: Controller;
  x: number;
  y: number;
  size: number;
  energy: number;
  heading: Move;
  boostLeft: number;
  boostCooldown: number;
  alive: boolean;
  respawnIn: number;
  decision: Decision;
  seq: number;
  inFlight: number;
  lastRequestAt: number;
  kills: number;
  deaths: number;
  pellets: number;
  aliveTime: number;
  // human control: steer towards a point instead of a compass move
  steerTo: { x: number; y: number } | null;
}

export interface Pellet {
  id: string;
  x: number;
  y: number;
}

export interface Stats {
  kills: number;
  deaths: number;
  pellets: number;
  aliveTime: number;
}

export type StatKey = Personality | "heuristic" | "human";

export interface World {
  seed: number;
  rng: () => number;
  time: number;
  agents: Agent[];
  pellets: Pellet[];
  stats: Record<StatKey, Stats>;
  nextPelletId: number;
  events: WorldEvent[];
}

export type WorldEvent =
  | { kind: "eat"; eater: string; eaten: string; x: number; y: number; at: number }
  | { kind: "respawn"; id: string; x: number; y: number; at: number };

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NO_DECISION: Decision = {
  move: "hold",
  boost: false,
  target: null,
  seq: 0,
  source: "none",
  confidence: 0,
  at: 0,
};

export function statKey(a: Agent): StatKey {
  if (a.controller === "human") return "human";
  if (a.controller === "heuristic") return "heuristic";
  return a.personality;
}

function emptyStats(): Stats {
  return { kills: 0, deaths: 0, pellets: 0, aliveTime: 0 };
}

export function createAgent(
  rng: () => number,
  index: number,
  controller: Controller,
  personality: Personality,
): Agent {
  return {
    id: controller === "human" ? "you" : `a${index.toString().padStart(2, "0")}`,
    personality,
    controller,
    x: 60 + rng() * (ARENA_W - 120),
    y: 60 + rng() * (ARENA_H - 120),
    size: SPAWN_SIZE + rng() * 10,
    energy: 0.7,
    heading: DIRECTIONS[Math.floor(rng() * 8)],
    boostLeft: 0,
    boostCooldown: 0,
    alive: true,
    respawnIn: 0,
    decision: NO_DECISION,
    seq: 0,
    inFlight: 0,
    lastRequestAt: -Infinity,
    kills: 0,
    deaths: 0,
    pellets: 0,
    aliveTime: 0,
    steerTo: null,
  };
}

export interface WorldOptions {
  seed: number;
  agentCount: number;
  /** "jev" = all AI agents use Jev, "heuristic" = all use code, "mixed" = alternate */
  policy: "jev" | "heuristic" | "mixed";
  human: boolean;
}

export function createWorld(opts: WorldOptions): World {
  const rng = mulberry32(opts.seed);
  const agents: Agent[] = [];
  for (let i = 0; i < opts.agentCount; i++) {
    const controller: Controller =
      opts.policy === "jev" ? "jev" : opts.policy === "heuristic" ? "heuristic" : i % 2 === 0 ? "jev" : "heuristic";
    // in mixed mode controllers alternate, so stride the personality so every Jev agent type appears
    const personality = PERSONALITIES[(opts.policy === "mixed" ? Math.floor(i / 2) : i) % PERSONALITIES.length];
    agents.push(createAgent(rng, i, controller, personality));
  }
  if (opts.human) {
    const h = createAgent(rng, 99, "human", "aggressive");
    h.x = ARENA_W / 2;
    h.y = ARENA_H / 2;
    h.size = SPAWN_SIZE + 6;
    agents.push(h);
  }
  const world: World = {
    seed: opts.seed,
    rng,
    time: 0,
    agents,
    pellets: [],
    stats: {
      aggressive: emptyStats(),
      cautious: emptyStats(),
      greedy: emptyStats(),
      trickster: emptyStats(),
      heuristic: emptyStats(),
      human: emptyStats(),
    },
    nextPelletId: 0,
    events: [],
  };
  for (let i = 0; i < PELLET_COUNT; i++) world.pellets.push(spawnPellet(world));
  return world;
}

export function spawnPellet(world: World): Pellet {
  const id = `p${world.nextPelletId++}`;
  return { id, x: 20 + world.rng() * (ARENA_W - 40), y: 20 + world.rng() * (ARENA_H - 40) };
}

/** Speed in px/s: bigger agents are slower. */
export function speedFor(size: number, boosting: boolean): number {
  const base = 260 * Math.pow(SPAWN_SIZE / size, 0.45);
  return boosting ? base * BOOST_MULT : base;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function canEat(eater: Agent, prey: Agent): boolean {
  return eater.size > prey.size * EAT_RATIO;
}

export function respawn(world: World, a: Agent): void {
  a.alive = true;
  a.respawnIn = 0;
  a.size = SPAWN_SIZE + world.rng() * 6;
  a.energy = 0.7;
  a.boostLeft = 0;
  a.boostCooldown = 0;
  a.heading = DIRECTIONS[Math.floor(world.rng() * 8)];
  a.decision = { ...NO_DECISION, seq: a.decision.seq };
  // pick a spot far from anything bigger
  let best = { x: ARENA_W / 2, y: ARENA_H / 2, score: -Infinity };
  for (let i = 0; i < 12; i++) {
    const x = 60 + world.rng() * (ARENA_W - 120);
    const y = 60 + world.rng() * (ARENA_H - 120);
    let nearest = Infinity;
    for (const o of world.agents) {
      if (o === a || !o.alive) continue;
      nearest = Math.min(nearest, distance(x, y, o.x, o.y));
    }
    if (nearest > best.score) best = { x, y, score: nearest };
  }
  a.x = best.x;
  a.y = best.y;
  world.events.push({ kind: "respawn", id: a.id, x: a.x, y: a.y, at: world.time });
}

/** Advance the world by dt seconds. Pure physics; decisions are applied elsewhere. */
export function step(world: World, dt: number): void {
  world.time += dt;
  const { agents, pellets } = world;

  for (const a of agents) {
    if (!a.alive) {
      a.respawnIn -= dt;
      if (a.respawnIn <= 0) respawn(world, a);
      continue;
    }
    a.aliveTime += dt;
    world.stats[statKey(a)].aliveTime += dt;

    if (a.decision.boost && a.boostCooldown <= 0 && a.boostLeft <= 0 && a.energy > 0.15) {
      a.boostLeft = BOOST_DURATION;
      a.boostCooldown = BOOST_COOLDOWN;
      a.decision = { ...a.decision, boost: false };
    }
    const boosting = a.boostLeft > 0;
    a.boostLeft = Math.max(0, a.boostLeft - dt);
    a.boostCooldown = Math.max(0, a.boostCooldown - dt);
    a.energy = Math.max(0, a.energy - dt * (boosting ? ENERGY_BOOST_DRAIN : ENERGY_DRAIN));
    if (a.energy <= 0) a.size = Math.max(SPAWN_SIZE * 0.6, a.size - SHRINK_RATE * dt);
    if (a.size > SPAWN_SIZE) a.size -= (a.size - SPAWN_SIZE) * SIZE_DECAY * dt;

    const speed = speedFor(a.size, boosting);
    let vx = 0;
    let vy = 0;
    if (a.steerTo) {
      const dx = a.steerTo.x - a.x;
      const dy = a.steerTo.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        const k = Math.min(1, d / 80);
        vx = (dx / d) * speed * k;
        vy = (dy / d) * speed * k;
      }
    } else if (a.heading !== "hold") {
      const v = DIR_VEC[a.heading];
      vx = v.x * speed;
      vy = v.y * speed;
    }
    a.x = Math.min(ARENA_W - a.size, Math.max(a.size, a.x + vx * dt));
    a.y = Math.min(ARENA_H - a.size, Math.max(a.size, a.y + vy * dt));
  }

  // pellets
  for (let i = 0; i < pellets.length; i++) {
    const p = pellets[i];
    for (const a of agents) {
      if (!a.alive) continue;
      if (distance(a.x, a.y, p.x, p.y) < a.size) {
        a.size = Math.min(MAX_SIZE, a.size + PELLET_MASS * (SPAWN_SIZE / a.size) * 1.4);
        a.energy = Math.min(1, a.energy + 0.12);
        a.pellets++;
        world.stats[statKey(a)].pellets++;
        pellets[i] = spawnPellet(world);
        break;
      }
    }
  }

  // agent collisions
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      if (!b.alive) continue;
      const d = distance(a.x, a.y, b.x, b.y);
      if (d > Math.max(a.size, b.size) * 0.9) continue;
      if (canEat(a, b)) eat(world, a, b);
      else if (canEat(b, a)) eat(world, b, a);
    }
  }
}

function eat(world: World, eater: Agent, prey: Agent): void {
  eater.size = Math.min(MAX_SIZE, Math.sqrt(eater.size * eater.size + prey.size * prey.size * 0.7));
  eater.energy = Math.min(1, eater.energy + 0.4);
  eater.kills++;
  prey.deaths++;
  world.stats[statKey(eater)].kills++;
  world.stats[statKey(prey)].deaths++;
  prey.alive = false;
  prey.respawnIn = RESPAWN_DELAY;
  prey.steerTo = null;
  world.events.push({ kind: "eat", eater: eater.id, eaten: prey.id, x: prey.x, y: prey.y, at: world.time });
  if (world.events.length > 60) world.events.splice(0, world.events.length - 60);
}

export function directionOf(dx: number, dy: number): Direction {
  const ang = Math.atan2(dy, dx); // 0 = east, positive = south
  const idx = Math.round(ang / (Math.PI / 4));
  const order: Direction[] = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return order[((idx % 8) + 8) % 8];
}

export function opposite(d: Direction): Direction {
  return DIRECTIONS[(DIRECTIONS.indexOf(d) + 4) % 8];
}
