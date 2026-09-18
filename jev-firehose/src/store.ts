import { createGenerator, type ChatMessage, type Generator } from "./generator.ts";
import { buildState, USD_PER_INPUT_TOKEN, type Judgment } from "./jev.ts";
import { createSocketTransport, JudgePool, type Completed, type PoolStats } from "./pool.ts";
import { costPerHourUsd, percentile, RateMeter, Ring } from "./stats.ts";

// Mutable console state kept outside React. The producer and the pool write to
// it at firehose speed; the UI samples it ~10x/s.

export type ModAction = "timeout" | "delete" | "ignore";

export interface Row {
  msg: ChatMessage;
  judgment?: Judgment;
  e2eMs?: number;
  apiMs?: number | null;
  action?: ModAction;
}

export interface Sample {
  ingestRate: number;
  judgeRate: number;
  tokensPerSec: number;
  costPerHour: number;
  lastApiMs: number;
  apiP50: number;
  apiP95: number;
  e2eP50: number;
  e2eP95: number;
  apiLatencies: number[];
  pool: PoolStats;
  totalIngested: number;
  avgTokens: number;
}

const KEEP = 4000;

export class Console {
  gen: Generator;
  rows = new Map<string, Row>();
  /** newest last; trimmed to KEEP */
  order: Row[] = [];
  apiLat = new Ring(2000);
  e2eLat = new Ring(2000);
  ingest = new RateMeter(2000);
  judged = new RateMeter(2000);
  tokenMeter = new RateMeter(2000);
  totalIngested = 0;
  actionLog: string[] = [];
  pool: JudgePool;
  heuristicOnly = false;
  private carry = 0;

  constructor(seed: number) {
    this.gen = createGenerator(seed);
    this.pool = new JudgePool(createSocketTransport(), (c) => this.onComplete(c));
  }

  /** Produce `rate` msgs/sec worth of messages for a tick of `dtMs`. */
  tick(rate: number, dtMs: number) {
    this.carry += (rate * dtMs) / 1000;
    const n = Math.floor(this.carry);
    this.carry -= n;
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const msg = this.gen.next();
      msg.t = now;
      const row: Row = { msg };
      this.rows.set(msg.id, row);
      this.order.push(row);
      this.totalIngested++;
      if (this.heuristicOnly) this.pool.judgeLocally(msg.id, msg.text);
      else this.pool.enqueue(msg.id, msg.text, buildState(msg));
    }
    this.ingest.mark(now, n);
    if (this.order.length > KEEP) {
      const drop = this.order.splice(0, this.order.length - KEEP);
      for (const r of drop) this.rows.delete(r.msg.id);
    }
    this.pool.pump();
  }

  private onComplete(c: Completed) {
    const row = this.rows.get(c.id);
    if (!row) return;
    row.judgment = c.judgment;
    row.e2eMs = c.e2eMs;
    row.apiMs = c.apiMs;
    const now = performance.now();
    this.judged.mark(now);
    this.e2eLat.push(c.e2eMs);
    if (c.apiMs != null) this.apiLat.push(c.apiMs);
    this.tokenMeter.mark(now, c.judgment.inputTokens);
  }

  act(row: Row, action: ModAction, reason: string) {
    row.action = action;
    this.actionLog.unshift(`${action.toUpperCase()} @${row.msg.user} — ${reason} — "${row.msg.text.slice(0, 60)}"`);
    if (this.actionLog.length > 50) this.actionLog.length = 50;
  }

  sample(): Sample {
    const now = performance.now();
    const api = this.apiLat.sorted();
    const e2e = this.e2eLat.sorted();
    const pool = this.pool.snapshot();
    const avgTokens = pool.judged ? pool.inputTokens / pool.judged : 0;
    const tokensPerSec = this.tokenMeter.rate(now);
    return {
      ingestRate: this.ingest.rate(now),
      judgeRate: this.judged.rate(now),
      tokensPerSec,
      costPerHour: costPerHourUsd(tokensPerSec, USD_PER_INPUT_TOKEN),
      lastApiMs: this.apiLat.last(),
      apiP50: percentile(api, 50),
      apiP95: percentile(api, 95),
      e2eP50: percentile(e2e, 50),
      e2eP95: percentile(e2e, 95),
      apiLatencies: api,
      pool,
      totalIngested: this.totalIngested,
      avgTokens,
    };
  }

  reset(seed: number) {
    this.gen = createGenerator(seed);
    this.rows.clear();
    this.order = [];
    this.apiLat = new Ring(2000);
    this.e2eLat = new Ring(2000);
    this.ingest = new RateMeter(2000);
    this.judged = new RateMeter(2000);
    this.tokenMeter = new RateMeter(2000);
    this.totalIngested = 0;
    this.actionLog = [];
    this.carry = 0;
    this.pool.reset();
  }
}
