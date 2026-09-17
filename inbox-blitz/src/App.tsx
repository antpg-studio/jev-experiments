import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EMAILS } from "./data/emails";
import type { Category, Email, Judgment, JudgmentResult } from "./lib/types";
import { SENTIMENT_LEVELS, URGENCY_LEVELS } from "./lib/types";
import { DEFAULT_WEIGHTS, HUMAN_CONFIDENCE, WEIGHT_LABELS, lane, priority, rank, type Lane, type Weights } from "./lib/priority";
import { fmtMs, fmtUsd, QUESTIONS_PER_EMAIL } from "./lib/stats";
import { agreement, classifyRules, DIMENSIONS, disagreements, type Dimension, type RuleVerdict } from "./lib/rules";
import { useTriage } from "./useTriage";

type LaneFilter = Lane | "all" | "archived" | "disagree";

interface Row {
  email: Email;
  result?: JudgmentResult;
  judgment?: Judgment;
  rule: RuleVerdict;
  disagree: Dimension[];
  receivedAt: string;
}

const CATEGORY_LABEL: Record<Category, string> = {
  billing: "Billing",
  bug: "Bug",
  feature_request: "Feature",
  sales_lead: "Sales lead",
  security: "Security",
  legal_privacy: "Legal",
  spam_marketing: "Spam",
  internal: "Internal",
  other: "Other",
};

const DIM_LABEL: Record<Dimension, string> = {
  category: "category",
  needsReply: "needs reply",
  urgency: "urgency",
  sentiment: "sentiment",
  isPhishingOrScam: "phishing",
  mentionsChurnOrCancel: "churn",
  asksForRefund: "refund",
};

const RULES = new Map(EMAILS.map((e) => [e.id, classifyRules(e)]));

function timeAgo(iso: string): string {
  const mins = Math.round((Date.parse("2026-09-17T17:00:00Z") - Date.parse(iso)) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const yes = (p: number) => p >= 0.5;

export default function App() {
  const triage = useTriage(EMAILS.length);
  const { phase, results, errors, stats, meta, fatal } = triage;

  const [concurrency, setConcurrency] = useState(12);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [laneFilter, setLaneFilter] = useState<LaneFilter>("all");
  const [rulesOn, setRulesOn] = useState(false);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [replyFlag, setReplyFlag] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>(EMAILS[0].id);
  const [health, setHealth] = useState<{ hasKey: boolean; mock: boolean; model: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { hasKey: boolean; mock: boolean; model: string }) => setHealth(h))
      .catch(() => setHealth(null));
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      EMAILS.map((email) => {
        const result = results.get(email.id);
        const rule = RULES.get(email.id)!;
        return { email, result, judgment: result?.judgment, rule, disagree: result ? disagreements(rule, result.judgment) : [], receivedAt: email.receivedAt };
      }),
    [results],
  );

  const sorted = useMemo(() => (phase === "done" ? rank(rows, weights) : rows), [rows, weights, phase]);

  const laneCounts = useMemo(() => {
    const c: Record<LaneFilter, number> = { all: 0, priority: 0, human: 0, fyi: 0, spam: 0, archived: 0, disagree: 0 };
    for (const r of rows) {
      if (archived.has(r.email.id)) {
        c.archived++;
        continue;
      }
      c.all++;
      if (r.judgment) c[lane(r.judgment)]++;
      if (r.disagree.length) c.disagree++;
    }
    return c;
  }, [rows, archived]);

  const visible = useMemo(
    () =>
      sorted.filter((r) => {
        const isArchived = archived.has(r.email.id);
        if (laneFilter === "archived") return isArchived;
        if (isArchived) return false;
        if (laneFilter === "all") return true;
        if (laneFilter === "disagree") return r.disagree.length > 0;
        return r.judgment ? lane(r.judgment) === laneFilter : false;
      }),
    [sorted, laneFilter, archived],
  );

  const agree = useMemo(() => agreement(rows.filter((r) => r.judgment).map((r) => ({ rule: r.rule, judgment: r.judgment! }))), [rows]);

  const selected = rows.find((r) => r.email.id === selectedId) ?? null;

  // Keyboard triage
  const move = useCallback(
    (delta: number) => {
      const idx = visible.findIndex((r) => r.email.id === selectedId);
      const next = visible[Math.max(0, Math.min(visible.length - 1, (idx < 0 ? 0 : idx) + delta))];
      if (next) setSelectedId(next.email.id);
    },
    [visible, selectedId],
  );
  const archive = useCallback(() => {
    if (!selectedId) return;
    const idx = visible.findIndex((r) => r.email.id === selectedId);
    setArchived((prev) => {
      const n = new Set(prev);
      if (n.has(selectedId)) n.delete(selectedId);
      else n.add(selectedId);
      return n;
    });
    const next = visible[idx + 1] ?? visible[idx - 1];
    if (next && laneFilter !== "archived") setSelectedId(next.email.id);
  }, [selectedId, visible, laneFilter]);
  const toggleReply = useCallback(() => {
    if (!selectedId) return;
    setReplyFlag((prev) => {
      const n = new Set(prev);
      if (n.has(selectedId)) n.delete(selectedId);
      else n.add(selectedId);
      return n;
    });
  }, [selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "e":
          archive();
          break;
        case "r":
          toggleReply();
          break;
        case "b":
          setRulesOn((v) => !v);
          break;
        case "Enter":
          if (phase === "idle") void triage.start(concurrency);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, archive, toggleReply, phase, triage, concurrency]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId, visible]);

  const isMock = meta?.mock ?? health?.mock ?? false;
  const modelLabel = meta?.model ?? health?.model ?? "jev-latest";
  const running = phase === "running";

  return (
    <div className={`app ${isMock ? "mock" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">⚡</span>
          <span className="name">Inbox Blitz</span>
          <span className={`mode ${isMock ? "mode-mock" : "mode-live"}`} title={isMock ? "Replaying recorded answers — no live inference" : "Live TypeSafe inference"}>
            {isMock ? "MOCK REPLAY" : "LIVE"} · {modelLabel}
          </span>
          {health && !health.hasKey && !health.mock && <span className="warn">TYPESAFE_API_KEY not set on server</span>}
        </div>
        <div className="controls">
          <label className="conc">
            concurrency
            <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} disabled={running}>
              {[4, 8, 12, 16, 24, 32].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {running ? (
            <button className="big stop" onClick={triage.stop}>
              Stop
            </button>
          ) : (
            <button className="big" onClick={() => void triage.start(concurrency)}>
              {phase === "idle" ? "Triage inbox" : "Re-run triage"} <span className="sub">{EMAILS.length} emails · {QUESTIONS_PER_EMAIL} judgments each</span>
            </button>
          )}
        </div>
      </header>

      <section className="hud">
        <Metric label="processed" value={`${stats.processed}`} sub={`/ ${stats.total}${stats.errors ? ` · ${stats.errors} err` : ""}`} />
        <Metric label="judgments" value={stats.judgments.toLocaleString()} sub={`${QUESTIONS_PER_EMAIL} per email`} />
        <Metric label="emails / sec" value={stats.perSecond.toFixed(1)} hot />
        <Metric label="p50 latency" value={fmtMs(stats.p50)} sub="per request, server-measured" />
        <Metric label="p95 latency" value={fmtMs(stats.p95)} />
        <Metric label="elapsed" value={fmtMs(stats.elapsedMs)} hot={running} />
        <Metric label="est. cost" value={fmtUsd(stats.costUsd)} sub={`${stats.inputTokens.toLocaleString()} input tok`} />
        <div className="progress">
          <div className="bar" style={{ width: `${(stats.processed / Math.max(1, stats.total)) * 100}%` }} />
        </div>
      </section>

      {fatal && <div className="fatal">{fatal}</div>}

      <main className="body">
        <aside className="side">
          <div className="lanes">
            <LaneButton id="all" label="Inbox" count={laneCounts.all} active={laneFilter} set={setLaneFilter} />
            <LaneButton id="priority" label="Priority queue" count={laneCounts.priority} active={laneFilter} set={setLaneFilter} accent="pri" />
            <LaneButton id="human" label={`Needs human (conf < ${HUMAN_CONFIDENCE})`} count={laneCounts.human} active={laneFilter} set={setLaneFilter} accent="hum" />
            <LaneButton id="fyi" label="FYI / no reply" count={laneCounts.fyi} active={laneFilter} set={setLaneFilter} />
            <LaneButton id="spam" label="Spam" count={laneCounts.spam} active={laneFilter} set={setLaneFilter} />
            <LaneButton id="archived" label="Archived" count={laneCounts.archived} active={laneFilter} set={setLaneFilter} />
            {rulesOn && <LaneButton id="disagree" label="Rules ≠ Jev" count={laneCounts.disagree} active={laneFilter} set={setLaneFilter} accent="dis" />}
          </div>

          <div className="panel">
            <div className="panel-title">
              Priority weights <span className="hint">re-ranks instantly, no inference</span>
            </div>
            {(Object.keys(weights) as Array<keyof Weights>).map((k) => (
              <label key={k} className="slider">
                <span>{WEIGHT_LABELS[k]}</span>
                <input type="range" min={0} max={100} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
                <b>{weights[k]}</b>
              </label>
            ))}
            <button className="link" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
              reset
            </button>
          </div>

          <div className="panel">
            <label className="toggle">
              <input type="checkbox" checked={rulesOn} onChange={(e) => setRulesOn(e.target.checked)} />
              <span>Keyword rules baseline</span>
              <kbd>b</kbd>
            </label>
            {rulesOn && (
              <div className="agree">
                {agree.compared === 0 ? (
                  <div className="hint">Run triage to compare regex rules with Jev on the same {EMAILS.length} emails.</div>
                ) : (
                  <>
                    <div className="agree-big">
                      {(agree.overall * 100).toFixed(1)}% <span>agreement</span>
                    </div>
                    <div className="hint">
                      {agree.fullyAgree}/{agree.compared} emails identical on all {DIMENSIONS.length} dimensions
                    </div>
                    {DIMENSIONS.map((d) => (
                      <div key={d} className="agree-row">
                        <span>{DIM_LABEL[d]}</span>
                        <i style={{ width: `${agree.perDimension[d] * 100}%` }} />
                        <b>{(agree.perDimension[d] * 100).toFixed(0)}%</b>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="panel keys">
            <div className="panel-title">Keys</div>
            <div>
              <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>e</kbd> archive · <kbd>r</kbd> reply-needed · <kbd>b</kbd> rules · <kbd>↵</kbd> triage
            </div>
          </div>
        </aside>

        <div className="list" ref={listRef}>
          <div className="list-head">
            <span className="c-from">From</span>
            <span className="c-subj">Subject</span>
            <span className="c-badges">Judgments</span>
            <span className="c-pri">Prio</span>
            <span className="c-lat">ms</span>
            <span className="c-age">Age</span>
          </div>
          {visible.length === 0 && <div className="empty">Nothing here{phase === "idle" ? " yet — press Triage inbox" : ""}.</div>}
          {visible.map((r) => (
            <EmailRow
              key={r.email.id}
              row={r}
              selected={r.email.id === selectedId}
              onSelect={() => setSelectedId(r.email.id)}
              weights={weights}
              rulesOn={rulesOn}
              error={errors.get(r.email.id)}
              replyFlag={replyFlag.has(r.email.id)}
              archived={archived.has(r.email.id)}
            />
          ))}
        </div>

        <aside className="preview">{selected ? <Preview row={selected} rulesOn={rulesOn} weights={weights} replyFlag={replyFlag.has(selected.email.id)} error={errors.get(selected.email.id)} /> : null}</aside>
      </main>
    </div>
  );
}

function Metric({ label, value, sub, hot }: { label: string; value: string; sub?: string; hot?: boolean }) {
  return (
    <div className={`metric ${hot ? "hot" : ""}`}>
      <div className="m-label">{label}</div>
      <div className="m-value">{value}</div>
      {sub && <div className="m-sub">{sub}</div>}
    </div>
  );
}

function LaneButton({ id, label, count, active, set, accent }: { id: LaneFilter; label: string; count: number; active: LaneFilter; set: (l: LaneFilter) => void; accent?: string }) {
  return (
    <button className={`lane ${active === id ? "active" : ""} ${accent ?? ""}`} onClick={() => set(id)}>
      <span>{label}</span>
      <b>{count}</b>
    </button>
  );
}

function Badge({ kind, children, title }: { kind: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${kind}`} title={title}>
      {children}
    </span>
  );
}

function JudgmentBadges({ j, compact }: { j: Judgment; compact?: boolean }) {
  const u = Math.round(j.urgency);
  const s = Math.round(j.sentiment);
  return (
    <>
      <Badge kind={`cat cat-${j.category}`} title={`category · confidence ${j.categoryConfidence.toFixed(2)}`}>
        {CATEGORY_LABEL[j.category]}
        {j.categoryConfidence < HUMAN_CONFIDENCE && <i className="lowconf">?</i>}
      </Badge>
      <Badge kind={`urg urg-${u}`} title={`urgency ${j.urgency.toFixed(2)} / 3`}>
        {URGENCY_LEVELS[u]}
      </Badge>
      <Badge kind={`sent sent-${s}`} title={`sentiment ${j.sentiment.toFixed(2)} / 3`}>
        {SENTIMENT_LEVELS[s]}
      </Badge>
      {yes(j.isPhishingOrScam) && <Badge kind="flag phish">phishing</Badge>}
      {yes(j.mentionsChurnOrCancel) && <Badge kind="flag churn">churn</Badge>}
      {yes(j.asksForRefund) && <Badge kind="flag refund">refund</Badge>}
      {!compact && yes(j.needsReply) && <Badge kind="flag reply">reply</Badge>}
    </>
  );
}

function RuleBadges({ r }: { r: RuleVerdict }) {
  return (
    <>
      <Badge kind={`cat cat-${r.category}`}>{CATEGORY_LABEL[r.category]}</Badge>
      <Badge kind={`urg urg-${r.urgency}`}>{URGENCY_LEVELS[r.urgency]}</Badge>
      <Badge kind={`sent sent-${r.sentiment}`}>{SENTIMENT_LEVELS[r.sentiment]}</Badge>
      {r.isPhishingOrScam && <Badge kind="flag phish">phishing</Badge>}
      {r.mentionsChurnOrCancel && <Badge kind="flag churn">churn</Badge>}
      {r.asksForRefund && <Badge kind="flag refund">refund</Badge>}
      {r.needsReply && <Badge kind="flag reply">reply</Badge>}
    </>
  );
}

function EmailRow({ row, selected, onSelect, weights, rulesOn, error, replyFlag, archived }: { row: Row; selected: boolean; onSelect: () => void; weights: Weights; rulesOn: boolean; error?: string; replyFlag: boolean; archived: boolean }) {
  const { email, judgment, result } = row;
  const dis = rulesOn && row.disagree.length > 0;
  const needsReply = replyFlag || (judgment ? yes(judgment.needsReply) : false);
  return (
    <div className={`row ${selected ? "selected" : ""} ${judgment ? "judged" : ""} ${dis ? "disagree" : ""} ${archived ? "archived" : ""} ${error ? "errored" : ""}`} data-id={email.id} onClick={onSelect}>
      <span className="c-from">
        <i className={`dot ${needsReply ? "on" : ""}`} title={needsReply ? "needs reply" : ""} />
        {email.from}
      </span>
      <span className="c-subj">
        <span className="subj">{email.subject}</span>
        <span className="snip">{email.body.replace(/\s+/g, " ").slice(0, 110)}</span>
      </span>
      <span className="c-badges">
        {judgment ? <JudgmentBadges j={judgment} compact /> : error ? <Badge kind="err">error</Badge> : <span className="pending">—</span>}
        {dis && (
          <Badge kind="dis" title={`rules disagree on: ${row.disagree.map((d) => DIM_LABEL[d]).join(", ")}`}>
            ≠ {row.disagree.length}
          </Badge>
        )}
      </span>
      <span className="c-pri">{judgment ? priority(judgment, weights).toFixed(0) : ""}</span>
      <span className="c-lat">{result ? result.latencyMs.toFixed(0) : ""}</span>
      <span className="c-age">{timeAgo(email.receivedAt)}</span>
    </div>
  );
}

function Prob({ label, p }: { label: string; p: number }) {
  return (
    <div className="prob">
      <span>{label}</span>
      <i style={{ width: `${p * 100}%` }} />
      <b>{(p * 100).toFixed(0)}%</b>
    </div>
  );
}

function Preview({ row, rulesOn, weights, replyFlag, error }: { row: Row; rulesOn: boolean; weights: Weights; replyFlag: boolean; error?: string }) {
  const { email, judgment, result, rule } = row;
  const dis = new Set(row.disagree);
  return (
    <div className="pv">
      <div className="pv-head">
        <div className="pv-subject">{email.subject}</div>
        <div className="pv-from">
          <b>{email.from}</b> &lt;{email.fromEmail}&gt; · {timeAgo(email.receivedAt)} ago {email.threadId && <span className="thread">thread</span>}
        </div>
      </div>
      {email.trap && <div className="trap">Why regex fails here: {email.trap}</div>}
      <pre className="pv-body">{email.body}</pre>

      <div className="pv-judg">
        <div className="pv-title">
          Jev judgments{" "}
          {result && (
            <span className="hint">
              {result.latencyMs.toFixed(0)} ms · {result.inputTokens} tok{result.retries ? ` · ${result.retries} retries` : ""} · priority {judgment ? priority(judgment, weights).toFixed(1) : ""}
            </span>
          )}
        </div>
        {error && <div className="fatal small">{error}</div>}
        {judgment ? (
          <>
            <div className="badges">
              <JudgmentBadges j={judgment} />
              {replyFlag && <Badge kind="flag manual">marked reply (r)</Badge>}
            </div>
            <div className={`dims ${rulesOn ? "with-rules" : ""}`}>
              <Dim name="category" dis={dis.has("category")} jev={`${CATEGORY_LABEL[judgment.category]} (${(judgment.categoryConfidence * 100).toFixed(0)}% conf)`} rule={rulesOn ? CATEGORY_LABEL[rule.category] : undefined} />
              <Dim name="needs reply" dis={dis.has("needsReply")} jev={`${yes(judgment.needsReply) ? "yes" : "no"} (${(judgment.needsReply * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.needsReply ? "yes" : "no") : undefined} />
              <Dim name="urgency" dis={dis.has("urgency")} jev={`${URGENCY_LEVELS[Math.round(judgment.urgency)]} (${judgment.urgency.toFixed(2)})`} rule={rulesOn ? URGENCY_LEVELS[rule.urgency] : undefined} />
              <Dim name="sentiment" dis={dis.has("sentiment")} jev={`${SENTIMENT_LEVELS[Math.round(judgment.sentiment)]} (${judgment.sentiment.toFixed(2)})`} rule={rulesOn ? SENTIMENT_LEVELS[rule.sentiment] : undefined} />
              <Dim name="phishing" dis={dis.has("isPhishingOrScam")} jev={`${yes(judgment.isPhishingOrScam) ? "yes" : "no"} (${(judgment.isPhishingOrScam * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.isPhishingOrScam ? "yes" : "no") : undefined} />
              <Dim name="churn / cancel" dis={dis.has("mentionsChurnOrCancel")} jev={`${yes(judgment.mentionsChurnOrCancel) ? "yes" : "no"} (${(judgment.mentionsChurnOrCancel * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.mentionsChurnOrCancel ? "yes" : "no") : undefined} />
              <Dim name="asks refund" dis={dis.has("asksForRefund")} jev={`${yes(judgment.asksForRefund) ? "yes" : "no"} (${(judgment.asksForRefund * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.asksForRefund ? "yes" : "no") : undefined} />
            </div>
            <div className="pv-title">Category distribution</div>
            <div className="probs">
              {Object.entries(judgment.categoryProbabilities)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([k, p]) => (
                  <Prob key={k} label={CATEGORY_LABEL[k as Category] ?? k} p={p} />
                ))}
            </div>
          </>
        ) : (
          <div className="hint">Not judged yet.</div>
        )}
        {rulesOn && (
          <>
            <div className="pv-title">Keyword rules said</div>
            <div className="badges">
              <RuleBadges r={rule} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Dim({ name, jev, rule, dis }: { name: string; jev: string; rule?: string; dis: boolean }) {
  return (
    <div className={`dim ${rule !== undefined && dis ? "dis" : ""}`}>
      <span className="d-name">{name}</span>
      <span className="d-jev">{jev}</span>
      {rule !== undefined && <span className="d-rule">{rule}</span>}
    </div>
  );
}
