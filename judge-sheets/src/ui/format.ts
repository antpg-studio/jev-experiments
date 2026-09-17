import { formatNumber, isError, isJev, type Value } from "../engine/values.ts";

export type CellView = {
  text: string;
  className: string;
  style?: React.CSSProperties;
  title?: string;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Diverging tint for a 0..1 position: red (0) → amber (0.5) → green (1). */
function diverging(t: number, alpha: number): string {
  const hue = 8 + clamp01(t) * 130; // 8 = red, 138 = green
  return `hsla(${hue.toFixed(0)}, 70%, 45%, ${alpha.toFixed(3)})`;
}

export function viewOf(v: Value): CellView {
  if (v === null || v === undefined) return { text: "", className: "cell" };
  if (isError(v)) {
    if (v.error === "#PENDING") return { text: "…", className: "cell pending", title: "waiting for Jev" };
    return { text: v.error, className: "cell error", title: v.message };
  }
  if (isJev(v)) {
    if (v.jev === "judge") {
      const p = typeof v.value === "number" ? v.value : 0;
      // single-hue heat: intensity scales with probability
      const bg = `rgba(56, 189, 248, ${(0.06 + p * 0.55).toFixed(3)})`;
      return {
        text: `${Math.round(p * 100)}%`,
        className: "cell jev judge",
        style: { background: bg, color: p > 0.6 ? "#0b1220" : "#cbd5e1" },
        title: `JUDGE → p=${p.toFixed(3)}`,
      };
    }
    if (v.jev === "pick") {
      const bg = `rgba(167, 139, 250, ${(0.08 + v.confidence * 0.5).toFixed(3)})`;
      const probs = v.probabilities
        ? Object.entries(v.probabilities)
            .sort((a, b) => b[1] - a[1])
            .map(([k, p]) => `${k} ${Math.round(p * 100)}%`)
            .join(" · ")
        : "";
      return {
        text: String(v.value),
        className: "cell jev pick",
        style: { background: bg },
        title: `PICK → ${v.value} (confidence ${Math.round(v.confidence * 100)}%)\n${probs}`,
      };
    }
    const n = typeof v.value === "number" ? v.value : 0;
    const max = Math.max(1, (v.levels?.length ?? 2) - 1);
    const label = v.levels?.[Math.round(n)] ?? "";
    return {
      text: formatNumber(n),
      className: "cell jev rate",
      style: { background: diverging(n / max, 0.12 + v.confidence * 0.5) },
      title: `RATE → ${n} = ${label} (confidence ${Math.round(v.confidence * 100)}%)`,
    };
  }
  if (typeof v === "number") return { text: formatNumber(v), className: "cell num" };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", className: "cell bool" };
  return { text: v, className: "cell text" };
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
