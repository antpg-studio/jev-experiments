import type { BatchMode, Calibration, CalibrationResult, Config, Disagreement, Judgment, LogEvent, Metrics, ServerMessage } from "../shared/types.ts";
import { Generator } from "./generator.ts";
import { IncidentTracker } from "./incidents.ts";
import { ACTIONABLE_THRESHOLD, SECURITY_THRESHOLD, type JevJudge } from "./jev.ts";
import { Confusion, LatencyWindow, RateMeter, percentile } from "./metrics.ts";

type Listener = (msg: ServerMessage) => void;

/** Short human summary of a line for the storm timeline: JSON msg field when present, else the head. */
function summary(line: string): string {
  const head = line.split("\n")[0];
  const m = /"msg":"([^"]+)"/.exec(head);
  return (m ? m[1] : head).slice(0, 70);
}

const BATCH_LINGER_MS = 40;
const MIN_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 8000;
const SCHED_MS = 20;

export class Pipeline {
  config: Config;
  calibration: Calibration = { results: [], chosen: "batch", done: false };

  private listeners = new Set<Listener>();
  private gen = new Generator();
  private incidents = new IncidentTracker();
  private latency = new LatencyWindow(400);
  private inRate = new RateMeter();
  private outRate = new RateMeter();
  private regexAcc = new Confusion();
  private jevAcc = new Confusion();
  private disagreements: Disagreement[] = [];
  private disagreementsDirty = false;
  private incidentsDirty = false;

  private pending: LogEvent[] = [];
  private lingerTimer: NodeJS.Timeout | null = null;
  private queue: LogEvent[][] = [];
  private retried = new WeakSet<LogEvent[]>();
  private backoffMs = 0;
  private throttledUntil = 0;
  private backoffTimer: NodeJS.Timeout | null = null;
  private inFlight = 0;
  private credit = 0;
  private startedAt = Date.now();
  private lastTick = Date.now();

  private totalEvents = 0;
  private totalJudged = 0;
  private totalRequests = 0;
  private errors = 0;
  private lastErrorAt = 0;
  private regexPaged = 0;
  private jevActionable = 0;
  private truthActionable = 0;

  private storm: { startedAt: number; firstJev: number | null; firstRegex: number | null } | null = null;

  constructor(private jev: JevJudge) {
    this.config = { rate: 40, concurrency: 8, batchSize: 8, mode: "batch", paused: false, mock: jev.mock };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn({ type: "hello", config: this.config, calibration: this.calibration });
    fn({ type: "incidents", incidents: this.incidents.list() });
    fn({ type: "disagreements", items: this.disagreements });
    fn({ type: "metrics", metrics: this.metrics() });
    return () => this.listeners.delete(fn);
  }

  private emit(msg: ServerMessage): void {
    for (const l of this.listeners) l(msg);
  }

  async start(): Promise<void> {
    await this.calibrate();
    this.startedAt = Date.now();
    this.lastTick = this.startedAt;
    setInterval(() => this.schedule(), SCHED_MS);
    setInterval(() => this.publish(), 250);
  }

  setConfig(patch: Partial<Config>): void {
    if (patch.rate !== undefined) this.config.rate = Math.max(1, Math.min(400, Math.round(patch.rate)));
    if (patch.concurrency !== undefined) this.config.concurrency = Math.max(1, Math.min(64, Math.round(patch.concurrency)));
    if (patch.batchSize !== undefined) this.config.batchSize = Math.max(2, Math.min(16, Math.round(patch.batchSize)));
    if (patch.mode !== undefined) this.config.mode = patch.mode;
    if (patch.paused !== undefined) this.config.paused = patch.paused;
    this.emit({ type: "config", config: this.config });
    this.pump();
  }

  triggerStorm(): void {
    const now = Date.now();
    this.gen.injectStorm(now);
    this.storm = { startedAt: now, firstJev: null, firstRegex: null };
    this.emit({ type: "storm", phase: "Storm injected: payments provider degradation begins with INFO-level anomalies" });
  }

  // ------------------------------------------------------------------ stream scheduling
  private schedule(): void {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.config.paused) {
      for (const e of this.gen.flush(now)) this.ingest(e);
      return;
    }
    this.credit += (this.config.rate * dt) / 1000;
    // Storm steps are time-based, so make sure a due step is emitted even at low rates.
    if (this.gen.stormPending && this.credit < 1) this.credit = 1;
    let n = Math.floor(this.credit);
    this.credit -= n;
    while (n-- > 0) for (const e of this.gen.tick(now)) this.ingest(e);
    // Nothing else arrived for a while: close any half-built multi-line event.
    if (this.config.rate < 20) for (const e of this.gen.flush(now)) this.ingest(e);
  }

  private ingest(e: LogEvent): void {
    this.totalEvents++;
    this.inRate.mark(e.ts);
    if (e.regexPaged) this.regexPaged++;
    if (e.truth.actionable) this.truthActionable++;
    this.regexAcc.record(e.regexPaged, e.truth.actionable);
    if (e.regexPaged !== e.truth.actionable) this.noteDisagreement(e, e.regexPaged ? "regex_fp" : "regex_fn", null);
    if (e.storm && e.regexPaged && this.storm && this.storm.firstRegex === null) {
      this.storm.firstRegex = e.ts;
      this.emit({ type: "storm", phase: `Regex rules first paged at +${((e.ts - this.storm.startedAt) / 1000).toFixed(1)}s: ${summary(e.line)}` });
      this.stormVerdict();
    }
    this.emit({ type: "event", event: e });

    if (this.config.mode === "single") {
      this.queue.push([e]);
      this.pump();
      return;
    }
    this.pending.push(e);
    if (this.pending.length >= this.config.batchSize) this.flushPending();
    else if (!this.lingerTimer) this.lingerTimer = setTimeout(() => this.flushPending(), BATCH_LINGER_MS);
  }

  private flushPending(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    while (this.pending.length) this.queue.push(this.pending.splice(0, this.config.batchSize));
    this.pump();
  }

  private pump(): void {
    const now = Date.now();
    if (now < this.throttledUntil) {
      if (!this.backoffTimer) this.backoffTimer = setTimeout(() => {
        this.backoffTimer = null;
        this.pump();
      }, this.throttledUntil - now);
      return;
    }
    while (this.inFlight < this.config.concurrency && this.queue.length) {
      const batch = this.queue.shift()!;
      this.inFlight++;
      void this.run(batch);
    }
  }

  private async run(batch: LogEvent[]): Promise<void> {
    try {
      const res = await this.jev.judge(batch);
      this.totalRequests++;
      this.backoffMs = 0;
      this.latency.push(res.latencyMs);
      const now = Date.now();
      for (let i = 0; i < batch.length; i++) {
        const e = batch[i];
        const v = res.verdicts[i];
        const j: Judgment = {
          id: e.id,
          actionable: v.actionableP >= ACTIONABLE_THRESHOLD,
          actionableP: v.actionableP,
          severity: v.severity,
          severityScore: v.severityScore,
          category: v.category,
          categoryConfidence: v.categoryConfidence,
          security: v.securityP >= SECURITY_THRESHOLD,
          securityP: v.securityP,
          latencyMs: res.latencyMs,
          ageMs: now - e.ts,
          batchSize: batch.length,
          mock: this.jev.mock,
        };
        this.accept(e, j, now);
      }
    } catch (err) {
      this.errors++;
      if (!this.retried.has(batch)) {
        this.retried.add(batch);
        this.queue.unshift(batch);
      }
      const now = Date.now();
      // Exponential backoff shared by every worker: 250 ms -> 8 s, reset on the next success.
      this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, MAX_BACKOFF_MS) : MIN_BACKOFF_MS;
      this.throttledUntil = Math.max(this.throttledUntil, now + this.backoffMs);
      if (now - this.lastErrorAt > 2000) {
        this.lastErrorAt = now;
        const msg = err instanceof Error ? err.message : String(err);
        this.emit({ type: "error", message: `${msg} — backing off ${this.backoffMs} ms` });
      }
    } finally {
      this.inFlight--;
      this.pump();
    }
  }

  private accept(e: LogEvent, j: Judgment, now: number): void {
    this.totalJudged++;
    this.outRate.mark(now);
    if (j.actionable) this.jevActionable++;
    this.jevAcc.record(j.actionable, e.truth.actionable);
    if (j.actionable !== e.truth.actionable) this.noteDisagreement(e, j.actionable ? "jev_fp" : "jev_fn", j);
    if (this.incidents.add(e, j)) this.incidentsDirty = true;
    if (e.storm && j.actionable && this.storm && this.storm.firstJev === null) {
      this.storm.firstJev = now;
      this.emit({ type: "storm", phase: `Jev flagged the storm at +${((now - this.storm.startedAt) / 1000).toFixed(1)}s: ${summary(e.line)}` });
      this.stormVerdict();
    }
    this.emit({ type: "judgment", judgment: j });
  }

  private stormVerdict(): void {
    const s = this.storm;
    if (!s || s.firstJev === null || s.firstRegex === null) return;
    const lead = (s.firstRegex - s.firstJev) / 1000;
    this.emit({ type: "storm", phase: `Verdict: Jev was ${lead.toFixed(1)}s ahead of the regex/severity rules on this incident` });
  }

  private noteDisagreement(e: LogEvent, kind: Disagreement["kind"], j: Judgment | null): void {
    this.disagreements.unshift({
      id: e.id,
      service: e.service,
      line: e.line.split("\n")[0],
      kind,
      regexPaged: e.regexPaged,
      jevActionable: j?.actionable ?? false,
      truthActionable: e.truth.actionable,
    });
    if (this.disagreements.length > 60) this.disagreements.pop();
    this.disagreementsDirty = true;
  }

  private metrics(): Metrics {
    const now = Date.now();
    const p = this.latency.percentiles();
    return {
      eventsPerSec: this.inRate.perSecond(now),
      judgmentsPerSec: this.outRate.perSecond(now),
      inFlight: this.inFlight,
      backlog: this.pending.length + this.queue.reduce((a, b) => a + b.length, 0),
      p50: p.p50,
      p95: p.p95,
      p99: p.p99,
      lastLatency: this.latency.last,
      totalEvents: this.totalEvents,
      totalJudged: this.totalJudged,
      totalRequests: this.totalRequests,
      errors: this.errors,
      elapsedMs: now - this.startedAt,
      regexPaged: this.regexPaged,
      jevActionable: this.jevActionable,
      truthActionable: this.truthActionable,
      regex: this.regexAcc.snapshot(),
      jev: this.jevAcc.snapshot(),
    };
  }

  private publish(): void {
    this.emit({ type: "metrics", metrics: this.metrics() });
    if (this.incidentsDirty) {
      this.incidentsDirty = false;
      this.emit({ type: "incidents", incidents: this.incidents.list() });
    }
    if (this.disagreementsDirty) {
      this.disagreementsDirty = false;
      this.emit({ type: "disagreements", items: this.disagreements });
    }
  }

  // ------------------------------------------------------------------ batching calibration
  /**
   * Measures both request shapes on the same 16 fixture events with the same concurrency (8) and keeps
   * the one that judges more events per second per in-flight slot. The result is shown in the UI.
   */
  private async calibrate(): Promise<void> {
    const probe = new Generator(7);
    const sample: LogEvent[] = [];
    while (sample.length < 16) for (const e of probe.tick()) if (sample.length < 16) sample.push(e);

    const results: CalibrationResult[] = [];
    for (const mode of ["single", "batch"] as BatchMode[]) {
      const groups = mode === "single" ? sample.map((e) => [e]) : [sample.slice(0, 8), sample.slice(8, 16)];
      const lat: number[] = [];
      const t0 = performance.now();
      try {
        for (let i = 0; i < groups.length; i += 8) {
          const res = await Promise.all(groups.slice(i, i + 8).map((g) => this.jev.judge(g)));
          for (const r of res) lat.push(r.latencyMs);
        }
      } catch (err) {
        this.emit({ type: "error", message: `Calibration failed: ${err instanceof Error ? err.message : String(err)}` });
        break;
      }
      const elapsedMs = performance.now() - t0;
      const p50 = percentile([...lat].sort((a, b) => a - b), 50);
      results.push({
        mode,
        batchSize: mode === "single" ? 1 : 8,
        requests: groups.length,
        events: sample.length,
        elapsedMs,
        p50,
        eventsPerSecPerSlot: p50 ? ((mode === "single" ? 1 : 8) * 1000) / p50 : 0,
      });
    }
    const best = [...results].sort((a, b) => b.eventsPerSecPerSlot - a.eventsPerSecPerSlot)[0];
    this.calibration = { results, chosen: best?.mode ?? "batch", done: true };
    this.config.mode = this.calibration.chosen;
    this.emit({ type: "calibration", calibration: this.calibration });
    this.emit({ type: "config", config: this.config });
  }
}
