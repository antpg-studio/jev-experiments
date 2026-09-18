import type { Answer, Span, Verdict } from "./lib/types";
import type { Decision } from "./lib/policy";
import type { Sample } from "./useGuard";
import Chips from "./Chips";
import Latency from "./Latency";
import { Close, Play, ShieldCheck, Stop } from "./Icons";

export interface ScenarioResult {
  title: string;
  channel: string;
  expect: Verdict;
  jev: Verdict;
  jevReason: string;
  regex: Verdict;
  ms: number;
  judgments: number;
}

interface Props {
  onClose: () => void;
  answers: Record<string, Answer>;
  spans: Span[];
  decision: Decision;
  hasAnswers: boolean;
  inflight: boolean;
  samples: Sample[];
  cancelled: number;
  model: string;
  mock: boolean;
  hasKey: boolean;
  regexOnly: boolean;
  onRegexOnly: (v: boolean) => void;
  regex: { verdict: Verdict; reason: string };
  draftEmpty: boolean;
  replaying: boolean;
  onReplay: () => void;
  results: ScenarioResult[];
  error: string | null;
}

const VERDICT_TEXT: Record<Verdict, string> = { send: "Looks good", warn: "Heads up", block: "Blocked" };

export default function GuardPanel(p: Props) {
  const jevVerdict: Verdict | null = p.hasAnswers && !p.draftEmpty ? p.decision.verdict : null;
  const regexVerdict: Verdict | null = p.draftEmpty ? null : p.regex.verdict;
  const hits = p.results.filter((r) => r.jev === r.expect).length;
  const regexHits = p.results.filter((r) => r.regex === r.expect).length;

  return (
    <aside className="details">
      <div className="details-head">
        <span className="details-title">
          <ShieldCheck size={18} /> Send Guard
        </span>
        <span className="details-model">
          {p.mock ? <span className="badge badge-mock">MOCK — heuristic answers, not Jev</span> : !p.hasKey ? <span className="badge badge-err">TYPESAFE_API_KEY missing</span> : p.model ? <span className="badge">{p.model}</span> : null}
        </span>
        <button className="icon-btn light" onClick={p.onClose} aria-label="Close">
          <Close size={18} />
        </button>
      </div>

      <div className="details-scroll">
        <section className="d-section verdicts">
          <div className={`verdict-card v-${jevVerdict ?? "none"} ${p.regexOnly ? "" : "primary"}`}>
            <div className="v-label">Jev · every pause</div>
            <div className="v-value">{jevVerdict ? VERDICT_TEXT[jevVerdict] : "—"}</div>
            <div className="v-reason">{jevVerdict ? p.decision.reason : "start typing"}</div>
          </div>
          <div className={`verdict-card v-${regexVerdict ?? "none"} ${p.regexOnly ? "primary" : ""}`}>
            <div className="v-label">Regex DLP · old way</div>
            <div className="v-value">{regexVerdict ? VERDICT_TEXT[regexVerdict] : "—"}</div>
            <div className="v-reason">{regexVerdict ? p.regex.reason.replace(/^regex: /, "") : "pattern match only"}</div>
          </div>
        </section>

        <label className="switch-row">
          <input type="checkbox" checked={p.regexOnly} onChange={(e) => p.onRegexOnly(e.target.checked)} />
          <span className="switch" />
          <span>Gate Send with regex only (no Jev)</span>
        </label>

        {p.error && <div className="error">{p.error}</div>}

        <section className="d-section">
          <h3>
            Judgments <span className="dim">one request · {10 + p.spans.length} questions</span>
          </h3>
          <Chips answers={p.answers} inflight={p.inflight} />
        </section>

        <section className="d-section">
          <h3>
            Located spans <span className="dim">regex finds, Jev decides</span>
          </h3>
          <ul className="spans">
            {p.spans.length === 0 && <li className="dim">no emails, keys, amounts or dates in the draft</li>}
            {p.spans.map((s) => {
              const a = p.answers[s.id];
              const prob = a && a.type === "noul" ? a.noul : null;
              const culprit = p.decision.culpritSpanIds.includes(s.id);
              return (
                <li key={s.id} className={culprit ? "span-bad" : "span-ok"}>
                  <span className="span-kind">{s.kind}</span>
                  <code>{s.text}</code>
                  <span className="span-p">{prob === null ? "…" : `${Math.round(prob * 100)}%`}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="d-section">
          <h3>
            Latency <span className="dim">measured in the browser</span>
          </h3>
          <Latency samples={p.samples} cancelled={p.cancelled} />
        </section>

        <section className="d-section">
          <div className="replay-head">
            <h3>Replay 6 scenarios</h3>
            <button className={`btn ${p.replaying ? "btn-stop" : "btn-replay"}`} onClick={p.onReplay}>
              {p.replaying ? <Stop size={14} /> : <Play size={14} />} {p.replaying ? "Stop" : "Replay"}
            </button>
          </div>
          {p.results.length === 0 ? (
            <p className="dim small">Types six real drafts hands-free — a pasted key, a guaranteed date, a hostile reply, a pricing leak…</p>
          ) : (
            <>
              <table className="results">
                <thead>
                  <tr>
                    <th>draft</th>
                    <th>Jev</th>
                    <th>regex</th>
                    <th>ms</th>
                  </tr>
                </thead>
                <tbody>
                  {p.results.map((r) => (
                    <tr key={r.title}>
                      <td title={`${r.channel} · expected ${r.expect}`}>{r.title}</td>
                      <td title={r.jevReason}>
                        <span className={`pill pill-${r.jev} ${r.jev === r.expect ? "" : "pill-miss"}`}>{r.jev}</span>
                      </td>
                      <td>
                        <span className={`pill pill-${r.regex} ${r.regex === r.expect ? "" : "pill-miss"}`}>{r.regex}</span>
                      </td>
                      <td className="mono">{Math.round(r.ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dim small">
                Jev {hits}/{p.results.length} correct · regex {regexHits}/{p.results.length}
              </p>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
