import type { Point, UnitType } from "./city.ts";

export const CATEGORIES = [
  "fire",
  "medical",
  "police",
  "traffic",
  "utility",
  "rescue",
  "non_emergency",
  "duplicate_update",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PACKAGES = [
  "ambulance",
  "ambulance+fire",
  "police_1",
  "police_2+",
  "fire_engine",
  "fire_full",
  "utility_crew",
  "none",
] as const;
export type Package = (typeof PACKAGES)[number];

export const SEVERITY_LEVELS = [
  "Information only: nothing is happening that needs a response",
  "Minor: no injuries, no immediate risk, routine response can wait",
  "Moderate: possible minor injuries or property at risk, prompt response",
  "Serious: injuries likely or active danger to people, urgent response",
  "Immediate threat to life: someone may die in the next minutes without help",
] as const;
export type Severity = 0 | 1 | 2 | 3 | 4;

export const PACKAGE_UNITS: Record<Package, UnitType[]> = {
  ambulance: ["ambulance"],
  "ambulance+fire": ["ambulance", "engine"],
  police_1: ["police"],
  "police_2+": ["police", "police"],
  fire_engine: ["engine"],
  fire_full: ["engine", "engine", "ladder", "ambulance"],
  utility_crew: ["utility"],
  none: [],
};

export type Channel = "call" | "sms" | "sensor";

export interface Truth {
  category: Category;
  severity: Severity;
  units: Package;
  multipleVictims: boolean;
  hazmat: boolean;
  callerInDanger: boolean;
  /** Report id of the original incident this report is a follow-up to. */
  duplicateOf: string | null;
}

export interface Report {
  id: string;
  seq: number;
  /** Arrival time in simulation seconds. */
  t: number;
  channel: Channel;
  text: string;
  address: string;
  loc: Point;
  districtId: string;
  truth: Truth;
}

export interface OpenIncidentSummary {
  id: string;
  category: Category;
  summary: string;
  address: string;
  age_seconds: number;
  distance_m: number;
  units_dispatched: number;
}

export type DecisionSource = "jev" | "fallback" | "simulated";

export interface Decision {
  category: Category;
  severity: Severity;
  severityScore: number;
  multipleVictims: number;
  hazmat: number;
  callerInDanger: number;
  units: Package;
  duplicateP: number;
  /** Id of the open incident to merge into, or null for a new incident. */
  mergeInto: string | null;
  categoryProbs: Record<string, number>;
  unitsProbs: Record<string, number>;
  severityProbs: Record<string, number>;
  categoryConfidence: number;
  lowConfidence: boolean;
  source: DecisionSource;
}
