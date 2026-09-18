import {
  ARENA_H,
  ARENA_W,
  DIRECTIONS,
  type Agent,
  type Decision,
  type Direction,
  type Move,
  type World,
  canEat,
  directionOf,
  distance,
  opposite,
} from "./world.ts";

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}
export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export type Answer = ChoiceAnswer | NoulAnswer | { type: string };

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** Below this move confidence the agent falls back to the heuristic direction. */
export const MOVE_CONFIDENCE_FLOOR = 0.12;
export const BOOST_THRESHOLD = 0.6;
/** If the agent picked a prey target and gave the direction toward it at least this much mass, chase it. */
export const CHASE_PROBABILITY = 0.3;

export function isMove(s: string): s is Move {
  return s === "hold" || (DIRECTIONS as readonly string[]).includes(s);
}

export interface ParsedAnswer {
  move: Move | null;
  moveConfidence: number;
  moveProbabilities: Record<string, number>;
  boost: boolean;
  target: string | null;
}

/** Extract one agent's typed answers from a batched response. Never throws. */
export function parseAgentAnswers(answers: Record<string, Answer>, agentId: string, validTargets: string[]): ParsedAnswer {
  const mv = answers[`${agentId}.move`];
  const bo = answers[`${agentId}.boost`];
  const tg = answers[`${agentId}.target`];
  let move: Move | null = null;
  let moveConfidence = 0;
  let moveProbabilities: Record<string, number> = {};
  if (mv && mv.type === "choice" && "choice" in mv && isMove(mv.choice)) {
    move = mv.choice;
    moveConfidence = mv.confidence;
    moveProbabilities = mv.probabilities ?? {};
  }
  const boost = !!bo && bo.type === "noul" && "noul" in bo && bo.noul >= BOOST_THRESHOLD;
  let target: string | null = null;
  if (tg && tg.type === "choice" && "choice" in tg && validTargets.includes(tg.choice)) target = tg.choice;
  return { move, moveConfidence, moveProbabilities, boost, target };
}

export interface ApplyResult {
  applied: boolean;
  reason: "ok" | "stale" | "dead" | "fallback";
}

/**
 * Apply a Jev answer to an agent. Answers whose sequence number is older than the
 * newest applied decision are discarded (the agent already acted on fresher data).
 */
export function applyAnswer(world: World, agent: Agent, seq: number, parsed: ParsedAnswer, now: number): ApplyResult {
  if (seq <= agent.decision.seq && agent.decision.source !== "none") return { applied: false, reason: "stale" };
  if (!agent.alive) return { applied: false, reason: "dead" };
  let move = parsed.move;
  let source: Decision["source"] = "jev";
  let reason: ApplyResult["reason"] = "ok";
  if (move === null || parsed.moveConfidence < MOVE_CONFIDENCE_FLOOR) {
    move = heuristicDecision(world, agent).move;
    source = "heuristic";
    reason = "fallback";
  } else if (parsed.target) {
    // combine the two judgments: a chosen prey plus meaningful mass on its direction = chase
    const prey = world.agents.find((o) => o.id === parsed.target && o.alive && canEat(agent, o));
    if (prey) {
      const toward = directionOf(prey.x - agent.x, prey.y - agent.y);
      if ((parsed.moveProbabilities[toward] ?? 0) >= CHASE_PROBABILITY) move = toward;
    }
  }
  agent.decision = { move, boost: parsed.boost, target: parsed.target, seq, source, confidence: parsed.moveConfidence, at: now };
  agent.heading = move;
  return { applied: true, reason };
}

/** Apply a decision produced by code (heuristic bots or network fallback). */
export function applyDecision(agent: Agent, d: Omit<Decision, "at">, now: number): void {
  agent.decision = { ...d, at: now };
  agent.heading = d.move;
}

/** Pick a direction that isn't pointed straight at a wall. */
export function avoidWalls(agent: Agent, d: Direction, arenaW: number, arenaH: number): Direction {
  const margin = agent.size + 40;
  const blocked = (dir: Direction) =>
    (dir.includes("N") && agent.y < margin) ||
    (dir.includes("S") && agent.y > arenaH - margin) ||
    (dir.includes("E") && agent.x > arenaW - margin) ||
    (dir.includes("W") && agent.x < margin);
  if (!blocked(d)) return d;
  const i = DIRECTIONS.indexOf(d);
  for (const off of [1, -1, 2, -2, 3, -3, 4]) {
    const c = DIRECTIONS[(i + off + 8) % 8];
    if (!blocked(c)) return c;
  }
  return d;
}

/**
 * Simple greedy policy: flee the nearest bigger agent if it is close, otherwise head
 * to the nearest pellet. Ignores personality entirely; this is the "before" baseline.
 */
export function heuristicDecision(world: World, me: Agent): Omit<Decision, "at"> {
  let threat: Agent | null = null;
  let threatD = Infinity;
  let prey: Agent | null = null;
  let preyD = Infinity;
  for (const o of world.agents) {
    if (o === me || !o.alive) continue;
    const d = distance(me.x, me.y, o.x, o.y);
    if (canEat(o, me) && d < threatD) {
      threat = o;
      threatD = d;
    } else if (canEat(me, o) && d < preyD) {
      prey = o;
      preyD = d;
    }
  }
  let move: Direction;
  let target: string | null = null;
  let boost = false;
  if (threat && threatD < 180) {
    move = opposite(directionOf(threat.x - me.x, threat.y - me.y));
    boost = threatD < 100;
  } else if (prey && preyD < 220) {
    move = directionOf(prey.x - me.x, prey.y - me.y);
    target = prey.id;
    boost = preyD < 120;
  } else {
    let best: { x: number; y: number; id: string } | null = null;
    let bestD = Infinity;
    for (const p of world.pellets) {
      const d = distance(me.x, me.y, p.x, p.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    move = best ? directionOf(best.x - me.x, best.y - me.y) : me.heading === "hold" ? "N" : me.heading;
    target = best?.id ?? null;
  }
  return { move: avoidWalls(me, move, ARENA_W, ARENA_H), boost, target, seq: me.seq, source: "heuristic", confidence: 1 };
}

function angularSteps(a: Direction, b: Direction): number {
  const diff = Math.abs(DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b));
  return Math.min(diff, 8 - diff);
}

/**
 * Between decisions, keep the heading pointed at the chosen target as it moves, but
 * only when the decided compass move already roughly agrees with it (refinement, not
 * override: a flee decision is never turned into a chase).
 */
export function refineHeading(world: World, me: Agent): void {
  const { target, move } = me.decision;
  if (!target || move === "hold") return;
  let tx: number | undefined;
  let ty: number | undefined;
  const a = world.agents.find((o) => o.id === target);
  if (a) {
    if (!a.alive || !canEat(me, a)) return;
    tx = a.x;
    ty = a.y;
  } else {
    const p = world.pellets.find((o) => o.id === target);
    if (!p) return;
    tx = p.x;
    ty = p.y;
  }
  const toTarget = directionOf(tx - me.x, ty - me.y);
  if (angularSteps(toTarget, move) <= 1) me.heading = toTarget;
}
