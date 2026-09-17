export interface Point {
  x: number;
  y: number;
}

export interface District {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Street grid spacing in metres; denser downtown, sparser in the outskirts. */
  blockSize: number;
  streets: string[];
  kind: "downtown" | "residential" | "industrial" | "waterfront" | "park";
}

export type UnitType = "ambulance" | "police" | "engine" | "ladder" | "utility";

export interface Depot {
  id: string;
  name: string;
  kind: "hospital" | "precinct" | "firehouse" | "yard";
  pos: Point;
}

export interface Unit {
  id: string;
  type: UnitType;
  depotId: string;
  home: Point;
  pos: Point;
  status: "idle" | "enroute" | "onscene" | "returning";
  incidentId: string | null;
  arrivedAt: number | null;
}

export interface City {
  width: number;
  height: number;
  districts: District[];
  depots: Depot[];
  river: Point[];
}

export const WORLD_W = 4000;
export const WORLD_H = 2800;

export const UNIT_SPEED: Record<UnitType, number> = {
  ambulance: 32,
  police: 34,
  engine: 26,
  ladder: 24,
  utility: 20,
};

const DISTRICT_DEFS: Omit<District, "x" | "y" | "w" | "h">[] = [
  { id: "NG", name: "Northgate", blockSize: 220, kind: "residential", streets: ["Aspen Rd", "Cedar Ln", "Elmwood Ave", "Foxglove Ct", "Heather Way", "Juniper St"] },
  { id: "MT", name: "Midtown", blockSize: 130, kind: "downtown", streets: ["Main St", "5th Ave", "7th Ave", "Union Sq", "Market St", "Grand Blvd", "Liberty Pl"] },
  { id: "IND", name: "Ironworks", blockSize: 300, kind: "industrial", streets: ["Foundry Rd", "Depot Ln", "Slag Ave", "Rail Yard Way", "Kiln St"] },
  { id: "RV", name: "Riverside", blockSize: 180, kind: "park", streets: ["Riverbank Dr", "Willow Path", "Boathouse Ln", "Meadow Ave", "Sycamore St"] },
  { id: "OT", name: "Old Town", blockSize: 110, kind: "downtown", streets: ["Birch St", "Cobble Ln", "Chapel St", "Harbor Rd", "Mill St", "Tannery Row"] },
  { id: "HB", name: "Harborfront", blockSize: 240, kind: "waterfront", streets: ["Pier 9", "Quay St", "Anchor Ave", "Ferry Rd", "Seawall Dr"] },
];

export function buildCity(): City {
  const cols = 3;
  const w = WORLD_W / cols;
  const h = WORLD_H / 2;
  const districts = DISTRICT_DEFS.map((d, i) => ({
    ...d,
    x: (i % cols) * w,
    y: Math.floor(i / cols) * h,
    w,
    h,
  }));
  const depots: Depot[] = [
    { id: "H1", name: "St. Anselm Hospital", kind: "hospital", pos: { x: 1900, y: 1200 } },
    { id: "H2", name: "Northgate Medical", kind: "hospital", pos: { x: 500, y: 500 } },
    { id: "H3", name: "Harbor Clinic", kind: "hospital", pos: { x: 3500, y: 2300 } },
    { id: "P1", name: "Precinct 1 (Midtown)", kind: "precinct", pos: { x: 2350, y: 700 } },
    { id: "P2", name: "Precinct 2 (Old Town)", kind: "precinct", pos: { x: 1500, y: 2200 } },
    { id: "P3", name: "Precinct 3 (Ironworks)", kind: "precinct", pos: { x: 3400, y: 450 } },
    { id: "F1", name: "Firehouse 1", kind: "firehouse", pos: { x: 1300, y: 900 } },
    { id: "F2", name: "Firehouse 2", kind: "firehouse", pos: { x: 2600, y: 2000 } },
    { id: "F3", name: "Firehouse 3", kind: "firehouse", pos: { x: 3000, y: 1100 } },
    { id: "F4", name: "Firehouse 4", kind: "firehouse", pos: { x: 600, y: 1800 } },
    { id: "U1", name: "Public Works Yard", kind: "yard", pos: { x: 3700, y: 1500 } },
  ];
  const river: Point[] = [
    { x: 0, y: 1500 },
    { x: 600, y: 1420 },
    { x: 1200, y: 1480 },
    { x: 1800, y: 1380 },
    { x: 2400, y: 1450 },
    { x: 3000, y: 1560 },
    { x: 3600, y: 1500 },
    { x: 4000, y: 1580 },
  ];
  return { width: WORLD_W, height: WORLD_H, districts, depots, river };
}

const FLEET: Record<Depot["kind"], Partial<Record<UnitType, number>>> = {
  hospital: { ambulance: 12 },
  precinct: { police: 12 },
  firehouse: { engine: 6, ladder: 2 },
  yard: { utility: 8 },
};

export function createFleet(city: City): Unit[] {
  const units: Unit[] = [];
  const counters: Record<UnitType, number> = { ambulance: 0, police: 0, engine: 0, ladder: 0, utility: 0 };
  const prefix: Record<UnitType, string> = { ambulance: "A", police: "P", engine: "E", ladder: "L", utility: "U" };
  for (const depot of city.depots) {
    const spec = FLEET[depot.kind];
    for (const type of Object.keys(spec) as UnitType[]) {
      for (let i = 0; i < (spec[type] ?? 0); i++) {
        counters[type]++;
        units.push({
          id: `${prefix[type]}${String(counters[type]).padStart(2, "0")}`,
          type,
          depotId: depot.id,
          home: { ...depot.pos },
          pos: { ...depot.pos },
          status: "idle",
          incidentId: null,
          arrivedAt: null,
        });
      }
    }
  }
  return units;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function districtAt(city: City, p: Point): District {
  return (
    city.districts.find((d) => p.x >= d.x && p.x < d.x + d.w && p.y >= d.y && p.y < d.y + d.h) ??
    city.districts[0]
  );
}
