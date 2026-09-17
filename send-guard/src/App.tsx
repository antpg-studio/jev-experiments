import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chips from "./Chips";
import Composer from "./Composer";
import Latency from "./Latency";
import { AUDIENCE_LABEL, CHANNELS } from "./lib/channels";
import { decide } from "./lib/policy";
import { SCENARIOS } from "./lib/scenarios";
import { findSpans, regexOnlyFlags } from "./lib/spans";
import type { Verdict } from "./lib/types";
import { DEBOUNCE_MS, useGuard } from "./useGuard";

interface ScenarioResult {
  title: string;
  channel: string;
  expect: Verdict;
  jev: Verdict;
  jevReason: string;
  regex: Verdict;
  ms: number;
  judgments: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a classic regex DLP rule would decide: block on key-like tokens, warn on emails/phones, else send. */
function regexVerdict(kinds: string[]): { verdict: Verdict; reason: string } {
  if (kinds.includes("key")) return { verdict: "block", reason: "regex: key-like token" };
  if (kinds.includes("email") || kinds.includes("phone")) return { verdict: "warn", reason: "regex: contact detail" };
  return { verdict: "send", reason: "regex: no pattern matched" };
}

export default function App() {
  const [channelId, setChannelId] = useState(CHANNELS[0].id);
  const [draft, setDraft] = useState("");
  const [regexOnly, setRegexOnly] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [health, setHealth] = useState<{ mock: boolean; hasKey: boolean } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const abortReplay = useRef(false);

  const channel = useMemo(() => CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0], [channelId]);
  const guard = useGuard(draft, channel);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { mock: boolean; hasKey: boolean }) => setHealth(h))
      .catch(() => setHealth({ mock: false, hasKey: false }));
  }, []);

  const stale = guard.judgedDraft !== draft || guard.judgedChannel !== channel.id;
  const decision = useMemo(() => decide(guard.answers, channel.audience, guard.spans), [guard.answers, channel.audience, guard.spans]);
  const liveSpans = useMemo(() => findSpans(draft), [draft]);
  const regexFlagged = useMemo(() => regexOnlyFlags(liveSpans), [liveSpans]);
  const regex = regexVerdict(regexFlagged.map((s) => s.kind));
  const hasAnswers = Object.keys(guard.answers).length > 0;

  const empty = draft.trim().length === 0;
  const shown: { verdict: Verdict; reason: string } = regexOnly ? regex : hasAnswers ? decision : { verdict: "send", reason: "Start typing…" };
  const buttonVerdict: Verdict = empty ? "send" : shown.verdict;
  // Jev mode: Send only unlocks once the exact current draft + channel has been judged.
  const awaitingJudgment = !regexOnly && !empty && (stale || guard.inflight || !hasAnswers);
  const canSend = !empty && buttonVerdict !== "block" && !awaitingJudgment;

  const guardRef = useRef(guard);
  guardRef.current = guard;

  const replay = useCallback(async () => {
    if (replaying) {
      abortReplay.current = true;
      return;
    }
    setReplaying(true);
    setResults([]);
    setSent(null);
    abortReplay.current = false;
    for (const sc of SCENARIOS) {
      if (abortReplay.current) break;
      setChannelId(sc.channelId);
      setDraft("");
      await sleep(350);
      let typed = "";
      for (const ch of sc.draft) {
        if (abortReplay.current) break;
        typed += ch;
        setDraft(typed);
        // Humans type in bursts: fast inside a word, a longer pause after punctuation or a word boundary.
        if (/[.!?,;:—]/.test(ch)) await sleep(260);
        else if (ch === " " && Math.random() < 0.35) await sleep(180);
        else await sleep(18 + Math.random() * 22);
      }
      if (abortReplay.current) break;
      // Wait for the final judgment of the complete draft.
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline && (guardRef.current.judgedDraft !== sc.draft || guardRef.current.inflight)) await sleep(30);
      const g = guardRef.current;
      const ch = CHANNELS.find((c) => c.id === sc.channelId) ?? CHANNELS[0];
      const d = decide(g.answers, ch.audience, g.spans);
      const r = regexVerdict(regexOnlyFlags(g.spans).map((s) => s.kind));
      setResults((rs) => [
        ...rs,
        {
          title: sc.title,
          channel: ch.name,
          expect: sc.expect,
          jev: d.verdict,
          jevReason: d.reason,
          regex: r.verdict,
          ms: g.last?.clientMs ?? 0,
          judgments: g.last?.judgments ?? 0,
        },
      ]);
      await sleep(1400);
    }
    setReplaying(false);
  }, [replaying]);

  const onSend = () => {
    if (!canSend) return;
    setSent(`Sent to ${channel.name} at ${new Date().toLocaleTimeString()}`);
    setDraft("");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">▣</span> Send Guard
          <span className="brand-sub">every pause in typing → one Jev request → {10}+ judgments</span>
        </div>
        <div className="topbar-right">
          {health?.mock && <span className="badge badge-mock">MOCK MODE — heuristic answers, not Jev</span>}
          {health && !health.mock && !health.hasKey && <span className="badge badge-err">TYPESAFE_API_KEY missing on server</span>}
          {guard.model && !guard.mock && <span className="badge">{guard.model}</span>}
          <label className="toggle">
            <input type="checkbox" checked={regexOnly} onChange={(e) => setRegexOnly(e.target.checked)} />
            <span>regex-only DLP (the old way)</span>
          </label>
          <button className={`btn ${replaying ? "btn-stop" : "btn-replay"}`} onClick={() => void replay()}>
            {replaying ? "■ Stop replay" : "▶ Replay 6 scenarios"}
          </button>
        </div>
      </header>

      <main className="grid">
        <section className="panel compose-panel">
          <div className="channel-row">
            <label>
              To
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={replaying}>
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <span className={`audience audience-${channel.audience}`}>{AUDIENCE_LABEL[channel.audience]}</span>
            <span className="channel-desc">{channel.description}</span>
          </div>

          <Composer
            value={draft}
            onChange={(v) => {
              setSent(null);
              setDraft(v);
            }}
            spans={regexOnly ? liveSpans : guard.spans}
            culprits={new Set(decision.culpritSpanIds)}
            regexOnly={regexOnly}
            regexFlagged={new Set(regexFlagged.map((s) => s.id))}
            disabled={replaying}
            placeholder={`Message ${channel.name}…  (try pasting an API key, promising a date, or venting)`}
          />

          <div className="send-row">
            <button className={`send send-${awaitingJudgment ? "pending" : buttonVerdict}`} disabled={!canSend} onClick={onSend}>
              {awaitingJudgment ? "Judging…" : buttonVerdict === "block" ? "Blocked" : buttonVerdict === "warn" ? "Send anyway" : "Send"}
              <span className="send-reason">{empty ? "" : awaitingJudgment ? "waiting for Jev on the current draft" : shown.reason}</span>
            </button>
            <div className="status">
              {regexOnly ? (
                <span className="status-regex">regex-only · 0 ms · {regexFlagged.length} pattern hit{regexFlagged.length === 1 ? "" : "s"}</span>
              ) : (
                <>
                  <span className={`spinner ${guard.inflight ? "on" : ""}`} />
                  {guard.last ? (
                    <span>
                      <b>{guard.last.judgments} judgments</b> in <b>{Math.round(guard.last.clientMs)} ms</b>
                      <span className="dim"> (API {Math.round(guard.last.apiMs)} ms)</span>
                      {stale && draft.trim() && <span className="dim"> · re-judging in {DEBOUNCE_MS} ms</span>}
                    </span>
                  ) : (
                    <span className="dim">debounce {DEBOUNCE_MS} ms · stale requests cancelled</span>
                  )}
                </>
              )}
              {guard.error && <span className="error">{guard.error}</span>}
              {sent && <span className="sent">{sent}</span>}
            </div>
          </div>

          <div className="compare-row">
            <span>Jev: </span>
            <span className={`pill pill-${hasAnswers ? decision.verdict : "none"}`}>{hasAnswers ? decision.verdict : "—"}</span>
            <span className="dim">{hasAnswers ? decision.reason : ""}</span>
            <span className="sep">|</span>
            <span>regex DLP: </span>
            <span className={`pill pill-${draft.trim() ? regex.verdict : "none"}`}>{draft.trim() ? regex.verdict : "—"}</span>
            <span className="dim">{draft.trim() ? regex.reason : ""}</span>
          </div>
        </section>

        <section className="panel chips-panel">
          <h2>
            Live judgments <span className="dim">one request · {10 + guard.spans.length} questions</span>
          </h2>
          <Chips answers={guard.answers} inflight={guard.inflight} />
          <h3>
            Culprit spans <span className="dim">regex locates, Jev decides</span>
          </h3>
          <ul className="spans">
            {guard.spans.length === 0 && <li className="dim">no candidate spans in draft</li>}
            {guard.spans.map((s) => {
              const a = guard.answers[s.id];
              const p = a && a.type === "noul" ? a.noul : null;
              const culprit = decision.culpritSpanIds.includes(s.id);
              return (
                <li key={s.id} className={culprit ? "span-bad" : "span-ok"}>
                  <span className="span-kind">{s.kind}</span>
                  <code>{s.text}</code>
                  <span className="span-p">{p === null ? "…" : `${Math.round(p * 100)}% problem`}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel results-panel">
          <h2>
            Replay log <span className="dim">Jev vs regex DLP</span>
          </h2>
          <table className="results">
            <thead>
              <tr>
                <th>scenario</th>
                <th>channel</th>
                <th>expected</th>
                <th>Jev</th>
                <th>regex</th>
                <th>latency</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 && (
                <tr>
                  <td colSpan={6} className="dim">
                    press ▶ Replay to type six prepared drafts hands-free
                  </td>
                </tr>
              )}
              {results.map((r) => (
                <tr key={r.title}>
                  <td>{r.title}</td>
                  <td className="dim">{r.channel}</td>
                  <td>
                    <span className={`pill pill-${r.expect}`}>{r.expect}</span>
                  </td>
                  <td title={r.jevReason}>
                    <span className={`pill pill-${r.jev} ${r.jev === r.expect ? "" : "pill-miss"}`}>{r.jev}</span>
                  </td>
                  <td>
                    <span className={`pill pill-${r.regex} ${r.regex === r.expect ? "" : "pill-miss"}`}>{r.regex}</span>
                  </td>
                  <td className="mono">
                    {r.judgments} in {Math.round(r.ms)} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel latency-panel">
          <h2>
            Latency <span className="dim">measured in the browser around each request, plus the proxy's API round trip</span>
          </h2>
          <Latency samples={guard.samples} cancelled={guard.cancelled} />
        </section>
      </main>
    </div>
  );
}
