// Orchestrates edits -> requests -> markers. Never blocks on the network: requests
// overlap, each carries a sequence number and a snapshot of the judged lines, and
// answers for lines that changed in the meantime are discarded.

import { changedLines, enclosingFunction, extractFunctions, isJudgeable, type Language } from "./analysis.ts";
import { heuristicMarker, heuristicScan } from "./heuristics.ts";
import { buildRequest, clusterMarkers, markersFromAnswers, type BuiltRequest, type JevResponse, type Marker } from "./markers.ts";
import { Metrics } from "./metrics.ts";

export type Mode = "jev" | "heuristic";

export interface LinterOptions {
  endpoint?: string;
  debounceMs?: number;
  maxInFlight?: number;
  fetchImpl?: typeof fetch;
}

export interface ScanResult {
  wallMs: number;
  requests: number;
  questions: number;
  inputTokens: number;
  failed: number;
}

export interface LogEntry {
  seq: number;
  at: number;
  ms: number;
  lines: number[];
  status: "ok" | "stale" | "error" | "fallback";
  detail?: string;
}

export class Linter {
  readonly metrics = new Metrics();
  simulatedDelayMs = 0;
  private _mode: Mode = "jev";
  /** bumped when the document or mode changes; answers from an older generation never touch markers */
  private generation = 0;
  language: Language;
  private text: string;
  private baseText: string;
  private markers = new Map<number, Marker>();
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** line -> number of in-flight requests judging it */
  private inFlightLines = new Map<number, number>();
  private listeners = new Set<() => void>();
  private readonly endpoint: string;
  private readonly debounceMs: number;
  private readonly maxInFlight: number;
  private readonly fetchImpl: typeof fetch;
  log: LogEntry[] = [];

  constructor(text: string, language: Language, opts: LinterOptions = {}) {
    this.text = text;
    this.baseText = text;
    this.language = language;
    this.endpoint = opts.endpoint ?? "/api/jev";
    this.debounceMs = opts.debounceMs ?? 60;
    this.maxInFlight = opts.maxInFlight ?? 8;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get mode(): Mode {
    return this._mode;
  }

  set mode(next: Mode) {
    if (next === this._mode) return;
    this._mode = next;
    this.generation++;
  }

  getMarkers(): Marker[] {
    return clusterMarkers([...this.markers.values()]);
  }

  getText(): string {
    return this.text;
  }

  /** Replace the document wholesale (file switch). Clears markers; caller decides whether to scan. */
  load(text: string, language: Language): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.text = text;
    this.baseText = text;
    this.language = language;
    this.markers.clear();
    this.inFlightLines.clear();
    this.seq++;
    this.generation++; // invalidates every in-flight answer
    this.emit();
  }

  /** Called on every editor change with the new full text. */
  onChange(next: string): void {
    const prev = this.text;
    if (prev === next) return;
    this.shiftMarkers(prev, next);
    this.text = next;
    if (this.mode === "heuristic") {
      this.markers = new Map(heuristicScan(next, this.language).map((m) => [m.line, m]));
      this.emit();
      this.baseText = next;
      return;
    }
    this.emit();
    // throttle, not debounce: continuous typing still gets judged every debounceMs
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  /** Move markers past an edit and drop the ones inside the edited region. */
  private shiftMarkers(prev: string, next: string): void {
    const a = prev.split("\n");
    const b = next.split("\n");
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const delta = b.length - a.length;
    const firstChanged = head + 1;
    const lastChangedPrev = a.length - tail; // 1-based, inclusive, in prev
    const moved = new Map<number, Marker>();
    for (const [line, m] of this.markers) {
      if (line < firstChanged) moved.set(line, m);
      else if (line > lastChangedPrev) moved.set(line + delta, { ...m, line: line + delta });
      else if (delta === 0 && line <= b.length) moved.set(line, m); // same-line edit: keep until re-judged
    }
    this.markers = moved;
  }

  private flush(): void {
    this.timer = null;
    if (this.metrics.inFlight >= this.maxInFlight) {
      this.timer = setTimeout(() => this.flush(), 40);
      return;
    }
    const lines = changedLines(this.baseText, this.text);
    if (lines.length === 0) return;
    // a line already being judged would only produce a stale answer; wait for it to land
    if (lines.some((n) => this.inFlightLines.has(n))) return;
    this.baseText = this.text;
    const fns = extractFunctions(this.text, this.language);
    const groups = new Map<string, number[]>();
    for (const n of lines) {
      const f = enclosingFunction(fns, n);
      const key = f ? `${f.startLine}-${f.endLine}` : `top-${n}`;
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    for (const g of groups.values()) {
      const built = buildRequest(this.text, this.language, g, fns);
      if (built) void this.send(built);
    }
  }

  /** Judge every judgeable line of the file in one parallel burst. */
  async fullScan(): Promise<ScanResult> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.baseText = this.text;
    const started = performance.now();
    if (this.mode === "heuristic") {
      this.markers = new Map(heuristicScan(this.text, this.language).map((m) => [m.line, m]));
      this.emit();
      return { wallMs: performance.now() - started, requests: 0, questions: 0, inputTokens: 0, failed: 0 };
    }
    const fns = extractFunctions(this.text, this.language);
    const all = this.text.split("\n");
    const covered = new Set<number>();
    const batches: number[][] = [];
    const push = (lines: number[]) => {
      const judgeable = lines.filter((n) => isJudgeable(all[n - 1], this.language));
      for (let i = 0; i < judgeable.length; i += 10) batches.push(judgeable.slice(i, i + 10));
    };
    for (const f of fns) {
      const lines: number[] = [];
      for (let n = f.startLine; n <= f.endLine; n++) {
        if (covered.has(n)) continue;
        if (enclosingFunction(fns, n) !== f) continue;
        covered.add(n);
        lines.push(n);
      }
      push(lines);
    }
    const top: number[] = [];
    for (let n = 1; n <= all.length; n++) if (!covered.has(n) && !/^\s*(?:import|from|use|package|#!|source)\b/.test(all[n - 1])) top.push(n);
    for (let i = 0; i < top.length; i += 8) push(top.slice(i, i + 8));
    const builts = batches.map((b) => buildRequest(this.text, this.language, b, fns)).filter((b): b is BuiltRequest => b !== undefined);
    const results = await Promise.all(builts.map((b) => this.send(b)));
    const questions = builts.reduce((n, b) => n + Object.keys(b.request.questions).length, 0);
    return {
      wallMs: performance.now() - started,
      requests: builts.length,
      questions,
      inputTokens: results.reduce((n, r) => n + (r?.usage.input_tokens ?? 0), 0),
      failed: results.filter((r) => r === undefined).length,
    };
  }

  private async send(built: BuiltRequest): Promise<JevResponse | undefined> {
    const seq = ++this.seq;
    const generation = this.generation;
    const lines = built.refs.map((r) => r.line);
    const started = performance.now();
    this.metrics.inFlight++;
    for (const n of lines) this.inFlightLines.set(n, (this.inFlightLines.get(n) ?? 0) + 1);
    this.emit();
    let response: JevResponse | undefined;
    let detail: string | undefined;
    try {
      const body = JSON.stringify(built.request);
      const post = () => this.fetchImpl(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body });
      let res = await post();
      if (res.status === 429) {
        // one bounded retry on rate limiting; anything slower falls back to the heuristic
        const wait = Math.min(1500, Number(res.headers.get("retry-after") ?? 0) * 1000 || 400);
        await new Promise((r) => setTimeout(r, wait));
        res = await post();
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      response = (await res.json()) as JevResponse;
      if (this.simulatedDelayMs > 0) await new Promise((r) => setTimeout(r, this.simulatedDelayMs));
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
    const ms = performance.now() - started;
    this.metrics.inFlight--;
    for (const n of lines) {
      const left = (this.inFlightLines.get(n) ?? 1) - 1;
      if (left <= 0) this.inFlightLines.delete(n);
      else this.inFlightLines.set(n, left);
    }
    if (this.baseText !== this.text && !this.timer) this.timer = setTimeout(() => this.flush(), 0);
    const current = this.text.split("\n");
    const live = generation === this.generation ? built.refs.filter((r) => current[r.line - 1] === r.text) : [];
    if (response) {
      this.metrics.record({ at: Date.now(), ms, questions: Object.keys(built.request.questions).length, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      const fresh = markersFromAnswers(live, response.answers);
      for (const r of live) this.markers.delete(r.line);
      for (const m of fresh) this.markers.set(m.line, m);
      const why = generation !== this.generation ? "file or mode changed in flight" : live.length < built.refs.length ? `${built.refs.length - live.length} line(s) changed in flight` : undefined;
      this.pushLog({ seq, at: Date.now(), ms, lines, status: why ? "stale" : "ok", detail: why });
    } else {
      this.metrics.failures++;
      for (const r of live) {
        const m = heuristicMarker(r.line, r.text, this.language);
        if (m) this.markers.set(r.line, m);
      }
      this.pushLog({ seq, at: Date.now(), ms, lines, status: "fallback", detail });
    }
    this.emit();
    return response;
  }

  private pushLog(e: LogEntry): void {
    this.log = [e, ...this.log].slice(0, 40);
  }
}
