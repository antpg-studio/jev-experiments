import { distance } from "./city.ts";
import {
  CATEGORIES,
  PACKAGES,
  SEVERITY_LEVELS,
  type Category,
  type Decision,
  type OpenIncidentSummary,
  type Package,
  type Report,
  type Severity,
} from "./types.ts";

/** USD per input token for jev-1.13 (docs.typesafe.ai/models: $0.042 per Mtok, output free). */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const MODEL = "jev-latest";

/** Merge into an open incident only when Jev is at least this sure it is the same event. */
export const DUPLICATE_THRESHOLD = 0.6;
/** Max distance between a report and an open incident for a merge to be geographically plausible. */
export const MERGE_RADIUS_M = 350;
/** Below this category confidence the deterministic heuristic decides the category instead. */
export const LOW_CONFIDENCE = 0.3;

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export const QUESTIONS: Record<string, Question> = {
  category: {
    type: "choice",
    instructions:
      "Which single service does `report.text` primarily need? If it is clearly about one of the events already listed in `nearby_open_incidents` (same place, same kind of event), choose duplicate_update.",
    criteria: {
      fire: "Fire, smoke, explosion, or a gas leak that could ignite",
      medical: "A sick or injured person who needs paramedics and no other service",
      police: "Crime, violence, threats, weapons, burglary, or suspicious activity",
      traffic: "A vehicle collision, a person struck by a vehicle, or a road hazard caused by vehicles",
      utility: "Downed power lines, transformer fault, water main, sewage, street light or manhole problems",
      rescue: "A person trapped or in the water: elevator entrapment, trench collapse, drowning, sinking vehicle",
      non_emergency: "Not an emergency: a question, complaint, noise, animal, minor nuisance, test call, or administrative request",
      duplicate_update: "New information or a repeat call about an event that is already in `nearby_open_incidents`",
    },
  },
  severity: {
    type: "score",
    instructions: "How severe is the situation described in `report.text` for the people involved right now?",
    criteria: [...SEVERITY_LEVELS],
  },
  multiple_victims: {
    type: "noul",
    instructions: "Does `report.text` indicate that more than one person is injured, trapped, or in danger?",
    criteria: { true: "Two or more people hurt or at risk", false: "One person or nobody at risk" },
  },
  hazmat_or_fire_spread: {
    type: "noul",
    instructions: "Does `report.text` describe fire that is spreading, an explosion risk, fuel or gas leak, live electrical wire, or other hazardous material?",
  },
  caller_in_danger_now: {
    type: "noul",
    instructions: "Is the person sending `report.text` themselves in immediate physical danger right now?",
    criteria: { true: "The caller is trapped, threatened, injured, or inside the hazard", false: "The caller is a safe bystander or reporting after the fact" },
  },
  units_needed: {
    type: "choice",
    instructions: "Which response package should be sent for `report.text` if it is a new incident? Pick the smallest package that covers every need.",
    criteria: {
      ambulance: "One ambulance: a single sick or injured person, no fire or entrapment",
      "ambulance+fire": "One ambulance and one fire engine: injured people plus fire, fuel leak, entrapment, or water rescue",
      police_1: "One police unit: a report to take, a minor dispute, a non-violent situation",
      "police_2+": "Two or more police units: violence in progress, weapons, a crime in progress, a crowd",
      fire_engine: "One fire engine: a small contained fire, gas smell, or a technical rescue without injuries",
      fire_full: "Full fire response, engines plus ladder plus ambulance: a structure fire with people possibly inside",
      utility_crew: "A utility repair crew: power line, transformer, water main, sewer, street light, manhole",
      none: "No units: not an emergency or nothing to respond to",
    },
  },
  is_duplicate_of_open_incident: {
    type: "noul",
    instructions: "Does `report.text` describe the same event as one of the entries in `nearby_open_incidents`? Judge by matching place and kind of event, not by wording.",
    criteria: {
      true: "Same location and same kind of event as a listed open incident",
      false: "A different event, or nothing similar is listed nearby",
    },
  },
};

export interface JevRequest {
  state: unknown;
  model: string;
  questions: Record<string, Question>;
}

export function buildRequest(report: Report, nearby: OpenIncidentSummary[]): JevRequest {
  return {
    model: MODEL,
    state: {
      report: {
        channel: report.channel === "call" ? "911 call transcript" : report.channel === "sms" ? "text message" : "automated sensor alert",
        text: report.text,
        geocoded_address: report.address,
      },
      nearby_open_incidents: nearby.map((n) => ({
        id: n.id,
        category: n.category,
        address: n.address,
        first_report: n.summary,
        age_seconds: n.age_seconds,
        distance_m: Math.round(n.distance_m),
        units_dispatched: n.units_dispatched,
      })),
    },
    questions: QUESTIONS,
  };
}

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ParsedResponse {
  decision: Decision;
  usage: JevUsage;
  model: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function probs(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(v)) if (typeof p === "number") out[k] = p;
  return out;
}

function noul(answers: Record<string, unknown>, id: string): number | null {
  const a = answers[id];
  if (!isRecord(a) || a.type !== "noul") return null;
  return typeof a.noul === "number" ? a.noul : null;
}

export function clampSeverity(score: number): Severity {
  return Math.max(0, Math.min(4, Math.round(score))) as Severity;
}

/**
 * Turn a raw Jev response into a Decision, or null when the payload is unusable
 * (callers then fall back to `heuristicDecision`).
 */
export function parseResponse(json: unknown, report: Report, nearby: OpenIncidentSummary[]): ParsedResponse | null {
  if (!isRecord(json) || !isRecord(json.answers)) return null;
  const a = json.answers;
  const cat = a.category;
  const units = a.units_needed;
  const sev = a.severity;
  if (!isRecord(cat) || cat.type !== "choice" || !isRecord(units) || units.type !== "choice" || !isRecord(sev) || sev.type !== "score") return null;
  const dupP = noul(a, "is_duplicate_of_open_incident");
  if (dupP === null) return null;

  const categoryConfidence = num(cat.confidence);
  let category = (CATEGORIES as readonly string[]).includes(String(cat.choice)) ? (cat.choice as Category) : null;
  const heuristic = heuristicDecision(report, nearby);
  const lowConfidence = category === null || categoryConfidence < LOW_CONFIDENCE;
  if (category === null || (lowConfidence && category !== "duplicate_update")) category = heuristic.category;

  let pkg = (PACKAGES as readonly string[]).includes(String(units.choice)) ? (units.choice as Package) : heuristic.units;
  const severityScore = num(sev.score, heuristic.severityScore);
  const severity = clampSeverity(severityScore);

  const mergeInto = dupP >= DUPLICATE_THRESHOLD || category === "duplicate_update" ? pickMergeTarget(report, nearby) : null;
  if (category === "duplicate_update" && mergeInto === null) {
    // Jev thinks it's a repeat but nothing plausible is open nearby: treat as a fresh incident.
    category = heuristic.category;
    pkg = heuristic.units;
  }
  if (category === "non_emergency") pkg = "none";
  if (pkg === "none" && category !== "non_emergency" && mergeInto === null) pkg = heuristic.units;

  const usageRaw = isRecord(json.usage) ? json.usage : {};
  return {
    model: typeof json.model === "string" ? json.model : "unknown",
    usage: { input_tokens: num(usageRaw.input_tokens), output_tokens: num(usageRaw.output_tokens) },
    decision: {
      category,
      severity,
      severityScore,
      multipleVictims: noul(a, "multiple_victims") ?? 0,
      hazmat: noul(a, "hazmat_or_fire_spread") ?? 0,
      callerInDanger: noul(a, "caller_in_danger_now") ?? 0,
      units: pkg,
      duplicateP: dupP,
      mergeInto,
      categoryProbs: probs(cat.probabilities),
      unitsProbs: probs(units.probabilities),
      severityProbs: probs(sev.probabilities),
      categoryConfidence,
      lowConfidence,
      source: "jev",
    },
  };
}

/** Nearest open incident within MERGE_RADIUS_M; the list is already sorted by distance. */
export function pickMergeTarget(report: Report, nearby: OpenIncidentSummary[]): string | null {
  const hit = nearby.find((n) => n.distance_m <= MERGE_RADIUS_M);
  return hit ? hit.id : null;
}

const KEYWORDS: [Category, RegExp][] = [
  ["fire", /\b(fire|flames?|smoke|smoking|burning|explod|gas smell|smell(s)? (like|of) gas|alarm panel|smoke detector|gas sensor)\b/i],
  ["rescue", /\b(trapped|stuck|elevator|drain|trench|sinking|drown|in the water|off the pier)\b/i],
  ["traffic", /\b(crash(ed|es|ing)?|collision|accident|rear.?ended|fender|hit by a car|knocked down|airbag|telematics|traffic light|bus (crash|flipped|overturned))\b/i],
  ["medical", /\b(not breathing|collapsed|unconscious|cpr|heart attack|seizure|bleeding|blood|pills|fell|fever|ankle|nosebleed|cant breathe|can't breathe|turning blue|hurt|injured)\b/i],
  ["police", /\b(gun|shots?|shooting|fight|break(ing)? in|burglar|snatched|robbed|stabb(ed|ing)|kill|threat|spray paint|broken into|suspicious)\b/i],
  ["utility", /\b(power line|wire|transformer|water main|sewage|manhole|street ?light|pressure sensor|grid sensor|hydrant)\b/i],
];

const SEVERE = /\b(not breathing|unconscious|not moving|gun|shots|kill|trapped|people (still )?inside|dozens|blue|sinking|went under|spreading|fully on fire|heart attack|collapsed)\b/i;
const MODERATE = /\b(bleeding|broken|hurt|injured|smoke|sparking|live|stuck|fight|burglar|pain|seizure|confused)\b/i;
const MULTI = /\b(people|families|several|lots of|many|dozens|\d+ (people|guys|men|kids)|everyone|passengers|kids on the bus|children|both)\b/i;
const HAZ = /\b(spreading|gas|fuel|diesel|explod|sparking|live wire|hazard|chemical|smoke)\b/i;
const DANGER = /\b(i can'?t (get|breathe)|my leg is trapped|we'?re hiding|hiding|going to kill me|breaking down my door|i'?m on the (bus|4th floor)|my eyes are burning)\b/i;
const NONEMERGENCY = /\b(what time|how do i|is it legal|raccoon|pothole|loud music|test test|copy of a|leaking a little|opening hours)\b/i;

export function heuristicCategory(text: string): Category {
  if (NONEMERGENCY.test(text)) return "non_emergency";
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return "police";
}

export function heuristicSeverity(text: string, category: Category): Severity {
  if (category === "non_emergency") return 0;
  if (SEVERE.test(text)) return category === "utility" ? 3 : 4;
  if (MODERATE.test(text)) return 3;
  return category === "medical" ? 2 : 1;
}

export function heuristicPackage(category: Category, severity: Severity, multi: boolean): Package {
  switch (category) {
    case "fire":
      return severity >= 4 ? "fire_full" : "fire_engine";
    case "medical":
      return "ambulance";
    case "police":
      return severity >= 3 || multi ? "police_2+" : "police_1";
    case "traffic":
      return severity >= 4 ? "ambulance+fire" : severity >= 3 ? "ambulance" : "police_1";
    case "utility":
      return "utility_crew";
    case "rescue":
      return severity >= 4 ? "ambulance+fire" : "fire_engine";
    default:
      return "none";
  }
}

/** Deterministic keyword triage, used when Jev is slow, fails, or is not confident. */
export function heuristicDecision(report: Report, nearby: OpenIncidentSummary[]): Decision {
  const text = report.text;
  const category = heuristicCategory(text);
  const severity = heuristicSeverity(text, category);
  const multi = MULTI.test(text);
  const nearest = nearby[0];
  const sameKind = nearest && nearest.distance_m <= 150 && nearest.age_seconds < 900 && (nearest.category === category || /still|again|update|re |following up|calling about|anyone coming|how long/i.test(text));
  const mergeInto = sameKind && category !== "non_emergency" ? nearest.id : null;
  const oneHot = (k: string) => ({ [k]: 1 });
  return {
    category,
    severity,
    severityScore: severity,
    multipleVictims: multi ? 0.8 : 0.2,
    hazmat: HAZ.test(text) ? 0.8 : 0.1,
    callerInDanger: DANGER.test(text) ? 0.8 : 0.1,
    units: heuristicPackage(category, severity, multi),
    duplicateP: mergeInto ? 0.8 : 0.1,
    mergeInto,
    categoryProbs: oneHot(category),
    unitsProbs: oneHot(heuristicPackage(category, severity, multi)),
    severityProbs: oneHot(String(severity)),
    categoryConfidence: 0,
    lowConfidence: true,
    source: "fallback",
  };
}

/** A perfectly accurate but slow decider (used by the Manual and Slow LLM modes). */
export function simulatedDecision(report: Report, mergeTargetFor: (originalReportId: string) => string | null): Decision {
  const t = report.truth;
  const mergeInto = t.duplicateOf ? mergeTargetFor(t.duplicateOf) : null;
  const oneHot = (k: string) => ({ [k]: 1 });
  return {
    category: mergeInto ? "duplicate_update" : t.category,
    severity: t.severity,
    severityScore: t.severity,
    multipleVictims: t.multipleVictims ? 1 : 0,
    hazmat: t.hazmat ? 1 : 0,
    callerInDanger: t.callerInDanger ? 1 : 0,
    units: t.units,
    duplicateP: mergeInto ? 1 : 0,
    mergeInto,
    categoryProbs: oneHot(mergeInto ? "duplicate_update" : t.category),
    unitsProbs: oneHot(t.units),
    severityProbs: oneHot(String(t.severity)),
    categoryConfidence: 1,
    lowConfidence: false,
    source: "simulated",
  };
}

export function nearestOpen<T extends { id: string; loc: { x: number; y: number } }>(report: Report, incidents: T[], n = 5): T[] {
  return [...incidents].sort((a, b) => distance(a.loc, report.loc) - distance(b.loc, report.loc) || a.id.localeCompare(b.id)).slice(0, n);
}

export function costUsd(inputTokens: number): number {
  return inputTokens * USD_PER_INPUT_TOKEN;
}

export function costPerThousandReports(inputTokens: number, reports: number): number {
  if (reports === 0) return 0;
  return (inputTokens / reports) * 1000 * USD_PER_INPUT_TOKEN;
}
