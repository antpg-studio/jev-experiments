import type { Aircraft, Conflict, Fix, Instruction } from "./types.ts";
import { INSTRUCTIONS } from "./types.ts";
import { geometry, mustYield } from "./rules.ts";
import { distanceNm } from "./kinematics.ts";
import { altitudeFloor } from "./world.ts";
import { validateInstruction, type Rejection } from "./validate.ts";

// Jev 1.13 pricing from https://docs.typesafe.ai/models: $0.042 per million input tokens; output tokens are free.
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export interface JevRequest {
  state: unknown;
  model: "jev-latest";
  questions: Record<string, Question>;
}

export type Answer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> }
  | { type: "noul"; noul: number };

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export const URGENCY_LEVELS = [
  "No controller action needed for at least the next 60 seconds",
  "Monitor: a controller action will probably be needed within 60 seconds",
  "Action needed now to keep 3 NM or 1000 ft from the intruder",
  "Loss of separation is imminent: the closest approach is under 30 seconds away and already inside the standard",
];

const CRITERIA: Record<Instruction, string> = {
  maintain: "No change. Correct when no intruder needs action, or the intruder has priority and is already manoeuvring.",
  turn_left_20: "Small left turn (20 degrees). Gentle lateral fix when there is time.",
  turn_right_20: "Small right turn (20 degrees). Gentle lateral fix when there is time.",
  turn_left_45: "Large left turn (45 degrees). For urgent lateral avoidance.",
  turn_right_45: "Large right turn (45 degrees). For urgent lateral avoidance; standard for head-on traffic is to turn right.",
  climb_1000: "Climb 1000 ft. Good when the intruder is level or below and this aircraft has room above.",
  descend_1000: "Descend 1000 ft. Good when the intruder is level or above and the floor allows it.",
  speed_minus_30: "Reduce speed 30 kt. Best for in-trail spacing behind slower traffic on the same track.",
  speed_plus_30: "Increase speed 30 kt. Rarely useful; only to open spacing from traffic behind.",
  direct_to_next_fix: "Resume own navigation toward the destination fix. Correct once a vectored aircraft is clear of all traffic.",
};

function words(n: number, unit: string): string {
  return `${Math.round(n)} ${unit}`;
}

function relativeAltitude(ac: Aircraft, o: Aircraft): string {
  const d = o.alt - ac.alt;
  const trend = o.targetAlt > o.alt + 50 ? " and climbing" : o.targetAlt < o.alt - 50 ? " and descending" : " and level";
  if (Math.abs(d) < 300) return `co-altitude${trend}`;
  return `${words(Math.abs(d), "ft")} ${d > 0 ? "above" : "below"}${trend}`;
}

function clock(bearingRel: number): string {
  const b = Math.abs(bearingRel);
  const side = bearingRel < 0 ? "left" : "right";
  if (b < 15) return "dead ahead";
  if (b < 70) return `ahead-${side}`;
  if (b < 110) return `off the ${side} wing`;
  if (b < 165) return `behind-${side}`;
  return "directly behind";
}

function describeGeometry(ac: Aircraft, o: Aircraft): string {
  const g = geometry(ac, o);
  if (g.headOn) return "head-on, converging";
  if (g.sameDirection) return g.ahead ? "same direction, intruder ahead (in-trail)" : "same direction, intruder behind";
  return `crossing from the ${g.bearingRel < 0 ? "left" : "right"}`;
}

export interface CandidateState {
  callsign: string;
  phase: string;
  altitude_ft: number;
  vertical: string;
  heading_deg: number;
  speed_kt: number;
  destination: string;
  current_instruction: string;
  altitude_floor_ft: number;
  intruders: object[];
  unavailable_instructions: string[];
  situation: string;
}

/** Builds the per-aircraft JSON that Jev sees. All geometry is precomputed; Jev only judges. */
export function candidateState(
  ac: Aircraft,
  conflicts: Conflict[],
  byId: Map<number, Aircraft>,
  now: number,
  fixes: Map<string, Fix>,
): CandidateState {
  const others = [...byId.values()].filter((o) => o.id !== ac.id);
  const mine = conflicts.filter((c) => c.a === ac.id || c.b === ac.id).sort((x, y) => x.tLoss - y.tLoss);
  const intruders = mine.map((c) => {
    const o = byId.get(c.a === ac.id ? c.b : c.a)!;
    const g = geometry(ac, o);
    return {
      callsign: o.callsign,
      phase: o.phase,
      position: `${clock(g.bearingRel)}, ${c.distNow.toFixed(1)} NM`,
      relative_altitude: relativeAltitude(ac, o),
      geometry: describeGeometry(ac, o),
      closest_approach: `${c.cpaNm.toFixed(1)} NM in ${Math.round(c.tCpa)} s`,
      separation_lost_in_s: Math.round(c.tLoss),
      their_current_instruction: o.instruction,
      they_have_priority: mustYield(ac, o),
    };
  });
  const unavailable: string[] = [];
  for (const i of INSTRUCTIONS) {
    const v = validateInstruction(ac, i, others, now, fixes);
    if (!v.ok && v.reason !== "cooldown") unavailable.push(`${i} (${reasonText(v.reason)})`);
  }
  const leg = ac.route[ac.routeIdx];
  const fix = leg ? fixes.get(leg.fix) : undefined;
  const dest = leg && fix ? `${leg.fix}, ${words(distanceNm(ac.x, ac.y, fix.x, fix.y), "NM")} away` : "none";
  const vectored = ac.vectorHdg !== null || ac.assignedAlt !== null;
  const since = Math.round(now - ac.instructionAt);
  const situation =
    intruders.length === 0 && vectored
      ? `Vectored off route ${Math.round(now - ac.vectorSince)} s ago for traffic; now clear of all traffic and needs a clearance to resume navigation.`
      : intruders.length === 0
        ? "No predicted conflict in the next 120 s."
        : `${intruders.length} predicted conflict(s) in the next 120 s; the most urgent loses separation in ${Math.round(mine[0].tLoss)} s.`;
  return {
    callsign: ac.callsign,
    phase: ac.phase,
    altitude_ft: Math.round(ac.alt),
    vertical:
      ac.targetAlt > ac.alt + 50 ? `climbing to ${ac.targetAlt}` : ac.targetAlt < ac.alt - 50 ? `descending to ${ac.targetAlt}` : "level",
    heading_deg: Math.round(ac.hdg),
    speed_kt: Math.round(ac.spd),
    destination: dest,
    current_instruction: since > 900 ? "none yet" : `${ac.instruction} (issued ${since} s ago)`,
    altitude_floor_ft: altitudeFloor(ac),
    intruders,
    unavailable_instructions: unavailable,
    situation,
  };
}

function reasonText(r: Rejection | undefined): string {
  switch (r) {
    case "below_floor":
      return "would go below the altitude floor";
    case "above_ceiling":
      return "above the sector ceiling";
    case "too_slow":
      return "below minimum speed";
    case "too_fast":
      return "above maximum speed";
    case "creates_conflict":
      return "would turn or climb into other traffic";
    case "worsens_conflict":
      return "would bring the predicted loss of separation closer";
    case "already_on_route":
      return "already on route";
    case "established_on_final":
      return "established on final approach";
    default:
      return "not available";
  }
}

export function questionIds(i: number): { instruction: string; urgency: string; handoff: string } {
  return { instruction: `a${i}_instruction`, urgency: `a${i}_urgency`, handoff: `a${i}_handoff` };
}

/** One batched request for every candidate aircraft: three questions each, all over the same state. */
export function buildRequest(states: CandidateState[]): JevRequest {
  const questions: Record<string, Question> = {};
  states.forEach((_, i) => {
    const ids = questionIds(i);
    const ref = `\`aircraft[${i}]\``;
    questions[ids.instruction] = {
      type: "choice",
      instructions: `You are the radar controller. Choose the single ATC instruction to issue now to ${ref} (callsign ${ref}.callsign). Consider ${ref}.intruders, ${ref}.situation and ${ref}.unavailable_instructions (never choose an unavailable instruction). Resolve the most urgent conflict with the smallest manoeuvre that works; prefer vertical separation when the intruder is co-altitude and there is time; prefer speed reduction for in-trail traffic; turn away from the intruder, and turn right for head-on traffic. If the intruder has priority and is already manoeuvring, or there is no conflict and the aircraft is on route, choose maintain.`,
      criteria: CRITERIA,
    };
    questions[ids.urgency] = {
      type: "score",
      instructions: `How urgently does ${ref} need a controller action, based on ${ref}.intruders[*].separation_lost_in_s and ${ref}.intruders[*].closest_approach?`,
      criteria: URGENCY_LEVELS,
    };
    questions[ids.handoff] = {
      type: "noul",
      instructions: `Is ${ref} clear of traffic and ready to be released: no intruders listed, so it can resume its own route and be handed off to the next controller?`,
      criteria: {
        true: "No intruders listed; nothing else needs to happen before it can resume navigation and be handed off",
        false: "Has at least one intruder listed, or still needs a clearance to stay separated",
      },
    };
  });
  return { state: { aircraft: states }, model: "jev-latest", questions };
}

export interface ParsedAnswer {
  probabilities: Partial<Record<Instruction, number>>;
  choice: Instruction | null;
  confidence: number;
  urgency: number;
  handoff: number;
}

export function parseAnswers(resp: JevResponse, count: number): ParsedAnswer[] {
  const out: ParsedAnswer[] = [];
  for (let i = 0; i < count; i++) {
    const ids = questionIds(i);
    const a = resp.answers[ids.instruction];
    const u = resp.answers[ids.urgency];
    const h = resp.answers[ids.handoff];
    const probabilities: Partial<Record<Instruction, number>> = {};
    let choice: Instruction | null = null;
    let confidence = 0;
    if (a && a.type === "choice") {
      for (const k of INSTRUCTIONS) if (typeof a.probabilities[k] === "number") probabilities[k] = a.probabilities[k];
      choice = (INSTRUCTIONS as readonly string[]).includes(a.choice) ? (a.choice as Instruction) : null;
      confidence = a.confidence;
    }
    out.push({
      probabilities,
      choice,
      confidence,
      urgency: u && u.type === "score" ? u.score : 0,
      handoff: h && h.type === "noul" ? h.noul : 0,
    });
  }
  return out;
}

/** Rolling latency samples with percentiles. */
export class LatencyStats {
  private samples: number[] = [];
  last = 0;
  count = 0;

  constructor(private readonly window = 200) {}

  push(ms: number): void {
    this.last = ms;
    this.count++;
    this.samples.push(ms);
    if (this.samples.length > this.window) this.samples.shift();
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  get p50(): number {
    return this.percentile(50);
  }

  get p95(): number {
    return this.percentile(95);
  }
}

/**
 * An answer is stale when a newer request for the same aircraft has already been consumed, or when the
 * simulation has moved on further than `maxAgeS` since the request was built.
 */
export function isStale(answerSeq: number, lastAppliedSeq: number | undefined, requestSimTime: number, nowSimTime: number, maxAgeS = 15): boolean {
  if (lastAppliedSeq !== undefined && answerSeq <= lastAppliedSeq) return true;
  return nowSimTime - requestSimTime > maxAgeS;
}

export async function callJev(req: JevRequest, signal?: AbortSignal): Promise<JevResponse> {
  const r = await fetch("/api/jev", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!r.ok) throw new Error(`jev ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as JevResponse;
}
