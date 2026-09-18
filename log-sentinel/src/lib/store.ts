import type {
  Calibration,
  Config,
  Disagreement,
  Incident,
  Judgment,
  LogEvent,
  Metrics,
  ServerMessage,
} from "../../shared/types.ts";

export const FIREHOSE_LIMIT = 400;

export interface Row {
  event: LogEvent;
  judgment?: Judgment;
}

export interface StormPhase {
  phase: string;
  at: number;
}

export interface State {
  connected: boolean;
  config: Config | null;
  calibration: Calibration | null;
  rows: Row[];
  incidents: Incident[];
  metrics: Metrics | null;
  disagreements: Disagreement[];
  storm: StormPhase[];
  error: string | null;
}

export const initialState: State = {
  connected: false,
  config: null,
  calibration: null,
  rows: [],
  incidents: [],
  metrics: null,
  disagreements: [],
  storm: [],
  error: null,
};

export type Action = { type: "connected"; value: boolean } | { type: "message"; message: ServerMessage };

export function reduce(state: State, action: Action): State {
  if (action.type === "connected") return { ...state, connected: action.value };
  const m = action.message;
  switch (m.type) {
    case "hello":
      return { ...state, config: m.config, calibration: m.calibration, error: null };
    case "event": {
      const rows = state.rows.length >= FIREHOSE_LIMIT ? state.rows.slice(state.rows.length - FIREHOSE_LIMIT + 1) : state.rows.slice();
      rows.push({ event: m.event });
      return { ...state, rows };
    }
    case "judgment": {
      const idx = findRow(state.rows, m.judgment.id);
      if (idx < 0) return state;
      const rows = state.rows.slice();
      rows[idx] = { ...rows[idx], judgment: m.judgment };
      return { ...state, rows };
    }
    case "metrics":
      return { ...state, metrics: m.metrics };
    case "incidents":
      return { ...state, incidents: m.incidents };
    case "disagreements":
      return { ...state, disagreements: m.items };
    case "config":
      return { ...state, config: m.config };
    case "calibration":
      return { ...state, calibration: m.calibration };
    case "storm":
      return { ...state, storm: m.phase.startsWith("Storm injected") ? [{ phase: m.phase, at: Date.now() }] : [...state.storm.slice(-5), { phase: m.phase, at: Date.now() }] };
    case "error":
      return { ...state, error: m.message };
  }
}

/** Rows are appended in id order, so binary search from the tail. */
function findRow(rows: Row[], id: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = rows[mid].event.id;
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
