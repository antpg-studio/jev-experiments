import type { Judgment } from "./jev.ts";
import { heuristicJudgment, parseJudgment, questions, type JevResult } from "./jev.ts";

// Client-side request pool. Messages are queued as they arrive and released to
// the transport one at a time up to `maxInFlight`; every answer is handled the
// moment it lands, so one slow Jev call never blocks the ones behind it.
// Anything that waits too long, overflows the backlog, or fails is judged by
// the deterministic heuristic instead, so the console never stalls.

export interface PoolConfig {
  /** messages allowed in flight at once */
  maxInFlight: number;
  /** oldest queued message allowed before it is shed to the heuristic */
  maxQueueAgeMs: number;
  /** hard cap on queued messages; excess oldest ones are shed */
  maxBacklog: number;
  /** extra latency added to every result, to simulate a typical multi-second LLM */
  simulatedDelayMs: number;
}

export const defaultPoolConfig: PoolConfig = {
  maxInFlight: 96,
  maxQueueAgeMs: 4000,
  maxBacklog: 3000,
  simulatedDelayMs: 0,
};

export interface TransportItem {
  id: string;
  state: unknown;
}
export interface TransportResult {
  id: string;
  ok: boolean;
  ms: number;
  status?: number;
  retries?: number;
  answers?: JevResult["answers"];
  usage?: JevResult["usage"];
  error?: string;
}
export type Transport = (item: TransportItem) => Promise<TransportResult>;

export interface Completed {
  id: string;
  judgment: Judgment;
  /** enqueue -> result, as seen by the UI */
  e2eMs: number;
  /** proxy-measured Jev round trip, null for heuristic results */
  apiMs: number | null;
}

export interface PoolStats {
  backlog: number;
  inFlight: number;
  judged: number;
  fallback: number;
  failed: number;
  stale: number;
  requests: number;
  /** upstream 429/529 retries performed by the proxy */
  rateLimited: number;
  inputTokens: number;
  outputTokens: number;
}

const zeroStats = (): PoolStats => ({ backlog: 0, inFlight: 0, judged: 0, fallback: 0, failed: 0, stale: 0, requests: 0, rateLimited: 0, inputTokens: 0, outputTokens: 0 });

interface Pending {
  id: string;
  text: string;
  state: unknown;
  enqueuedAt: number;
}

export class JudgePool {
  private queue: Pending[] = [];
  private inFlightIds = new Map<string, Pending>();
  private stats = zeroStats();
  config: PoolConfig;

  constructor(
    private transport: Transport,
    private onComplete: (c: Completed) => void,
    config: Partial<PoolConfig> = {},
    private now: () => number = () => performance.now(),
    private delay: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.config = { ...defaultPoolConfig, ...config };
  }

  enqueue(id: string, text: string, state: unknown) {
    this.queue.push({ id, text, state, enqueuedAt: this.now() });
    this.pump();
  }

  /** Judge immediately with the heuristic, bypassing the network (the "before" baseline). */
  judgeLocally(id: string, text: string) {
    this.stats.fallback++;
    this.onComplete({ id, judgment: heuristicJudgment(text), e2eMs: 0, apiMs: null });
  }

  snapshot(): PoolStats {
    return { ...this.stats, backlog: this.queue.length, inFlight: this.inFlightIds.size };
  }

  private shed(p: Pending) {
    this.stats.fallback++;
    this.onComplete({ id: p.id, judgment: heuristicJudgment(p.text), e2eMs: this.now() - p.enqueuedAt, apiMs: null });
  }

  /** Drop queued messages that are too old or beyond the backlog cap. Returns how many were shed. */
  shedStale(): number {
    const cutoff = this.now() - this.config.maxQueueAgeMs;
    let n = 0;
    while (this.queue.length > 0 && (this.queue[0].enqueuedAt < cutoff || this.queue.length > this.config.maxBacklog)) {
      this.shed(this.queue.shift()!);
      n++;
    }
    return n;
  }

  pump() {
    this.shedStale();
    while (this.queue.length > 0 && this.inFlightIds.size < this.config.maxInFlight) {
      const p = this.queue.shift()!;
      this.inFlightIds.set(p.id, p);
      void this.dispatch(p);
    }
  }

  private async dispatch(p: Pending) {
    this.stats.requests++;
    let r: TransportResult;
    try {
      r = await this.transport({ id: p.id, state: p.state });
    } catch (e) {
      r = { id: p.id, ok: false, ms: 0, error: e instanceof Error ? e.message : "transport" };
    }
    if (this.config.simulatedDelayMs > 0) await this.delay(this.config.simulatedDelayMs);
    if (!this.inFlightIds.delete(p.id)) {
      this.stats.stale++;
      return;
    }
    this.stats.rateLimited += r.retries ?? 0;
    if (r.ok && r.answers) {
      const judgment = parseJudgment({ answers: r.answers, usage: r.usage });
      this.stats.judged++;
      this.stats.inputTokens += judgment.inputTokens;
      this.stats.outputTokens += judgment.outputTokens;
      this.onComplete({ id: p.id, judgment, e2eMs: this.now() - p.enqueuedAt, apiMs: r.ms });
    } else {
      this.stats.failed++;
      this.shed(p);
    }
    this.pump();
  }

  /** Queue-only reset (in-flight requests will report as stale). */
  reset() {
    this.queue = [];
    this.inFlightIds.clear();
    this.stats = zeroStats();
  }
}

/**
 * One WebSocket to the proxy; every item is sent as its own frame and the
 * proxy pushes each answer back as soon as Jev returns it. If the socket
 * drops, everything outstanding rejects and the pool falls back.
 */
export function createSocketTransport(url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/jev/ws`): Transport {
  const pending = new Map<string, (r: TransportResult) => void>();
  let socket: WebSocket | null = null;
  let ready: Promise<WebSocket> | null = null;

  const connect = () => {
    if (ready) return ready;
    ready = new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        ws.send(JSON.stringify({ questions }));
        socket = ws;
        resolve(ws);
      };
      ws.onmessage = (ev) => {
        const r = JSON.parse(String(ev.data)) as TransportResult;
        const cb = pending.get(r.id);
        if (cb) {
          pending.delete(r.id);
          cb(r);
        }
      };
      const fail = (why: string) => {
        socket = null;
        ready = null;
        reject(new Error(why));
        for (const [id, cb] of pending) cb({ id, ok: false, ms: 0, error: why });
        pending.clear();
      };
      ws.onerror = () => fail("socket error");
      ws.onclose = () => fail("socket closed");
    });
    return ready;
  };

  return async (item) => {
    const ws = socket ?? (await connect());
    return new Promise<TransportResult>((resolve) => {
      pending.set(item.id, resolve);
      ws.send(JSON.stringify(item));
    });
  };
}
