import type { RunResult } from "./run.ts";
import type { Finding, HunkJudgment, RiskLevel } from "./types.ts";

// ---------- colours ----------

const useColor = (): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
};

const wrap = (open: number, close = 39) => (s: string) => (useColor() ? `\u001b[${open}m${s}\u001b[${close}m` : s);
export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  gray: wrap(90),
  bgRed: (s: string) => (useColor() ? `\u001b[41;97;1m${s}\u001b[0m` : s),
  bgYellow: (s: string) => (useColor() ? `\u001b[43;30;1m${s}\u001b[0m` : s),
  bgGreen: (s: string) => (useColor() ? `\u001b[42;30;1m${s}\u001b[0m` : s),
};

const RISK_COLOR: Record<RiskLevel, (s: string) => string> = {
  cosmetic: c.gray,
  low: c.green,
  moderate: c.yellow,
  high: c.magenta,
  dangerous: c.red,
};

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const width = (s: string) => stripAnsi(s).length;
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - width(s)));
const padStart = (s: string, n: number) => " ".repeat(Math.max(0, n - width(s))) + s;
const ms = (n: number) => `${Math.round(n)} ms`;
const pct = (p: number) => `${Math.round(p * 100)}%`;

export function riskBar(risk: number, cells = 10): string {
  const filled = Math.round((Math.max(0, Math.min(4, risk)) / 4) * cells);
  const level = levelFor(risk);
  return RISK_COLOR[level]("█".repeat(filled)) + c.gray("░".repeat(cells - filled));
}

function levelFor(risk: number): RiskLevel {
  const levels: RiskLevel[] = ["cosmetic", "low", "moderate", "high", "dangerous"];
  return levels[Math.max(0, Math.min(4, Math.round(risk)))]!;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------- header / progress ----------

export function renderHeader(hunks: number, files: number, message: string | null, mockLabel: string | null): string {
  const lines = [
    `${c.bold(c.cyan("◆ commit-sentry"))} ${c.dim("·")} ${c.bold(String(hunks))} hunks in ${c.bold(String(files))} files` +
      (message ? ` ${c.dim("·")} ${c.dim('"' + truncate(message.split("\n")[0] ?? "", 60) + '"')}` : ""),
  ];
  if (mockLabel) lines.push(c.bgYellow(` ${mockLabel} `));
  return lines.join("\n");
}

export function renderProgress(done: number, total: number, lastLatency: number | undefined, elapsedMs: number): string {
  const cells = 24;
  const filled = total === 0 ? cells : Math.round((done / total) * cells);
  const bar = c.cyan("━".repeat(filled)) + c.gray("━".repeat(cells - filled));
  const last = lastLatency === undefined ? "" : c.dim(` last ${ms(lastLatency)}`);
  return `  ${bar} ${padStart(`${done}/${total}`, 5)} hunks judged ${c.dim(`in ${ms(elapsedMs)}`)}${last}`;
}

// ---------- table ----------

export function renderFileTable(r: RunResult): string {
  const byId = new Map(r.judgments.map((j) => [j.hunkId, j]));
  const rows: string[] = [];
  const fileW = Math.min(44, Math.max(12, ...r.fileSummaries.map((s) => s.file.length)));
  rows.push(
    c.dim(
      `  ${pad("FILE", fileW)}  ${pad("HUNKS", 5)}  ${pad("RISK", 20)}  ${pad("KIND", 16)}  ${pad("LATENCY", 8)}  FINDINGS`,
    ),
  );
  for (const s of r.fileSummaries) {
    const js = r.hunks.filter((h) => h.file === s.file).map((h) => byId.get(h.id)).filter((j): j is HunkJudgment => !!j);
    const level = levelFor(s.maxRisk);
    const lat = js.length ? Math.max(...js.map((j) => j.latencyMs)) : 0;
    const findings =
      s.findings === 0
        ? c.green("clean")
        : [s.blocking ? c.red(`${s.blocking} block`) : "", s.findings - s.blocking ? c.yellow(`${s.findings - s.blocking} warn`) : ""]
            .filter(Boolean)
            .join(c.dim(" · "));
    rows.push(
      `  ${pad(truncate(s.file, fileW), fileW)}  ${padStart(String(s.hunks), 5)}  ${riskBar(s.maxRisk)} ${pad(RISK_COLOR[level](level), 9)}  ${pad(c.dim(truncate(s.kinds.join("/"), 16)), 16)}  ${padStart(c.dim(ms(lat)), 8)}  ${findings}`,
    );
  }
  return rows.join("\n");
}

// ---------- findings ----------

export function renderFindings(findings: Finding[]): string {
  if (findings.length === 0) return `  ${c.green("✔ no findings")}`;
  const out: string[] = [];
  const byHunk = new Map<string, Finding[]>();
  for (const f of findings) byHunk.set(f.hunkId, [...(byHunk.get(f.hunkId) ?? []), f]);
  for (const [, fs] of byHunk) {
    const first = fs[0]!;
    const sev = fs.some((f) => f.severity === "block") ? c.bgRed(" BLOCK ") : c.bgYellow(" WARN  ");
    const loc = first.line !== undefined ? `${first.file}:${first.line}` : first.file;
    const labels = fs
      .map((f) => (f.severity === "block" ? c.red(f.label) : c.yellow(f.label)) + c.dim(` ${pct(f.probability)}`))
      .join(c.dim("  ·  "));
    out.push(`  ${sev} ${c.bold(loc)}`);
    out.push(`          ${labels}`);
    for (const q of first.quoted.slice(0, 3)) {
      const colored = q.startsWith("+") ? c.green(q) : q.startsWith("-") ? c.red(q) : c.dim(q);
      out.push(`          ${c.dim("│")} ${truncate(colored, 110)}`);
    }
  }
  return out.join("\n");
}

// ---------- timings ----------

export function renderHunkTimings(r: RunResult): string {
  const byId = new Map(r.judgments.map((j) => [j.hunkId, j]));
  const max = Math.max(1, ...r.judgments.map((j) => j.latencyMs));
  const idW = Math.min(40, Math.max(...r.hunks.map((h) => h.id.length)));
  const out = [c.dim(`  ${pad("HUNK", idW)}  ${pad("RISK", 10)}  LATENCY (one request, ${r.judgments[0] ? hunkQuestions(r) : 0} judgments each)`)];
  for (const h of r.hunks) {
    const j = byId.get(h.id);
    if (!j) continue;
    const cells = Math.max(1, Math.round((j.latencyMs / max) * 28));
    const retry = j.attempts > 1 ? c.yellow(` (${j.attempts} attempts)`) : "";
    out.push(
      `  ${pad(truncate(h.id, idW), idW)}  ${pad(RISK_COLOR[j.riskLevel](j.riskLevel), 10)}  ${c.cyan("▍".repeat(cells))} ${c.dim(ms(j.latencyMs))}${retry}`,
    );
  }
  if (r.message) out.push(`  ${pad("commit message", idW)}  ${pad(c.dim(r.message.qualityLevel), 10)}  ${c.cyan("▍".repeat(Math.max(1, Math.round((r.message.latencyMs / max) * 28))))} ${c.dim(ms(r.message.latencyMs))}`);
  return out.join("\n");
}

function hunkQuestions(r: RunResult): number {
  return Math.round((r.timing.judgments - (r.message ? 2 : 0)) / Math.max(1, r.judgments.length));
}

export function renderSummary(r: RunResult): string {
  const t = r.timing;
  const out: string[] = [];
  out.push(
    `  ${c.bold(`${r.hunks.length} hunks`)} ${c.dim("·")} ${c.bold(`${t.judgments} judgments`)} ${c.dim("·")} ${t.requests} requests ${c.dim("·")} ${c.bold(c.cyan(ms(t.totalMs)))} total ${c.dim("·")} p50 ${c.bold(ms(t.p50))} ${c.dim("·")} p95 ${ms(t.p95)} ${c.dim("·")} ${t.hunksPerSecond.toFixed(1)} hunks/s ${c.dim("·")} concurrency 16` +
      (t.retries ? c.yellow(` · ${t.retries} retries`) : ""),
  );
  const b = r.baseline;
  const total = b.caught + b.missed;
  out.push(
    `  ${c.dim("vs regex linter:")}  ${b.rules} rules in ${b.elapsedMs.toFixed(2)} ms, flagged ${c.bold(`${b.caught}/${total}`)} of the findings above${b.missed ? c.red(` (missed ${b.missed})`) : ""}${b.extra ? c.dim(` +${b.extra} not confirmed by Jev`) : ""}`,
  );
  const llmLow = 10_000;
  const llmHigh = 60_000;
  out.push(
    `  ${c.dim("vs LLM reviewer:")}  ${c.dim(`typical 10–60 s per review, in CI after the commit — this hook ran ${Math.round(llmLow / t.totalMs)}–${Math.round(llmHigh / t.totalMs)}× faster, before the commit`)}`,
  );
  if (r.message) {
    const m = r.message;
    const match = m.matchesChanges >= 0.35 ? c.green(`matches changes ${pct(m.matchesChanges)}`) : c.yellow(`matches changes ${pct(m.matchesChanges)}`);
    out.push(`  ${c.dim("commit message:")}   quality ${c.bold(m.qualityLevel)} ${c.dim(`(${m.quality.toFixed(2)}/3)`)} ${c.dim("·")} ${match}`);
  }
  return out.join("\n");
}

export function renderVerdict(r: RunResult, strict: boolean): string {
  const p = r.policy;
  const flag = strict ? c.dim(" (--strict)") : "";
  if (p.verdict === "block")
    return `  ${c.bgRed(" ✖ COMMIT BLOCKED ")} ${c.red(`${p.blocking.length} blocking finding${p.blocking.length === 1 ? "" : "s"}`)}${p.warnings.length ? c.dim(`, ${p.warnings.length} warnings`) : ""}${flag} ${c.dim("· fix them or bypass with git commit --no-verify")}`;
  if (p.verdict === "warn")
    return `  ${c.bgYellow(" ⚠ COMMIT ALLOWED WITH WARNINGS ")} ${c.yellow(`${p.warnings.length} warning${p.warnings.length === 1 ? "" : "s"}`)}${flag}`;
  return `  ${c.bgGreen(" ✔ COMMIT ALLOWED ")} ${c.green("no findings")}${flag}`;
}

export function renderReport(r: RunResult, strict: boolean, showTimings: boolean): string {
  const parts = [
    "",
    renderFileTable(r),
    "",
    c.bold("  FINDINGS"),
    renderFindings(r.policy.findings),
  ];
  if (showTimings) parts.push("", c.bold("  TIMINGS"), renderHunkTimings(r));
  parts.push("", renderSummary(r), "", renderVerdict(r, strict), "");
  return parts.join("\n");
}
