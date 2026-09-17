// Precision / recall of markers against planted issues (line-level).

import type { Kind, Marker, Severity } from "./markers.ts";
import { SEVERITY_RANK } from "./markers.ts";

export interface Planted {
  line: number;
  kind: Kind;
  note: string;
}

export interface Evaluation {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** planted lines that were flagged with the planted kind among the top-2 kinds */
  kindMatches: number;
  flaggedLines: number[];
  missedLines: number[];
  falseLines: number[];
}

/** A marker counts as a flag when its severity is at or above `minSeverity`. */
export function evaluate(markers: Marker[], planted: Planted[], minSeverity: Severity = "warning"): Evaluation {
  const flagged = new Map<number, Marker>();
  for (const m of markers) if (SEVERITY_RANK[m.severity] >= SEVERITY_RANK[minSeverity]) flagged.set(m.line, m);
  const plantedLines = new Map(planted.map((p) => [p.line, p]));
  let tp = 0;
  let kindMatches = 0;
  const falseLines: number[] = [];
  for (const [line, m] of flagged) {
    const p = plantedLines.get(line);
    if (p) {
      tp++;
      if (m.kinds.slice(0, 2).some((k) => k.kind === p.kind)) kindMatches++;
    } else falseLines.push(line);
  }
  const missedLines = [...plantedLines.keys()].filter((l) => !flagged.has(l));
  const fp = falseLines.length;
  const fn = missedLines.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, precision, recall, f1, kindMatches, flaggedLines: [...flagged.keys()].sort((a, b) => a - b), missedLines: missedLines.sort((a, b) => a - b), falseLines: falseLines.sort((a, b) => a - b) };
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}
