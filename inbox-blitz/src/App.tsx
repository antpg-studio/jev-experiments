import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EMAILS } from "./data/emails";
import type { Category, Email, Judgment, JudgmentResult } from "./lib/types";
import { SENTIMENT_LEVELS, URGENCY_LEVELS } from "./lib/types";
import { DEFAULT_WEIGHTS, HUMAN_CONFIDENCE, lane, priority, rank, type Lane } from "./lib/priority";
import { fmtMs, QUESTIONS_PER_EMAIL } from "./lib/stats";
import { agreement, classifyRules, DIMENSIONS, disagreements, type Dimension, type RuleVerdict } from "./lib/rules";
import { useTriage } from "./useTriage";
import { useLabels } from "./useLabels";
import { intersect, pending, isMatch, sortByMatch, summarize, SUGGESTED_INTENTS, SURE_THRESHOLD, type IntentLabel } from "./lib/labels";

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
  const [laneFilter, setLaneFilter] = useState<LaneFilter>("all");
  const [rulesOn, setRulesOn] = useState(false);
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [replyFlag, setReplyFlag] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>(EMAILS[0].id);
  const [health, setHealth] = useState<{ hasKey: boolean; mock: boolean; model: string } | null>(null);
  const [rerankTick, setRerankTick] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const labels = useLabels(EMAILS.length);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const filterLabels = useMemo(() => labelFilter.map((id) => labels.labels.find((l) => l.id === id)).filter((l): l is IntentLabel => Boolean(l)), [labelFilter, labels.labels]);
  const filterDone = filterLabels.length > 0 && filterLabels.every((l) => l.phase === "done");

  const submitIntent = (text: string) => {
    const label = labels.add(text, concurrency);
    if (!label) return;
    setQuery("");
    setSearchOpen(false);
    searchRef.current?.blur();
    setLaneFilter("all");
    setLabelFilter([label.id]);
  };
  const toggleLabelFilter = (id: string) => {
    setLaneFilter("all");
    setLabelFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const removeLabel = (id: string) => {
    labels.remove(id);
    setLabelFilter((prev) => prev.filter((x) => x !== id));
  };
  const pickLane = (l: LaneFilter) => {
    setLaneFilter(l);
    setLabelFilter([]);
  };

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

  const sorted = useMemo(() => (phase === "done" ? rank(rows, DEFAULT_WEIGHTS) : rows), [rows, phase]);

  const done = phase === "done";
  useEffect(() => {
    if (!done) return;
    setRerankTick((t) => t + 1);
    setBanner(`Inbox sorted by priority · ${fmtMs(stats.elapsedMs)}`);
    const id = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(id);
    // Only fire on completion; stats are read once at that moment.
  }, [done]);

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

  const visible = useMemo(() => {
    const inLane = sorted.filter((r) => {
      const isArchived = archived.has(r.email.id);
      if (laneFilter === "archived") return isArchived;
      if (isArchived) return false;
      if (laneFilter === "all") return true;
      if (laneFilter === "disagree") return r.disagree.length > 0;
      return r.judgment ? lane(r.judgment) === laneFilter : false;
    });
    if (filterLabels.length === 0) return inLane;
    const ids = inLane.map((r) => r.email.id);
    // While Jev is still answering, rows fall out of the list as they are ruled out; once every label is done, best matches float to the top.
    const keep = new Set(filterDone ? intersect(ids, filterLabels) : pending(ids, filterLabels));
    const matched = inLane.filter((r) => keep.has(r.email.id));
    return filterDone ? sortByMatch(matched.map((r) => ({ id: r.email.id, r })), filterLabels).map((x) => x.r) : matched;
  }, [sorted, laneFilter, archived, filterLabels, filterDone]);

  // Every re-rank (triage or label run completing) jumps to the new top of the queue.
  useEffect(() => {
    if (rerankTick === 0) return;
    if (visible[0]) setSelectedId(visible[0].email.id);
    listRef.current?.scrollTo({ top: 0 });
  }, [rerankTick]);

  // A label run finishing re-sorts the filtered view by match probability.
  useEffect(() => {
    if (!filterDone) return;
    setRerankTick((t) => t + 1);
    const last = filterLabels[filterLabels.length - 1];
    const s = summarize(last.matches.values());
    setBanner(`“${last.name}” · ${s.matched} of ${s.judged} emails · ${fmtMs(last.stats.elapsedMs)}`);
    const id = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(id);
  }, [filterDone]);

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
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, archive, toggleReply]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId, visible]);

  const isMock = meta?.mock ?? health?.mock ?? false;
  const modelLabel = meta?.model ?? health?.model ?? "typesafe/jev-1.13";
  const running = phase === "running";
  const triaged = phase !== "idle";

  // The HUD follows whatever is (or was last) executing: a label run, else the triage run.
  const hudLabel = labels.active ?? (!running && filterLabels.length ? filterLabels[filterLabels.length - 1] : null);
  const hudStats = hudLabel ? hudLabel.stats : stats;
  const hudRunning = hudLabel ? hudLabel.phase === "running" : running;
  const pct = (hudStats.processed / Math.max(1, hudStats.total)) * 100;
  const activeSummary = labels.active ? summarize(labels.active.matches.values()) : null;
  const suggestions = SUGGESTED_INTENTS.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);

  return (
    <div className={`app ${isMock ? "mock" : ""}`}>
      <header className="topbar">
        <div className="tb-left">
          <button className="ib" aria-label="Main menu">
            <Icon d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
          </button>
          <a className="brand" href="./">
            <Logo />
            <span className="wordmark">Sift</span>
          </a>
        </div>
        <div className="tb-mid">
          <div className={`search ${searchOpen ? "open" : ""}`}>
            <button className="ib" aria-label="Search" onClick={() => submitIntent(query)}>
              <Icon d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </button>
            {filterLabels.map((l) => (
              <span key={l.id} className="chip" style={{ background: l.color }}>
                {l.name}
                <button aria-label={`Remove filter ${l.name}`} onClick={() => toggleLabelFilter(l.id)}>
                  ×
                </button>
              </span>
            ))}
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={filterLabels.length ? "Add another intent…" : "Describe what to find — e.g. “customers threatening to cancel”"}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitIntent(query);
                if (e.key === "Escape") searchRef.current?.blur();
              }}
              disabled={isMock}
              title={isMock ? "Natural-language labels need live inference (MOCK=1 is on)" : undefined}
            />
            <span className="search-hint">
              <kbd>/</kbd>
            </span>
            {searchOpen && (
              <div className="intent-menu">
                <div className="im-head">
                  <Sparkle />
                  <span>
                    Label by intent · Jev judges all {EMAILS.length} emails <b>≈ 1 question each</b>
                  </span>
                </div>
                {query.trim() && (
                  <button className="im-item primary" onMouseDown={(e) => e.preventDefault()} onClick={() => submitIntent(query)}>
                    <Sparkle />
                    <span>
                      Label emails that are <b>“{query.trim()}”</b>
                    </span>
                    <kbd>↵</kbd>
                  </button>
                )}
                {suggestions.map((s) => (
                  <button key={s} className="im-item" onMouseDown={(e) => e.preventDefault()} onClick={() => submitIntent(s)}>
                    <Icon d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                    <span>{s}</span>
                  </button>
                ))}
              </div>
            )}
            {labels.active && activeSummary && (
              <div className="intent-run">
                <div className="ir-head">
                  <Sparkle spin />
                  <span>
                    Labeling <b>“{labels.active.intent}”</b>
                  </span>
                  <button className="ib sm" aria-label="Stop" onClick={() => labels.stop(labels.active!.id)}>
                    <Icon d="M6 6h12v12H6z" />
                  </button>
                </div>
                <div className="ir-bar">
                  <i style={{ width: `${pct}%`, background: labels.active.color }} />
                </div>
                <div className="ir-stats">
                  <span>
                    <b>{activeSummary.matched}</b> {activeSummary.matched === 1 ? "match" : "matches"}
                  </span>
                  <span>
                    {labels.active.stats.processed} of {labels.active.stats.total}
                  </span>
                  <span>{fmtMs(labels.active.stats.elapsedMs)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="tb-right">
          <span className={`mode ${isMock ? "mode-mock" : "mode-live"}`} title={isMock ? "Replaying recorded answers — no live inference" : "Live TypeSafe inference"}>
            {isMock ? "Mock replay" : "Live"} · {modelLabel}
          </span>
          {health && !health.hasKey && !health.mock && <span className="warn">OPENROUTER_API_KEY not set on server</span>}
          <label className="conc" title="Parallel requests in flight">
            <Icon d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            <select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} disabled={running}>
              {[4, 8, 12, 16, 24, 32].map((n) => (
                <option key={n} value={n}>
                  {n} parallel
                </option>
              ))}
            </select>
          </label>
          <button className="ib" aria-label="Google apps">
            <Icon d="M6 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6 12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6-4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-6 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6 4c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
          </button>
          <span className="avatar">N</span>
        </div>
      </header>

      {fatal && <div className="fatal">{fatal}</div>}
      {banner && <div className="banner">{banner}</div>}

      <main className="body">
        <nav className="nav">
          <div className="nav-list">
            <NavItem id="all" label="Inbox" count={laneCounts.all} active={labelFilter.length ? null : laneFilter} set={pickLane} icon="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4v-6h3.56c.69 1.19 1.97 2 3.45 2h1.98c1.48 0 2.75-.81 3.45-2H20v6zm0-8h-5.99c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2H4V6h16v4z" />
            {triaged && (
              <>
                <NavItem id="priority" label="Priority" count={laneCounts.priority} active={laneFilter} set={pickLane} icon="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                <NavItem id="human" label="Needs review" count={laneCounts.human} active={laneFilter} set={pickLane} icon="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                <NavItem id="fyi" label="FYI" count={laneCounts.fyi} active={laneFilter} set={pickLane} icon="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z" />
                <NavItem id="spam" label="Spam" count={laneCounts.spam} active={laneFilter} set={pickLane} icon="M15.73 3H8.27L3 8.27v7.46L8.27 21h7.46L21 15.73V8.27L15.73 3zM12 17.3c-.72 0-1.3-.58-1.3-1.3 0-.72.58-1.3 1.3-1.3.72 0 1.3.58 1.3 1.3 0 .72-.58 1.3-1.3 1.3zm1-4.3h-2V7h2v6z" />
              </>
            )}
            <NavItem id="archived" label="Archived" count={laneCounts.archived} active={laneFilter} set={pickLane} icon="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z" />
            {rulesOn && <NavItem id="disagree" label="Rules ≠ Sift" count={laneCounts.disagree} active={laneFilter} set={pickLane} icon="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />}
          </div>

          <div className="nav-section intents">
            <div className="nav-h">
              <span>Labels</span>
              <button className="ib sm" title="New label from an intent" onClick={() => searchRef.current?.focus()}>
                <Icon d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </button>
            </div>
            {labels.labels.length === 0 && <div className="nav-hint">Type an intent in the search bar — Jev labels every email that fits.</div>}
            {labels.labels.map((l) => {
              const s = summarize(l.matches.values());
              return (
                <div key={l.id} className={`nav-item label ${labelFilter.includes(l.id) ? "active" : ""} ${l.phase}`} onClick={() => toggleLabelFilter(l.id)} title={`${l.intent}\n${s.matched} match · ${s.judged} judged · ${fmtMs(l.stats.elapsedMs)}`}>
                  <span className="dot" style={{ background: l.color }} />
                  <span className="lbl">{l.name}</span>
                  {l.phase === "running" && <span className="spin" style={{ borderTopColor: l.color }} />}
                  {l.phase === "error" && <span className="err-dot" title={l.fatal}>!</span>}
                  <b>{s.matched}</b>
                  <button
                    className="x"
                    aria-label={`Delete label ${l.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLabel(l.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          {triaged && (
          <div className="nav-section">
            <label className="nav-item toggle">
              <input type="checkbox" checked={rulesOn} onChange={(e) => setRulesOn(e.target.checked)} />
              <span className="lbl">Keyword rules</span>
              <kbd>b</kbd>
            </label>
            {rulesOn && (
              <div className="agree">
                {agree.compared === 0 ? (
                  <div className="nav-hint">Run triage to compare regex rules with Sift on the same {EMAILS.length} emails.</div>
                ) : (
                  <>
                    <div className="agree-big">
                      {(agree.overall * 100).toFixed(1)}% <span>agreement</span>
                    </div>
                    <div className="nav-hint">
                      {agree.fullyAgree}/{agree.compared} identical on all {DIMENSIONS.length} dimensions
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
          )}
        </nav>

        <section className="card">
          <div className="toolbar">
            <div className="tb-l">
              <span className="cb" />
              <button className="ib" aria-label="Refresh">
                <Icon d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </button>
              <details className="more" ref={moreRef}>
                <summary className="ib" aria-label="More">
                  <Icon d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                </summary>
                <div className="menu" onClick={() => moreRef.current?.removeAttribute("open")}>
                  {running ? (
                    <button onClick={triage.stop}>Stop triage</button>
                  ) : (
                    <button onClick={() => void triage.start(concurrency)} title={`${EMAILS.length} emails · ${QUESTIONS_PER_EMAIL} judgments each`}>
                      {phase === "idle" ? "Triage inbox" : "Re-triage inbox"}
                    </button>
                  )}
                </div>
              </details>
            </div>
            <div className="tb-r">
              <span className="count">
                1–{Math.min(50, visible.length)} of {visible.length.toLocaleString()}
              </span>
              <button className="ib" aria-label="Newer" disabled>
                <Icon d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </button>
              <button className="ib" aria-label="Older">
                <Icon d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </button>
            </div>
            {hudRunning && <div className="loading" style={{ width: `${pct}%`, background: hudLabel?.color }} />}
          </div>

          {(hudLabel || phase !== "idle") && (
            <div className={`hud ${hudRunning ? "live" : ""}`}>
              {hudLabel ? <span className="dot" style={{ background: hudLabel.color }} /> : <Sparkle spin={hudRunning} />}
              <span className="ht-name">{hudLabel ? hudLabel.name : hudRunning ? "Triaging" : "Triaged"}</span>
              {hudLabel && (
                <span>
                  {summarize(hudLabel.matches.values()).matched} {summarize(hudLabel.matches.values()).matched === 1 ? "match" : "matches"}
                </span>
              )}
              <span>{hudRunning ? `${hudStats.processed} of ${hudStats.total}` : `${hudStats.processed} emails`}</span>
              <span>{fmtMs(hudStats.elapsedMs)}</span>
              {hudStats.errors > 0 && <span className="err-dot">{hudStats.errors} failed</span>}
            </div>
          )}

          <div className="list" ref={listRef}>
            {visible.length === 0 && (
              <div className="empty">
                {filterLabels.length ? (filterDone ? `No emails match ${filterLabels.map((l) => `“${l.name}”`).join(" and ")}.` : "Sifting…") : `Nothing here${phase === "idle" ? " yet — press Triage" : ""}.`}
              </div>
            )}
            {visible.map((r, i) => (
              <EmailRow
                key={`${rerankTick}:${r.email.id}`}
                index={i}
                row={r}
                selected={r.email.id === selectedId}
                onSelect={() => setSelectedId(r.email.id)}
                rulesOn={rulesOn}
                error={errors.get(r.email.id)}
                replyFlag={replyFlag.has(r.email.id)}
                archived={archived.has(r.email.id)}
                labels={labels.labels}
                filterLabels={filterLabels}
              />
            ))}
          </div>
        </section>

        <section className="reader">{selected ? <Preview row={selected} rulesOn={rulesOn} replyFlag={replyFlag.has(selected.email.id)} error={errors.get(selected.email.id)} labels={labels.labels} /> : null}</section>

        <aside className="rail">
          <span className="rail-ic" style={{ background: "#1a73e8" }}>
            <Icon d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
          </span>
          <span className="rail-ic" style={{ background: "#fbbc04" }}>
            <Icon d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
          </span>
          <span className="rail-ic" style={{ background: "#1e8e3e" }}>
            <Icon d="M22 5.18 10.59 16.6l-4.24-4.24 1.41-1.41 2.83 2.83 10-10L22 5.18z" />
          </span>
          <span className="rail-ic" style={{ background: "#1a73e8" }}>
            <Icon d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </span>
          <span className="rail-sep" />
          <span className="rail-ic plus">
            <Icon d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
          </span>
        </aside>
      </main>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
      <path d="M6 9h28l-11 12v9l-6 3V21L6 9z" fill="#0b57d0" />
      <path d="M6 9h28l-3 3H9z" fill="#4285f4" />
    </svg>
  );
}

function Sparkle({ spin }: { spin?: boolean }) {
  return (
    <svg className={`sparkle ${spin ? "spin" : ""}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15z" fill="currentColor" />
    </svg>
  );
}

function LabelChips({ id, labels, filterLabels }: { id: string; labels: IntentLabel[]; filterLabels: IntentLabel[] }) {
  return (
    <>
      {labels.map((l) => {
        const m = l.matches.get(id);
        if (!isMatch(m)) return null;
        const filtered = filterLabels.includes(l);
        return (
          <span key={l.id} className={`badge user ${m!.match < SURE_THRESHOLD ? "soft" : ""}`} style={{ background: l.color }} title={`${l.intent} · ${(m!.match * 100).toFixed(0)}%`}>
            {l.name}
            {filtered && <em>{(m!.match * 100).toFixed(0)}%</em>}
          </span>
        );
      })}
    </>
  );
}

function NavItem({ id, label, count, active, set, icon }: { id: LaneFilter; label: string; count: number; active: LaneFilter | null; set: (l: LaneFilter) => void; icon: string }) {
  return (
    <button className={`nav-item ${active === id ? "active" : ""}`} onClick={() => set(id)}>
      <Icon d={icon} />
      <span className="lbl">{label}</span>
      <b>{count ? count.toLocaleString() : ""}</b>
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
      {(s >= 2 || !compact) && (
        <Badge kind={`sent sent-${s}`} title={`sentiment ${j.sentiment.toFixed(2)} / 3`}>
          {SENTIMENT_LEVELS[s]}
        </Badge>
      )}
      {yes(j.isPhishingOrScam) && <Badge kind="flag phish">Phishing</Badge>}
      {yes(j.mentionsChurnOrCancel) && <Badge kind="flag churn">Churn</Badge>}
      {yes(j.asksForRefund) && <Badge kind="flag refund">Refund</Badge>}
      {!compact && yes(j.needsReply) && <Badge kind="flag reply">Reply</Badge>}
    </>
  );
}

function RuleBadges({ r }: { r: RuleVerdict }) {
  return (
    <>
      <Badge kind={`cat cat-${r.category}`}>{CATEGORY_LABEL[r.category]}</Badge>
      <Badge kind={`urg urg-${r.urgency}`}>{URGENCY_LEVELS[r.urgency]}</Badge>
      <Badge kind={`sent sent-${r.sentiment}`}>{SENTIMENT_LEVELS[r.sentiment]}</Badge>
      {r.isPhishingOrScam && <Badge kind="flag phish">Phishing</Badge>}
      {r.mentionsChurnOrCancel && <Badge kind="flag churn">Churn</Badge>}
      {r.asksForRefund && <Badge kind="flag refund">Refund</Badge>}
      {r.needsReply && <Badge kind="flag reply">Reply</Badge>}
    </>
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function EmailRow({ row, index, selected, onSelect, rulesOn, error, replyFlag, archived, labels, filterLabels }: { row: Row; index: number; selected: boolean; onSelect: () => void; rulesOn: boolean; error?: string; replyFlag: boolean; archived: boolean; labels: IntentLabel[]; filterLabels: IntentLabel[] }) {
  const { email, judgment } = row;
  const dis = rulesOn && row.disagree.length > 0;
  const needsReply = replyFlag || (judgment ? yes(judgment.needsReply) : false);
  const unread = !judgment || needsReply;
  const style = index < 40 ? { animationDelay: `${index * 18}ms` } : undefined;
  const snippet = email.body.replace(/\s+/g, " ").slice(0, 140);
  return (
    <div className={`row ${selected ? "selected" : ""} ${judgment ? "judged" : ""} ${dis ? "disagree" : ""} ${archived ? "archived" : ""} ${error ? "errored" : ""} ${unread ? "unread" : ""}`} data-id={email.id} onClick={onSelect} style={style}>
      <span className="cb" />
      <span className={`star ${judgment && priority(judgment, DEFAULT_WEIGHTS) >= 90 ? "on" : ""}`}>
        <Icon d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
      </span>
      <span className="from">{email.from}</span>
      <span className="text">
        <span className="labels">
          <LabelChips id={email.id} labels={labels} filterLabels={filterLabels} />
          {judgment ? <JudgmentBadges j={judgment} compact /> : error ? <Badge kind="err">error</Badge> : null}
          {dis && (
            <Badge kind="dis" title={`rules disagree on: ${row.disagree.map((d) => DIM_LABEL[d]).join(", ")}`}>
              ≠ rules
            </Badge>
          )}
        </span>
        <span className="subj">{email.subject}</span>
        <span className="snip"> - {snippet}</span>
      </span>
      <span className="date">{clock(email.receivedAt)}</span>
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

function Preview({ row, rulesOn, replyFlag, error, labels }: { row: Row; rulesOn: boolean; replyFlag: boolean; error?: string; labels: IntentLabel[] }) {
  const { email, judgment, rule } = row;
  const dis = new Set(row.disagree);
  const judgedLabels = labels.filter((l) => l.matches.has(email.id));
  return (
    <div className="pv">
      <div className="pv-subject">
        <h2>{email.subject}</h2>
        {judgment && (
          <span className="pv-labels">
            <Badge kind={`cat cat-${judgment.category}`}>{CATEGORY_LABEL[judgment.category]}</Badge>
            <Badge kind="inbox">Inbox</Badge>
          </span>
        )}
      </div>
      <div className="pv-head">
        <span className="pv-avatar" style={{ background: avatarColor(email.from) }}>
          {email.from[0]}
        </span>
        <div className="pv-who">
          <div>
            <b>{email.from}</b> <span className="pv-addr">&lt;{email.fromEmail}&gt;</span>
          </div>
          <div className="pv-to">to me {email.threadId && <span className="thread">· thread</span>}</div>
        </div>
        <div className="pv-when">{timeAgo(email.receivedAt)} ago</div>
      </div>
      {email.trap && <div className="trap">Why keyword rules fail here: {email.trap}</div>}
      <pre className="pv-body">{email.body}</pre>

      {judgedLabels.length > 0 && (
        <div className="pv-judg">
          <div className="pv-title">Intent labels</div>
          <div className="probs">
            {judgedLabels.map((l) => {
              const m = l.matches.get(email.id)!;
              return (
                <div key={l.id} className={`prob user ${isMatch(m) ? "on" : ""}`}>
                  <span>
                    <span className="dot" style={{ background: l.color }} />
                    {l.name}
                  </span>
                  <i style={{ width: `${m.match * 100}%`, background: l.color }} />
                  <b>{(m.match * 100).toFixed(0)}%</b>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pv-judg">
        <div className="pv-title">
          Sift judgments
        </div>
        {error && <div className="fatal small">{error}</div>}
        {judgment ? (
          <>
            <div className="badges">
              <JudgmentBadges j={judgment} />
              {replyFlag && <Badge kind="flag manual">marked reply (r)</Badge>}
            </div>
            <div className={`dims ${rulesOn ? "with-rules" : ""}`}>
              {rulesOn && (
                <div className="dim head">
                  <span className="d-name" />
                  <span className="d-jev">Sift</span>
                  <span className="d-rule">Rules</span>
                </div>
              )}
              <Dim name="Category" dis={dis.has("category")} jev={`${CATEGORY_LABEL[judgment.category]} (${(judgment.categoryConfidence * 100).toFixed(0)}%)`} rule={rulesOn ? CATEGORY_LABEL[rule.category] : undefined} />
              <Dim name="Needs reply" dis={dis.has("needsReply")} jev={`${yes(judgment.needsReply) ? "Yes" : "No"} (${(judgment.needsReply * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.needsReply ? "Yes" : "No") : undefined} />
              <Dim name="Urgency" dis={dis.has("urgency")} jev={`${URGENCY_LEVELS[Math.round(judgment.urgency)]} (${judgment.urgency.toFixed(2)})`} rule={rulesOn ? URGENCY_LEVELS[rule.urgency] : undefined} />
              <Dim name="Sentiment" dis={dis.has("sentiment")} jev={`${SENTIMENT_LEVELS[Math.round(judgment.sentiment)]} (${judgment.sentiment.toFixed(2)})`} rule={rulesOn ? SENTIMENT_LEVELS[rule.sentiment] : undefined} />
              <Dim name="Phishing" dis={dis.has("isPhishingOrScam")} jev={`${yes(judgment.isPhishingOrScam) ? "Yes" : "No"} (${(judgment.isPhishingOrScam * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.isPhishingOrScam ? "Yes" : "No") : undefined} />
              <Dim name="Churn / cancel" dis={dis.has("mentionsChurnOrCancel")} jev={`${yes(judgment.mentionsChurnOrCancel) ? "Yes" : "No"} (${(judgment.mentionsChurnOrCancel * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.mentionsChurnOrCancel ? "Yes" : "No") : undefined} />
              <Dim name="Asks refund" dis={dis.has("asksForRefund")} jev={`${yes(judgment.asksForRefund) ? "Yes" : "No"} (${(judgment.asksForRefund * 100).toFixed(0)}%)`} rule={rulesOn ? (rule.asksForRefund ? "Yes" : "No") : undefined} />
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

const AVATAR_COLORS = ["#1a73e8", "#d93025", "#188038", "#e37400", "#9334e6", "#007b83", "#c5221f", "#3c4043"];
function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
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
