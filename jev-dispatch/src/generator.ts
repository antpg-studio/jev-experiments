import { buildCity, type City, type District, type Point } from "./city.ts";
import { makeRng, type Rng } from "./rng.ts";
import type { Category, Channel, Package, Report, Severity } from "./types.ts";

interface Scenario {
  category: Category;
  severity: Severity;
  units: Package;
  multi?: boolean;
  hazmat?: boolean;
  callerDanger?: boolean;
  /** Districts this scenario is plausible in; empty = anywhere. */
  kinds?: District["kind"][];
  texts: string[];
  followups: string[];
  sensor?: string[];
  weight: number;
}

const SCENARIOS: Scenario[] = [
  {
    category: "fire", severity: 4, units: "fire_full", hazmat: true, multi: true, callerDanger: true, weight: 3,
    texts: [
      "There's a fire in the building at {addr}, flames coming out of the second floor windows, people still inside",
      "apartment fire {addr} smoke everywhere i'm on the 4th floor i can't get down the stairs",
      "Building on fire at {addr}. Heavy smoke. I think there are families on the upper floors.",
    ],
    followups: [
      "the fire on {street} is getting bigger, its spreading to the next building",
      "i see the smoke from {street}, is anyone coming?? big black smoke",
      "calling about the fire at {addr}, someone is waving from a window on the top floor",
    ],
    sensor: ["FIRE ALARM PANEL {addr}: multiple zones ACTIVE, sprinkler flow detected"],
  },
  {
    category: "fire", severity: 2, units: "fire_engine", weight: 3,
    texts: [
      "Dumpster on fire behind {addr}. Nobody hurt, just don't want it spreading to the fence.",
      "small fire in a trash can at {addr}, its out mostly but still smoking",
      "grill fire on a balcony at {addr}, they're throwing water on it, looks under control",
    ],
    followups: ["still smoke from the bin fire at {addr}", "hey the trash fire on {street} is still going"],
    sensor: ["SMOKE DETECTOR {addr} unit 3B: ALARM (single zone)"],
  },
  {
    category: "fire", severity: 3, units: "fire_engine", hazmat: true, weight: 2,
    texts: [
      "Strong gas smell in the hallway at {addr}, and I hear a hissing sound near the meter",
      "smells like gas really bad at {addr}, my eyes are burning, we went outside",
    ],
    followups: ["gas smell at {addr} is worse now, whole street smells", "re gas leak on {street} - neighbours evacuating"],
    sensor: ["GAS SENSOR {addr}: methane 22% LEL, rising"],
  },
  {
    category: "medical", severity: 4, units: "ambulance", weight: 4,
    texts: [
      "My husband collapsed, he's not breathing, {addr}, please hurry",
      "someone just collapsed at {addr}, unconscious, not responding, we're doing CPR",
      "man having a heart attack at {addr} he is grey and sweating and cant speak",
      "my dad cant breathe hes turning blue {addr} hurry",
    ],
    followups: ["still no ambulance at {addr}, he's still not breathing, where are you", "calling again re the man who collapsed at {addr}"],
  },
  {
    category: "medical", severity: 3, units: "ambulance", weight: 3,
    texts: [
      "Elderly woman fell down the stairs at {addr}, she's conscious but her leg is bent wrong and bleeding",
      "my roommate took a bunch of pills and is really drowsy and confused, {addr} apt 12",
      "kid had a seizure at {addr}, it stopped but she's not waking up properly",
      "guy cut his hand badly with a saw at {addr}, lots of blood, we're holding pressure",
    ],
    followups: ["the lady who fell at {addr} is in a lot of pain, how long", "update on {addr}: she's awake now but very confused"],
  },
  {
    category: "medical", severity: 1, units: "ambulance", weight: 2,
    texts: [
      "I twisted my ankle at {addr}, it's swollen, I can't really walk on it. Not urgent.",
      "my son has had a fever since yesterday and now a rash, {addr}, should someone check?",
      "nosebleed that won't stop for 20 min at {addr}, elderly man, otherwise ok",
    ],
    followups: ["re the ankle at {addr}, still waiting, no rush"],
  },
  {
    category: "police", severity: 4, units: "police_2+", multi: true, callerDanger: true, weight: 2,
    texts: [
      "there's a man with a gun in the store at {addr}, he's shouting, we're hiding in the back",
      "shots fired at {addr}, several shots, people running, I think someone is hit",
      "my ex is breaking down my door at {addr} he said he's going to kill me please please",
    ],
    followups: ["the guy with the gun at {addr} is still inside, police not here yet", "more shots on {street}, everyone is hiding"],
  },
  {
    category: "police", severity: 3, units: "police_2+", weight: 3,
    texts: [
      "big fight outside the bar at {addr}, like 8 guys, someone has a bottle",
      "Someone is breaking into the house next door at {addr}. I can see a flashlight inside. Owners are away.",
      "a man just snatched a woman's bag at {addr} and ran towards {street}, she's on the ground",
    ],
    followups: ["fight at {addr} still going, one guy is down", "the burglar at {addr} is still inside, car with no lights parked outside"],
  },
  {
    category: "police", severity: 1, units: "police_1", weight: 3,
    texts: [
      "My car was broken into overnight at {addr}. Window smashed, radio gone. Nobody around now.",
      "someone spray painted the wall of my shop at {addr} last night, want to report it",
      "there's a guy sleeping in the doorway of {addr}, he's been there for hours, not sure he's ok but he moved when I asked",
      "suspicious car has been parked outside {addr} for 2 days with someone sitting in it sometimes",
    ],
    followups: ["following up on the car break-in at {addr}, is an officer coming"],
  },
  {
    category: "traffic", severity: 4, units: "ambulance+fire", multi: true, hazmat: true, weight: 3,
    texts: [
      "Bad crash at {addr}, two cars, one is on its side and smoking, people trapped inside",
      "truck hit a bus at {addr}, lots of people hurt, there is fuel all over the road",
      "car crashed into a pole at {addr} and caught fire, driver still inside not moving",
    ],
    followups: [
      "the crash at {addr} - the car is fully on fire now",
      "im at the accident on {street}, there are at least 5 people hurt, one child",
      "re bus crash {street}, traffic completely stopped, injured people sitting on the kerb",
    ],
    sensor: ["VEHICLE TELEMATICS: severe impact detected, airbag deployed, {addr}, occupant unresponsive to callback"],
  },
  {
    category: "traffic", severity: 2, units: "police_1", weight: 3,
    texts: [
      "fender bender at {addr}, two cars, no one hurt but they are blocking the intersection and arguing",
      "car rear-ended me at {addr}, we're both fine, need a police report for insurance",
      "traffic light at {addr} is out, cars are just going through, nearly saw a crash",
    ],
    followups: ["the two cars at {addr} are still blocking the road, huge backup"],
  },
  {
    category: "traffic", severity: 3, units: "ambulance", weight: 2,
    texts: [
      "cyclist got hit by a car at {addr}, she's awake but bleeding from her head and her arm looks broken",
      "pedestrian knocked down at {addr}, older man, he's not getting up, driver stayed",
    ],
    followups: ["the cyclist at {addr} is getting dizzy, please hurry", "update on pedestrian hit at {addr}: he's conscious now"],
  },
  {
    category: "utility", severity: 3, units: "utility_crew", hazmat: true, weight: 2,
    texts: [
      "A power line came down at {addr}, it's sparking on the road and there are kids around",
      "transformer exploded at {addr}, loud bang, power out on the whole block, wire hanging low over the sidewalk",
    ],
    followups: ["the downed wire at {addr} is still live and sparking", "anyone coming for the wire on {street}? people are stepping over it"],
    sensor: ["GRID SENSOR feeder 14 ({addr}): fault current, breaker tripped, line-down signature"],
  },
  {
    category: "utility", severity: 1, units: "utility_crew", weight: 3,
    texts: [
      "water main burst at {addr}, water gushing down the street, basement of the corner shop is flooding",
      "street light out at {addr}, it's really dark on this corner",
      "manhole cover is missing at {addr}, cars are swerving around it",
      "sewage smell and water coming up from a drain at {addr}",
    ],
    followups: ["still no one at the water main on {street}, the road is a river now"],
    sensor: ["WATER PRESSURE SENSOR {addr}: pressure drop 40%, possible main break"],
  },
  {
    category: "rescue", severity: 3, units: "fire_engine", weight: 2,
    texts: [
      "elevator is stuck between floors at {addr}, 4 people inside, one is having a panic attack",
      "a kid is stuck in a storm drain at {addr}, we can hear him but can't reach him",
      "worker fell into a trench at {addr} and it partly collapsed on his legs, he's talking to us",
    ],
    followups: ["the people in the elevator at {addr} say it's getting hot in there", "update on the boy in the drain at {addr}, water is rising slowly"],
  },
  {
    category: "rescue", severity: 4, units: "ambulance+fire", callerDanger: true, weight: 1, kinds: ["waterfront", "park"],
    texts: [
      "someone fell off the pier at {addr} into the water, they're not swimming well, current is strong",
      "a car went into the river at {addr}, i can see someone inside, the car is sinking",
    ],
    followups: ["the person in the water near {addr} went under, i cant see them now", "re the car in the river at {addr}, driver is on the roof of the car now"],
  },
  {
    category: "non_emergency", severity: 0, units: "none", weight: 6,
    texts: [
      "Hi, what time does the DMV on {street} open on Saturdays?",
      "my neighbours at {addr} are playing loud music again, it's 11pm, can you tell them to stop",
      "is it legal to park on the sidewalk on {street}? my neighbour does it every day",
      "there's a raccoon in my garage at {addr}, how do I get it out",
      "I'd like to report that the pothole on {street} is still there, I called two weeks ago",
      "how do I get a copy of a police report I filed last month?",
      "the fire hydrant at {addr} is leaking a little bit",
      "test test is this the emergency line",
    ],
    followups: [],
  },
];

const FIRST_NAMES = ["Ana", "Marcus", "Priya", "Tom", "Chen", "Fatima", "Luis", "Grace"];

function degradeSms(text: string, rng: Rng): string {
  let out = text.toLowerCase().replace(/[.,']/g, "");
  const subs: [RegExp, string][] = [
    [/\bplease\b/g, "pls"],
    [/\bpeople\b/g, "ppl"],
    [/\byou\b/g, "u"],
    [/\bare\b/g, "r"],
    [/\bsomeone\b/g, "some1"],
    [/\bbecause\b/g, "bc"],
    [/\bwith\b/g, "w"],
  ];
  for (const [re, rep] of subs) if (rng.chance(0.6)) out = out.replace(re, rep);
  if (rng.chance(0.5)) {
    const words = out.split(" ");
    const i = rng.int(0, words.length - 1);
    const w = words[i];
    if (w.length > 4) words[i] = w.slice(0, 2) + w.slice(3);
    out = words.join(" ");
  }
  return out;
}

function makeAddress(rng: Rng, district: District): { address: string; street: string; loc: Point } {
  const street = rng.pick(district.streets);
  const number = rng.int(1, 48) * 10 + rng.int(0, 9);
  const margin = 80;
  const loc = {
    x: district.x + margin + rng.next() * (district.w - 2 * margin),
    y: district.y + margin + rng.next() * (district.h - 2 * margin),
  };
  return { address: `${number} ${street}, ${district.name}`, street, loc };
}

function render(template: string, address: string, street: string): string {
  return template.replace(/\{addr\}/g, address).replace(/\{street\}/g, street);
}

function pickScenario(rng: Rng, district: District): Scenario {
  const eligible = SCENARIOS.filter((s) => !s.kinds || s.kinds.includes(district.kind));
  const total = eligible.reduce((a, s) => a + s.weight, 0);
  let r = rng.next() * total;
  for (const s of eligible) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return eligible[eligible.length - 1];
}

interface Emitter {
  city: City;
  rng: Rng;
  seq: number;
  prefix: string;
}

function emitPrimary(e: Emitter, t: number, forced?: { scenario: Scenario; district: District; place: ReturnType<typeof makeAddress> }): Report {
  const district = forced?.district ?? e.rng.pick(e.city.districts);
  const scenario = forced?.scenario ?? pickScenario(e.rng, district);
  const place = forced?.place ?? makeAddress(e.rng, district);
  let channel: Channel = e.rng.chance(0.62) ? "call" : "sms";
  let text: string;
  if (scenario.sensor && e.rng.chance(0.25)) {
    channel = "sensor";
    text = render(e.rng.pick(scenario.sensor), place.address, place.street);
  } else {
    text = render(e.rng.pick(scenario.texts), place.address, place.street);
    if (channel === "sms") text = degradeSms(text, e.rng);
    else if (e.rng.chance(0.3)) text = `${e.rng.pick(FIRST_NAMES)} here. ${text}`;
  }
  e.seq++;
  return {
    id: `${e.prefix}${e.seq}`,
    seq: e.seq,
    t,
    channel,
    text,
    address: place.address,
    loc: place.loc,
    districtId: district.id,
    truth: {
      category: scenario.category,
      severity: scenario.severity,
      units: scenario.units,
      multipleVictims: !!scenario.multi,
      hazmat: !!scenario.hazmat,
      callerInDanger: !!scenario.callerDanger,
      duplicateOf: null,
    },
  };
}

function emitFollowup(e: Emitter, parent: Report, scenario: Scenario, t: number): Report {
  const street = parent.address.split(",")[0].replace(/^\d+\s/, "");
  let text = render(e.rng.pick(scenario.followups), parent.address, street);
  const channel: Channel = e.rng.chance(0.55) ? "call" : "sms";
  if (channel === "sms") text = degradeSms(text, e.rng);
  e.seq++;
  const jitter = () => e.rng.range(-60, 60);
  return {
    id: `${e.prefix}${e.seq}`,
    seq: e.seq,
    t,
    channel,
    text,
    address: parent.address,
    loc: { x: parent.loc.x + jitter(), y: parent.loc.y + jitter() },
    districtId: parent.districtId,
    truth: { ...parent.truth, duplicateOf: parent.id },
  };
}

function scenarioOf(report: Report): Scenario {
  return SCENARIOS.find((s) => s.category === report.truth.category && s.units === report.truth.units && s.severity === report.truth.severity) ?? SCENARIOS[0];
}

/**
 * Deterministic report schedule: bursts of 1-5 reports/second separated by lulls,
 * with follow-up (duplicate) reports about earlier incidents woven in.
 */
export function generateSchedule(seed: number, durationSec: number): Report[] {
  const e: Emitter = { city: buildCity(), rng: makeRng(seed), seq: 0, prefix: "R" };
  const reports: Report[] = [];
  let t = 0.5;
  while (t < durationSec) {
    const burstLen = e.rng.range(2, 5);
    const rate = e.rng.int(1, 5);
    const end = Math.min(t + burstLen, durationSec);
    while (t < end) {
      const primary = emitPrimary(e, round(t));
      reports.push(primary);
      const scenario = scenarioOf(primary);
      if (scenario.followups.length && primary.truth.severity >= 2) {
        const n = primary.truth.severity >= 4 ? e.rng.int(1, 3) : e.rng.int(0, 1);
        for (let i = 0; i < n; i++) {
          const ft = t + e.rng.range(4, 45);
          if (ft < durationSec) reports.push(emitFollowup(e, primary, scenario, round(ft)));
        }
      }
      t += 1 / rate + e.rng.range(-0.05, 0.05);
    }
    t += e.rng.range(7, 16);
  }
  reports.sort((a, b) => a.t - b.t || a.seq - b.seq);
  return reports;
}

/** Mass-casualty surge: one big event reported by many callers, plus a few distinct injuries nearby. */
export function generateSurge(seed: number, startT: number, startSeq: number, count = 40, windowSec = 10): Report[] {
  const e: Emitter = { city: buildCity(), rng: makeRng(seed ^ 0x5a7e), seq: startSeq, prefix: "S" };
  const district = e.city.districts.find((d) => d.id === "MT") ?? e.city.districts[0];
  const place = makeAddress(e.rng, district);
  const crash = SCENARIOS.find((s) => s.category === "traffic" && s.units === "ambulance+fire")!;
  const reports: Report[] = [];
  const primary = emitPrimary(e, round(startT), { scenario: crash, district, place });
  primary.text = `Bus crash at ${place.address}, a bus flipped over, there are dozens of people hurt, some not moving`;
  primary.channel = "call";
  reports.push(primary);
  const crowd = [
    "bus overturned {addr} so many injured send everything",
    "im on the bus that crashed at {addr}, my leg is trapped, people screaming",
    "there's been a terrible accident on {street}, a bus, lots of blood",
    "BUS CRASH {addr} need ambulances NOW",
    "i just saw a bus roll over at {addr}, im pulling people out, some are unconscious",
    "accident {street} bus and a truck, kids on the bus, please hurry",
    "the bus at {addr} is leaking fuel, i smell diesel everywhere",
    "hi im calling about the bus that crashed on {street}, do you know about it already",
  ];
  const nearby: Scenario[] = [
    SCENARIOS.find((s) => s.category === "medical" && s.severity === 3)!,
    SCENARIOS.find((s) => s.category === "traffic" && s.severity === 2)!,
    SCENARIOS.find((s) => s.category === "police" && s.severity === 1)!,
  ];
  for (let i = 1; i < count; i++) {
    const t = round(startT + (i / count) * windowSec + e.rng.range(0, 0.2));
    if (e.rng.chance(0.15)) {
      const near = makeAddress(e.rng, district);
      reports.push(emitPrimary(e, t, { scenario: e.rng.pick(nearby), district, place: near }));
    } else {
      const tmpl = e.rng.pick(crowd);
      const f = emitFollowup(e, primary, { ...crash, followups: [tmpl] }, t);
      f.truth = { ...f.truth, multipleVictims: true };
      reports.push(f);
    }
  }
  reports.sort((a, b) => a.t - b.t || a.seq - b.seq);
  return reports;
}

function round(t: number): number {
  return Math.round(t * 100) / 100;
}
