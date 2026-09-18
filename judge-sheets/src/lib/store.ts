/**
 * Glue between the pure Workbook, the Jev batcher and React. One recalc tick
 * per animation frame: evaluate dirty cells, hand the pending judgments to the
 * runner, bump a version so subscribed components re-render.
 */
import { Workbook } from "../engine/workbook.ts";
import { cellKey, parseKey } from "../engine/refs.ts";
import { shiftFormula } from "../engine/parser.ts";
import { buildWorkbook } from "../data/workbook.ts";
import { JevRunner } from "./jevClient.ts";

export type Health = { ok: boolean; mode: "live" | "mock" | "nokey" | "offline"; model: string; concurrency: number };

export class Store {
  wb: Workbook;
  runner: JevRunner;
  version = 0;
  health: Health = { ok: false, mode: "offline", model: "jev-latest", concurrency: 0 };
  lastTick = { evaluated: 0, pending: 0, requests: 0, cacheHits: 0 };
  private listeners = new Set<() => void>();
  private scheduled = false;

  constructor() {
    this.wb = buildWorkbook();
    this.runner = new JevRunner(
      (key, value) => {
        this.wb.resolveJev(key, value);
        this.schedule();
      },
      () => this.emit(),
    );
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.tick();
    });
  }

  tick() {
    const r = this.wb.recalc();
    const requests = r.pending.length ? this.runner.submit(r.pending, r.cacheHits) : 0;
    this.lastTick = { evaluated: r.evaluated, pending: r.pending.length, requests, cacheHits: r.cacheHits };
    this.emit();
  }

  setCell(sheet: string, row: number, col: number, raw: string) {
    this.wb.setCell(sheet, row, col, raw);
    this.schedule();
  }

  /** Copy the formula/value of (row, col) down through `toRow`, shifting relative refs. */
  fillDown(sheet: string, row: number, col: number, toRow: number) {
    const src = this.wb.getRaw(sheet, row, col);
    let n = 0;
    for (let r = row + 1; r <= toRow; r++) {
      const raw = src.startsWith("=") ? shiftFormula(src, r - row, 0) : src;
      if (this.wb.getRaw(sheet, r, col) !== raw) {
        this.wb.setCell(sheet, r, col, raw);
        n++;
      }
    }
    this.schedule();
    return n;
  }

  /** Last row that holds any content in the sheet (0 if empty). */
  lastUsedRow(sheet: string): number {
    let max = 0;
    for (const k of this.wb.getSheet(sheet).cells.keys()) {
      const { row } = parseKey(k);
      if (row > max) max = row;
    }
    return max;
  }

  /** Last row with content in a specific column. */
  lastUsedRowIn(sheet: string, col: number): number {
    let max = -1;
    for (const k of this.wb.getSheet(sheet).cells.keys()) {
      const p = parseKey(k);
      if (p.col === col && p.row > max) max = p.row;
    }
    return max;
  }

  /** Forget every cached judgment used by a sheet so it re-asks Jev. */
  rejudgeSheet(sheet: string) {
    const keys = new Set<string>();
    for (const cell of this.wb.getSheet(sheet).cells.values()) for (const k of cell.jevKeys) keys.add(k);
    this.wb.invalidateJev(keys);
    this.schedule();
  }

  jevCellCount(sheet: string): number {
    let n = 0;
    for (const cell of this.wb.getSheet(sheet).cells.values()) if (cell.jevKeys.size) n++;
    return n;
  }

  setColWidth(sheet: string, col: number, width: number) {
    this.wb.getSheet(sheet).colWidths.set(col, Math.max(40, Math.round(width)));
    this.emit();
  }

  async fetchHealth() {
    try {
      const res = await fetch("/api/health");
      const j = (await res.json()) as Health;
      this.health = { ...j, ok: true };
    } catch {
      this.health = { ok: false, mode: "offline", model: "jev-latest", concurrency: 0 };
    }
    this.emit();
  }

  key(sheet: string, row: number, col: number) {
    return cellKey(sheet, row, col);
  }
}
