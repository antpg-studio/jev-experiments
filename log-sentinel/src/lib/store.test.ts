import { describe, expect, it } from "vitest";
import type { LogEvent, ServerMessage } from "../../shared/types.ts";
import { FIREHOSE_LIMIT, initialState, reduce, type State } from "./store.ts";

const ev = (id: number): LogEvent => ({
  id,
  ts: id,
  service: "cron",
  level: "INFO",
  line: `l${id}`,
  lines: 1,
  truth: { actionable: false, severity: "noise", category: "noise", security: false },
  regexPaged: false,
  storm: false,
});
const apply = (s: State, ...msgs: ServerMessage[]) => msgs.reduce((acc, m) => reduce(acc, { type: "message", message: m }), s);

describe("store", () => {
  it("attaches judgments to rows by id and caps the firehose", () => {
    let s = initialState;
    for (let i = 0; i < FIREHOSE_LIMIT + 10; i++) s = apply(s, { type: "event", event: ev(i) });
    expect(s.rows).toHaveLength(FIREHOSE_LIMIT);
    expect(s.rows[0].event.id).toBe(10);
    s = apply(s, {
      type: "judgment",
      judgment: { id: 200, actionable: true, actionableP: 0.9, severity: "outage", severityScore: 4, category: "capacity", categoryConfidence: 0.9, security: false, securityP: 0, latencyMs: 1, ageMs: 2, batchSize: 1, mock: false },
    });
    expect(s.rows.find((r) => r.event.id === 200)?.judgment?.severity).toBe("outage");
    const before = s;
    s = apply(s, { type: "judgment", judgment: { ...s.rows[0].judgment!, id: 5 } as never });
    expect(s).toBe(before);
  });
  it("tracks connection, storm phases and errors", () => {
    let s = reduce(initialState, { type: "connected", value: true });
    expect(s.connected).toBe(true);
    s = apply(s, { type: "storm", phase: "a" }, { type: "error", message: "boom" });
    expect(s.storm.map((x) => x.phase)).toEqual(["a"]);
    expect(s.error).toBe("boom");
  });
});
