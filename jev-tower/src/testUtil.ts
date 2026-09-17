import type { Aircraft, Phase } from "./types.ts";

/** Minimal level-flight overflight for unit tests; override any field. */
export function mkAircraft(over: Partial<Aircraft> & { id: number }): Aircraft {
  const phase: Phase = over.phase ?? "overflight";
  const alt = over.alt ?? 10000;
  const spd = over.spd ?? 300;
  return {
    callsign: `TST${over.id}`,
    phase,
    x: 0,
    y: 0,
    alt,
    hdg: 90,
    spd,
    targetAlt: alt,
    targetSpd: spd,
    vectorHdg: null,
    assignedAlt: null,
    assignedSpd: null,
    vectorSince: 0,
    route: [
      { fix: "BAYLO", alt, spd },
      { fix: "TULOK", alt, spd },
    ],
    routeIdx: 1,
    instruction: "maintain",
    instructionAt: -1000,
    spawnedAt: 0,
    baselineTime: 0,
    haloUntil: 0,
    urgency: 0,
    handoff: 0,
    ...over,
  };
}
