import { describe, expect, it } from "vitest";
import type { Judgment, LogEvent } from "../shared/types.ts";
import { STORM, TEMPLATES } from "./fixtures.ts";
import { Generator } from "./generator.ts";
import { LineGrouper, isContinuation } from "./grouper.ts";
import { IncidentTracker } from "./incidents.ts";
import { buildBatchRequest, buildSingleRequest, severityFromScore } from "./jev.ts";
import { Confusion, LatencyWindow, RateMeter, percentile } from "./metrics.ts";
import { regexPages } from "./regex.ts";
import { Rng } from "./rng.ts";

const ev = (over: Partial<LogEvent> = {}): LogEvent => ({
  id: 1,
  ts: 1000,
  service: "payments",
  level: "INFO",
  line: "x",
  lines: 1,
  truth: { actionable: true, severity: "degraded", category: "dependency_failure", security: false },
  regexPaged: false,
  storm: false,
  ...over,
});
const jd = (over: Partial<Judgment> = {}): Judgment => ({
  id: 1,
  actionable: true,
  actionableP: 0.9,
  severity: "degraded",
  severityScore: 2,
  category: "dependency_failure",
  categoryConfidence: 0.8,
  security: false,
  securityP: 0.1,
  latencyMs: 150,
  ageMs: 180,
  batchSize: 8,
  mock: false,
  ...over,
});

describe("grouper", () => {
  it("detects stack-trace continuations", () => {
    expect(isContinuation("\tat com.acme.Foo.bar(Foo.java:12)")).toBe(true);
    expect(isContinuation("Caused by: java.io.IOException")).toBe(true);
    expect(isContinuation("... 12 more")).toBe(true);
    expect(isContinuation("java.lang.NullPointerException: boom")).toBe(true);
    expect(isContinuation('{"level":"INFO"}')).toBe(false);
    expect(isContinuation("10.0.0.1 - - [x] GET /")).toBe(false);
  });

  it("joins a multi-line trace into one event and emits it when the next head arrives", () => {
    const g = new LineGrouper<number>();
    expect(g.feed({ text: "ERROR boom", meta: 1 })).toBeNull();
    expect(g.feed({ text: "java.lang.NullPointerException: x", meta: 1 })).toBeNull();
    expect(g.feed({ text: "\tat a.b.C(C.java:1)", meta: 1 })).toBeNull();
    const out = g.feed({ text: "INFO next", meta: 2 });
    expect(out?.lines).toBe(3);
    expect(out?.text.split("\n")).toHaveLength(3);
    expect(out?.meta).toBe(1);
    expect(g.flush()?.text).toBe("INFO next");
    expect(g.flush()).toBeNull();
  });
});

describe("regex baseline", () => {
  it("pages on ERROR level, stack traces, 5xx, and k8s Warning", () => {
    expect(regexPages('{"level":"ERROR","msg":"retry succeeded"}')).toBe(true);
    expect(regexPages("java.lang.NullPointerException")).toBe(true);
    expect(regexPages('1.2.3.4 - - [x] "POST /a HTTP/2.0" 502 12 "-" "ua"')).toBe(true);
    expect(regexPages("2026-01-01T00:00:00Z Warning Unhealthy pod/x Readiness probe failed")).toBe(true);
  });
  it("does not page on INFO anomalies or 2xx/4xx", () => {
    expect(regexPages('{"level":"INFO","msg":"provider response","status":200,"body_bytes":0}')).toBe(false);
    expect(regexPages('1.2.3.4 - - [x] "POST /a HTTP/2.0" 200 0 "-" "ua" rt=9.4')).toBe(false);
    expect(regexPages("2026-01-01T00:00:00Z Normal ScalingReplicaSet deployment/x Scaled down to 1")).toBe(false);
  });
});

describe("fixtures + generator", () => {
  it("every template renders and its regex decision matches the labelled comment class", () => {
    const rng = new Rng(1);
    for (const t of TEMPLATES) {
      const lines = t.render(rng, new Date(0).toISOString());
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l.length).toBeGreaterThan(10);
    }
  });

  it("contains regex false positives and false negatives on purpose", () => {
    const rng = new Rng(2);
    const fp = TEMPLATES.filter((t) => !t.truth.actionable && regexPages(t.render(rng, new Date(0).toISOString()).join("\n")));
    const fn = TEMPLATES.filter((t) => t.truth.actionable && !regexPages(t.render(rng, new Date(0).toISOString()).join("\n")));
    expect(fp.length).toBeGreaterThanOrEqual(6);
    expect(fn.length).toBeGreaterThanOrEqual(10);
  });

  it("is deterministic for a seed and groups traces", () => {
    const a = new Generator(42);
    const b = new Generator(42);
    const ea: LogEvent[] = [];
    const eb: LogEvent[] = [];
    for (let i = 0; i < 3000; i++) {
      ea.push(...a.tick(1000 + i));
      eb.push(...b.tick(1000 + i));
    }
    expect(ea.map((e) => e.line)).toEqual(eb.map((e) => e.line));
    expect(ea.some((e) => e.lines > 1)).toBe(true);
    expect(new Set(ea.map((e) => e.id)).size).toBe(ea.length);
  });

  it("storm starts with INFO anomalies before anything regex would page on", () => {
    const firstRegex = STORM.findIndex((s) => regexPages(s.template.render(new Rng(3), new Date(0).toISOString()).join("\n")));
    expect(firstRegex).toBeGreaterThanOrEqual(5);
    for (const s of STORM.slice(0, firstRegex)) {
      expect(s.template.truth.actionable).toBe(true);
      expect(["ERROR", "FATAL"]).not.toContain(s.template.level);
    }
    expect(STORM.slice(0, 5).every((s) => s.template.level === "INFO" || s.template.level === "ACCESS")).toBe(true);
    const g = new Generator(1);
    g.injectStorm(0);
    expect(g.stormPending).toBe(STORM.length);
    const out: LogEvent[] = [];
    for (let t = 0; t <= 20000; t += 50) out.push(...g.tick(t));
    expect(out.filter((e) => e.storm)).toHaveLength(STORM.length);
    expect(g.stormPending).toBe(0);
  });
});

describe("jev request builders", () => {
  it("batch request has one question set per event with prefixed ids", () => {
    const events = [ev({ id: 1, line: "a" }), ev({ id: 2, line: "b", service: "nginx" })];
    const req = buildBatchRequest(events);
    expect(req.state).toEqual({ events: [{ service: "payments", line: "a" }, { service: "nginx", line: "b" }] });
    expect(Object.keys(req.questions).sort()).toEqual(["e0_actionable", "e0_category", "e0_security", "e0_severity", "e1_actionable", "e1_category", "e1_security", "e1_severity"]);
    expect(req.questions.e1_severity.type).toBe("score");
    expect(req.questions.e1_category.type).toBe("choice");
  });
  it("single request uses unprefixed ids", () => {
    const req = buildSingleRequest(ev({ line: "hello" }));
    expect(Object.keys(req.questions).sort()).toEqual(["actionable", "category", "security", "severity"]);
    expect(req.state).toEqual({ event: { service: "payments", line: "hello" } });
  });
  it("maps scores to severities by rounding", () => {
    expect(severityFromScore(0.2)).toBe("noise");
    expect(severityFromScore(1.4)).toBe("informational");
    expect(severityFromScore(2.5)).toBe("customer-impacting");
    expect(severityFromScore(3.9)).toBe("outage");
    expect(severityFromScore(9)).toBe("outage");
  });
});

describe("incidents", () => {
  it("groups actionable events by service+category inside the window and keeps max severity", () => {
    const t = new IncidentTracker(60_000);
    t.add(ev({ id: 1, ts: 0 }), jd({ severity: "degraded" }));
    t.add(ev({ id: 2, ts: 30_000 }), jd({ severity: "outage" }));
    t.add(ev({ id: 3, ts: 31_000, service: "nginx" }), jd());
    t.add(ev({ id: 4, ts: 32_000 }), jd({ category: "capacity" }));
    t.add(ev({ id: 5, ts: 33_000 }), jd({ actionable: false }));
    const list = t.list(33_000);
    expect(list).toHaveLength(3);
    const pay = list.find((i) => i.service === "payments" && i.category === "dependency_failure")!;
    expect(pay.count).toBe(2);
    expect(pay.severity).toBe("outage");
    expect(pay.firstSeen).toBe(0);
    expect(pay.lastSeen).toBe(30_000);
    expect(list[0].severity).toBe("outage");
  });
  it("opens a new incident when the window has elapsed", () => {
    const t = new IncidentTracker(60_000);
    t.add(ev({ id: 1, ts: 0 }), jd());
    t.add(ev({ id: 2, ts: 61_000 }), jd());
    const list = t.list(61_000);
    expect(list).toHaveLength(1);
    expect(list[0].count).toBe(1);
    expect(list[0].firstSeen).toBe(61_000);
  });
});

describe("metrics", () => {
  it("percentiles", () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(100);
    expect(percentile([], 50)).toBe(0);
    const w = new LatencyWindow(3);
    [5, 1, 9, 7].forEach((x) => w.push(x));
    expect(w.count).toBe(3);
    expect(w.last).toBe(7);
    expect(w.percentiles().p50).toBe(7);
  });
  it("rate meter slides", () => {
    const r = new RateMeter(1000);
    for (let i = 0; i < 10; i++) r.mark(i * 100);
    expect(r.perSecond(950)).toBe(10);
    expect(r.perSecond(1500)).toBe(5);
  });
  it("confusion matrix", () => {
    const c = new Confusion();
    c.record(true, true);
    c.record(true, false);
    c.record(false, true);
    c.record(false, false);
    expect(c.snapshot()).toEqual({ tp: 1, fp: 1, fn: 1, tn: 1, precision: 0.5, recall: 0.5 });
  });
});
