import { describe, expect, it } from "vitest";
import { buildCity, createFleet, distance } from "./city.ts";
import { generateSchedule, generateSurge } from "./generator.ts";
import { buildRequest, heuristicCategory, heuristicDecision, parseResponse, QUESTIONS } from "./jev.ts";
import { fmtSeconds, median, percentile, ratePerSecond } from "./kpi.ts";
import { DEFAULT_SEED, JEV_TIMEOUT_SECONDS, MANUAL_SECONDS, RUN_SECONDS, Sim, type Decider } from "./sim.ts";
import type { OpenIncidentSummary, Report } from "./types.ts";

function run(sim: Sim, seconds: number, dt = 0.1): void {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("generator", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = generateSchedule(DEFAULT_SEED, RUN_SECONDS);
    const b = generateSchedule(DEFAULT_SEED, RUN_SECONDS);
    const c = generateSchedule(DEFAULT_SEED + 1, RUN_SECONDS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("produces a bursty stream with duplicates, non-emergencies and every channel", () => {
    const s = generateSchedule(DEFAULT_SEED, RUN_SECONDS);
    expect(s.length).toBeGreaterThan(150);
    expect(s.length).toBeLessThan(400);
    for (let i = 1; i < s.length; i++) expect(s[i].t).toBeGreaterThanOrEqual(s[i - 1].t);
    expect(s.every((r) => r.t >= 0 && r.t <= RUN_SECONDS)).toBe(true);
    expect(new Set(s.map((r) => r.id)).size).toBe(s.length);
    expect(s.filter((r) => r.truth.duplicateOf !== null).length).toBeGreaterThan(30);
    expect(s.filter((r) => r.truth.category === "non_emergency").length).toBeGreaterThan(3);
    expect(new Set(s.map((r) => r.channel))).toEqual(new Set(["call", "sms", "sensor"]));
    const perSecond = new Map<number, number>();
    for (const r of s) perSecond.set(Math.floor(r.t), (perSecond.get(Math.floor(r.t)) ?? 0) + 1);
    expect(Math.max(...perSecond.values())).toBeGreaterThanOrEqual(3);
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(8);
    const city = buildCity();
    expect(s.every((r) => r.loc.x >= 0 && r.loc.x <= city.width && r.loc.y >= 0 && r.loc.y <= city.height)).toBe(true);
  });

  it("follow-ups reference an earlier report", () => {
    const s = generateSchedule(DEFAULT_SEED, RUN_SECONDS);
    const byId = new Map(s.map((r) => [r.id, r]));
    for (const r of s) {
      if (r.truth.duplicateOf === null) continue;
      const parent = byId.get(r.truth.duplicateOf);
      expect(parent).toBeDefined();
      expect(parent!.t).toBeLessThan(r.t);
      expect(distance(parent!.loc, r.loc)).toBeLessThan(200);
    }
  });

  it("surge fires 40 reports inside the window", () => {
    const s = generateSurge(1, 100, 5000, 40, 10);
    expect(s).toHaveLength(40);
    expect(s[0].t).toBeGreaterThanOrEqual(100);
    expect(s[s.length - 1].t).toBeLessThanOrEqual(110);
    expect(s.filter((r) => r.truth.duplicateOf === null).length).toBeGreaterThanOrEqual(5);
    expect(s.filter((r) => r.truth.duplicateOf !== null).length).toBeGreaterThan(10);
  });
});

describe("city", () => {
  it("builds a deterministic fleet with every unit type at a depot", () => {
    const city = buildCity();
    const fleet = createFleet(city);
    expect(fleet).toEqual(createFleet(buildCity()));
    expect(new Set(fleet.map((u) => u.type))).toEqual(new Set(["ambulance", "police", "engine", "ladder", "utility"]));
    expect(new Set(fleet.map((u) => u.id)).size).toBe(fleet.length);
    const depotIds = new Set(city.depots.map((d) => d.id));
    expect(fleet.every((u) => depotIds.has(u.depotId))).toBe(true);
  });
});

function report(text: string, over: Partial<Report> = {}): Report {
  return {
    id: "R-1",
    seq: 1,
    t: 0,
    channel: "call",
    text,
    address: "12 Main St, Midtown",
    loc: { x: 2000, y: 1400 },
    districtId: "MT",
    truth: { category: "fire", severity: 4, units: "fire_full", multipleVictims: true, hazmat: true, callerInDanger: true, duplicateOf: null },
    ...over,
  };
}

const nearby: OpenIncidentSummary[] = [
  { id: "INC-001", category: "fire", summary: "Building on fire", address: "12 Main St", age_seconds: 40, distance_m: 60, units_dispatched: 3 },
  { id: "INC-002", category: "medical", summary: "Collapsed", address: "5th Ave", age_seconds: 300, distance_m: 900, units_dispatched: 1 },
];

function answers(over: Record<string, unknown> = {}) {
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 900, output_tokens: 250 },
    answers: {
      category: { type: "choice", choice: "fire", confidence: 0.9, probabilities: { fire: 0.92, rescue: 0.05, medical: 0.03 } },
      severity: { type: "score", score: 4, legend: "Immediate threat to life", probabilities: { "3": 0.2, "4": 0.8 } },
      multiple_victims: { type: "noul", noul: 0.85 },
      hazmat_or_fire_spread: { type: "noul", noul: 0.7 },
      caller_in_danger_now: { type: "noul", noul: 0.9 },
      units_needed: { type: "choice", choice: "fire_full", confidence: 0.8, probabilities: { fire_full: 0.85, fire_engine: 0.15 } },
      is_duplicate_of_open_incident: { type: "noul", noul: 0.1 },
      ...over,
    },
  };
}

describe("jev request / answer parsing", () => {
  it("builds a fan-out request with all seven questions and the nearby incidents in state", () => {
    const req = buildRequest(report("fire!"), nearby);
    expect(req.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(req.questions).sort()).toEqual(["caller_in_danger_now", "category", "hazmat_or_fire_spread", "is_duplicate_of_open_incident", "multiple_victims", "severity", "units_needed"]);
    expect(req.questions).toBe(QUESTIONS);
    const state = req.state as { report: { text: string }; nearby_open_incidents: { id: string; distance_m: number }[] };
    expect(state.report.text).toBe("fire!");
    expect(state.nearby_open_incidents).toHaveLength(2);
    expect(state.nearby_open_incidents[0]).toMatchObject({ id: "INC-001", distance_m: 60 });
    expect(JSON.stringify(req)).not.toContain("truth");
  });

  it("parses a well-formed answer into a typed decision", () => {
    const parsed = parseResponse(answers(), report("fire"), nearby);
    expect(parsed).not.toBeNull();
    const d = parsed!.decision;
    expect(d.category).toBe("fire");
    expect(d.severity).toBe(4);
    expect(d.units).toBe("fire_full");
    expect(d.multipleVictims).toBeCloseTo(0.85);
    expect(d.mergeInto).toBeNull();
    expect(d.lowConfidence).toBe(false);
    expect(d.source).toBe("jev");
    expect(parsed!.usage.input_tokens).toBe(900);
    expect(d.categoryProbs.fire).toBeCloseTo(0.92);
  });

  it("merges into the nearest open incident when duplicate probability is high", () => {
    const d = parseResponse(answers({ is_duplicate_of_open_incident: { type: "noul", noul: 0.93 } }), report("the fire is bigger now"), nearby)!.decision;
    expect(d.mergeInto).toBe("INC-001");
  });

  it("does not merge when the only open incidents are far away", () => {
    const far = nearby.map((n) => ({ ...n, distance_m: 2000 }));
    const d = parseResponse(answers({ category: { type: "choice", choice: "duplicate_update", confidence: 0.9, probabilities: {} } }), report("update on that fire"), far)!.decision;
    expect(d.mergeInto).toBeNull();
    expect(d.category).toBe("fire");
  });

  it("clamps out-of-range severity and rejects unknown choices", () => {
    const d = parseResponse(answers({ severity: { type: "score", score: 9, probabilities: {} }, units_needed: { type: "choice", choice: "helicopter", confidence: 0.5, probabilities: {} } }), report("fire, people inside"), [])!.decision;
    expect(d.severity).toBe(4);
    expect(d.units).toBe("fire_full");
  });

  it("uses the heuristic category when Jev is not confident", () => {
    const d = parseResponse(answers({ category: { type: "choice", choice: "utility", confidence: 0.12, probabilities: { utility: 0.2, fire: 0.19 } } }), report("smoke everywhere flames"), [])!.decision;
    expect(d.lowConfidence).toBe(true);
    expect(d.category).toBe("fire");
  });

  it("returns null for malformed payloads", () => {
    expect(parseResponse(null, report("x"), [])).toBeNull();
    expect(parseResponse({ answers: {} }, report("x"), [])).toBeNull();
    expect(parseResponse({ answers: { category: { type: "noul", noul: 1 } } }, report("x"), [])).toBeNull();
    expect(parseResponse("nope", report("x"), [])).toBeNull();
  });
});

describe("fallback heuristic", () => {
  it("classifies obvious texts and flags non-emergencies", () => {
    expect(heuristicCategory("There's a fire in the building, flames from the windows")).toBe("fire");
    expect(heuristicCategory("my husband collapsed and is not breathing")).toBe("medical");
    expect(heuristicCategory("someone is breaking in downstairs")).toBe("police");
    expect(heuristicCategory("two cars crashed at the intersection")).toBe("traffic");
    expect(heuristicCategory("what time does the DMV open")).toBe("non_emergency");
  });

  it("produces a complete, deterministic decision and merges close same-category repeats", () => {
    const r = report("the fire on Main St is spreading to the next building");
    const a = heuristicDecision(r, nearby);
    const b = heuristicDecision(r, nearby);
    expect(a).toEqual(b);
    expect(a.source).toBe("fallback");
    expect(a.category).toBe("fire");
    expect(a.mergeInto).toBe("INC-001");
    expect(a.units).not.toBe("none");
    expect(heuristicDecision(report("what time does the library open"), nearby).units).toBe("none");
  });
});

describe("kpi math", () => {
  it("median / percentile / rate / formatting", () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([1, 3, 2, 4])).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(ratePerSecond([1, 2, 3, 9, 9.5], 10, 5)).toBeCloseTo(0.4);
    expect(fmtSeconds(3.14)).toBe("3.1s");
    expect(fmtSeconds(45)).toBe("45s");
    expect(fmtSeconds(125)).toBe("2m05");
  });
});

describe("dispatch engine", () => {
  it("manual mode decides exactly one report per 12 s, FIFO", () => {
    const sim = new Sim("manual", DEFAULT_SEED);
    run(sim, 61);
    const decided = sim.feed.filter((f) => f.status === "done");
    expect(decided.length).toBe(Math.floor((61 - sim.schedule[0].t) / MANUAL_SECONDS));
    expect(decided.map((f) => f.report.seq)).toEqual(decided.map((f) => f.report.seq).sort((a, b) => a - b));
    expect(sim.kpis().queued).toBe(sim.feed.length - decided.length);
  });

  it("assigns the nearest available units of the right type and animates them to the scene", () => {
    const sim = new Sim("jev", DEFAULT_SEED, null);
    run(sim, sim.schedule[0].t + 0.2);
    const inc = sim.incidents.find((i) => i.unitIds.length > 0);
    expect(inc).toBeDefined();
    const unit = sim.units.find((u) => u.id === inc!.unitIds[0])!;
    expect(unit.status).toBe("enroute");
    expect(unit.incidentId).toBe(inc!.id);
    const dispatchedIds = new Set(sim.incidents.flatMap((i) => i.unitIds));
    const others = sim.units.filter((u) => u.type === unit.type && !dispatchedIds.has(u.id));
    for (const o of others) expect(distance(o.home, inc!.loc)).toBeGreaterThanOrEqual(distance(unit.home, inc!.loc) - 1e-9);
    expect(inc!.dispatchedAt).not.toBeNull();
    const before = distance(unit.pos, inc!.loc);
    run(sim, 5);
    expect(distance(unit.pos, inc!.loc)).toBeLessThan(before);
    run(sim, 300);
    expect(inc!.firstArrivalAt).not.toBeNull();
    expect(inc!.status).toBe("closed");
  });

  it("merges duplicate reports into the open incident instead of opening a new one", async () => {
    const decider: Decider = async (req) => {
      const state = req.state as { report: { text: string }; nearby_open_incidents: unknown[] };
      const dup = state.report.text.includes("spreading") && state.nearby_open_incidents.length > 0;
      return { latencyMs: 120, json: answers({ is_duplicate_of_open_incident: { type: "noul", noul: dup ? 0.95 : 0.05 } }) };
    };
    const sim = new Sim("jev", DEFAULT_SEED, decider, 1);
    const base = report("Building on fire at 12 Main St", { id: "R-1", seq: 1, t: 0.1 });
    sim.schedule = [base, report("the fire on Main St is spreading", { id: "R-2", seq: 2, t: 1, loc: { x: 2040, y: 1420 } })];
    run(sim, 0.5);
    await flush();
    run(sim, 1);
    await flush();
    run(sim, 0.5);
    expect(sim.incidents).toHaveLength(1);
    expect(sim.incidents[0].mergedCount).toBe(1);
    expect(sim.kpis().merged).toBe(1);
    expect(sim.feedItem("R-2")!.outcome).toBe("merged");
    expect(sim.feedItem("R-2")!.incidentId).toBe("INC-001");
    expect(sim.kpis().jev.inputTokens).toBe(1800);
    expect(sim.kpis().jev.p50Ms).toBe(120);
  });

  it("falls back to the heuristic when Jev is slow, and discards the stale answer", async () => {
    let release: (() => void) | null = null;
    const decider: Decider = () => new Promise((resolve) => { release = () => resolve({ latencyMs: 5000, json: answers() }); });
    const sim = new Sim("jev", DEFAULT_SEED, decider, 1);
    sim.schedule = [report("fire at 12 Main St people inside", { t: 0.1 })];
    run(sim, JEV_TIMEOUT_SECONDS + 0.5);
    const item = sim.feedItem("R-1")!;
    expect(item.status).toBe("done");
    expect(item.timedOut).toBe(true);
    expect(item.decision!.source).toBe("fallback");
    expect(sim.incidents).toHaveLength(1);
    release!();
    await flush();
    run(sim, 0.2);
    expect(sim.kpis().jev.stale).toBe(1);
    expect(sim.kpis().jev.fallbacks).toBe(1);
    expect(sim.incidents).toHaveLength(1);
  });

  it("falls back when the request fails", async () => {
    const decider: Decider = async () => { throw new Error("HTTP 503"); };
    const sim = new Sim("jev", DEFAULT_SEED, decider, 1);
    sim.schedule = [report("someone collapsed not breathing", { t: 0.1 })];
    run(sim, 0.2);
    await flush();
    run(sim, 0.2);
    expect(sim.feedItem("R-1")!.decision!.source).toBe("fallback");
    expect(sim.feedItem("R-1")!.decision!.category).toBe("medical");
    expect(sim.kpis().jev.errors).toBe(1);
  });

  it("counts critical incidents waiting over 60 s and the surge adds 40 reports", () => {
    const sim = new Sim("manual", DEFAULT_SEED);
    run(sim, 90);
    const k = sim.kpis();
    expect(k.criticalWaiting).toBeGreaterThan(0);
    const before = sim.schedule.length;
    sim.surge();
    expect(sim.schedule.length).toBe(before + 40);
    run(sim, 11);
    expect(sim.feed.filter((f) => f.report.seq >= 10_000).length).toBe(40);
  });

  it("same seed gives identical results for the heuristic run", () => {
    const a = new Sim("jev", DEFAULT_SEED, null);
    const b = new Sim("jev", DEFAULT_SEED, null);
    run(a, 60);
    run(b, 60);
    expect(a.kpis()).toEqual(b.kpis());
    expect(a.incidents.map((i) => [i.id, i.category, i.unitIds])).toEqual(b.incidents.map((i) => [i.id, i.category, i.unitIds]));
  });
});
