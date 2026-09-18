import type { LogEvent, Truth, Service, Level } from "../shared/types.ts";
import { STORM, TEMPLATES, type Template } from "./fixtures.ts";
import { LineGrouper } from "./grouper.ts";
import { regexPages } from "./regex.ts";
import { Rng } from "./rng.ts";

interface Meta {
  service: Service;
  level: Level;
  truth: Truth;
  storm: boolean;
  template: string;
}

const TOTAL_WEIGHT = TEMPLATES.reduce((a, t) => a + t.weight, 0);

export function pickTemplate(rng: Rng): Template {
  let x = rng.next() * TOTAL_WEIGHT;
  for (const t of TEMPLATES) {
    x -= t.weight;
    if (x < 0) return t;
  }
  return TEMPLATES[TEMPLATES.length - 1];
}

/**
 * Produces the synthetic firehose. `tick()` emits the raw lines for one template through the
 * multi-line grouper and returns whatever complete events fell out. Storm steps are queued with
 * `injectStorm()` and emitted when their scheduled time arrives.
 */
export class Generator {
  private rng: Rng;
  private grouper = new LineGrouper<Meta>();
  private nextId = 1;
  private stormQueue: { at: number; template: Template }[] = [];

  constructor(seed = 20260917) {
    this.rng = new Rng(seed);
  }

  injectStorm(now = Date.now()): void {
    for (const s of STORM) this.stormQueue.push({ at: now + s.atMs, template: s.template });
    this.stormQueue.sort((a, b) => a.at - b.at);
  }

  get stormPending(): number {
    return this.stormQueue.length;
  }

  /** Emit one background template (or a due storm step) and return completed events. */
  tick(now = Date.now()): LogEvent[] {
    let template: Template;
    let storm = false;
    if (this.stormQueue.length && this.stormQueue[0].at <= now) {
      template = this.stormQueue.shift()!.template;
      storm = true;
    } else {
      template = pickTemplate(this.rng);
    }
    return this.emit(template, now, storm);
  }

  emit(template: Template, now: number, storm: boolean): LogEvent[] {
    const iso = new Date(now).toISOString();
    const lines = template.render(this.rng, iso);
    const meta: Meta = { service: template.service, level: template.level, truth: template.truth, storm, template: template.name };
    const out: LogEvent[] = [];
    for (const text of lines) {
      const done = this.grouper.feed({ text, meta });
      if (done) out.push(this.toEvent(done.text, done.lines, done.meta, now));
    }
    return out;
  }

  flush(now = Date.now()): LogEvent[] {
    const done = this.grouper.flush();
    return done ? [this.toEvent(done.text, done.lines, done.meta, now)] : [];
  }

  private toEvent(line: string, lines: number, meta: Meta, now: number): LogEvent {
    return {
      id: this.nextId++,
      ts: now,
      service: meta.service,
      level: meta.level,
      line,
      lines,
      truth: meta.truth,
      regexPaged: regexPages(line),
      storm: meta.storm,
    };
  }
}
