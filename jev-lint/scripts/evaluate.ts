// Live evaluation against the Jev API: full-file scan of every sample, precision/recall
// against the planted issues, and latency stats. Run with:
//   TYPESAFE_API_KEY=... node scripts/evaluate.ts [sample id]   (Node 22.18+/24 strips types natively)
// Not part of `npm test` (network).

import { evaluate, pct } from "../src/eval.ts";
import { Linter } from "../src/linter.ts";
import { SAMPLES } from "../src/samples.ts";
import { fmtMs } from "../src/metrics.ts";

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY not set");

const fetchImpl: typeof fetch = (input, init) =>
  fetch("https://api.typesafe.ai/v1/systemone", { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: `Bearer ${key}` } });

const only = process.argv[2];
const rows: string[] = [];
let tp = 0;
let fp = 0;
let fn = 0;
for (const s of SAMPLES) {
  if (only && s.id !== only) continue;
  const linter = new Linter(s.text, s.language, { fetchImpl, endpoint: "systemone" });
  const scan = await linter.fullScan();
  const markers = linter.getMarkers();
  const ev = evaluate(markers, s.planted);
  tp += ev.tp;
  fp += ev.fp;
  fn += ev.fn;
  const snap = linter.metrics.snapshot();
  rows.push(`| ${s.label} | ${s.planted.length} | ${ev.tp} | ${ev.fp} | ${ev.fn} | ${pct(ev.precision)} | ${pct(ev.recall)} | ${scan.requests} | ${scan.questions} | ${Math.round(scan.wallMs)} ms | ${fmtMs(snap.p50)} ms |`);
  console.log(`\n== ${s.label} (${s.filename}) burst ${Math.round(scan.wallMs)} ms, ${scan.requests} req, ${scan.questions} q, ${scan.inputTokens} in-tokens, failed ${scan.failed}`);
  for (const e of linter.log) if (e.status === "fallback") console.log(`  FAIL seq ${e.seq} lines ${e.lines.join(",")}: ${e.detail}`);
  console.log(`precision ${pct(ev.precision)} recall ${pct(ev.recall)}  tp=${ev.tp} fp=${ev.fp} fn=${ev.fn} kindMatch=${ev.kindMatches}`);
  const lines = s.text.split("\n");
  for (const m of markers) {
    const planted = s.planted.find((p) => p.line === m.line);
    const tag = planted ? "TP" : m.severity === "info" ? "info" : "FP";
    console.log(`  ${tag.padEnd(4)} L${String(m.line).padStart(3)} ${m.severity.padEnd(7)} ${m.message.padEnd(70)} ${lines[m.line - 1].trim().slice(0, 60)}`);
  }
  for (const l of ev.missedLines) {
    const m = markers.find((x) => x.line === l);
    console.log(`  MISS L${String(l).padStart(3)} ${m ? `(${m.severity}: ${m.message})` : "(no marker)"} ${lines[l - 1].trim().slice(0, 70)}`);
  }
}
console.log("\n| File | Planted | TP | FP | FN | Precision | Recall | Requests | Questions | Burst wall-clock | p50 request |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(r);
console.log(`\nOverall precision ${pct(tp / (tp + fp))} recall ${pct(tp / (tp + fn))}`);
