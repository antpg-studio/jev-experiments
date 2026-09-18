import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Decided } from "../App.tsx";
import { Icon } from "./Icon.tsx";

const SHOW = 160;

const BADGE: Record<string, string> = {
  hide: "Hidden",
  timeout_user: "Timed out",
  care: "Care",
  review: "In review",
};

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

export function ChatPane({ items }: { items: Decided[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [filter, setFilter] = useState<"all" | "interventions">("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items.filter((d) =>
      (filter === "all" || d.decision !== "allow") &&
      (!search || `${d.msg.user} ${d.msg.text}`.toLowerCase().includes(search)),
    ).slice(-SHOW);
  }, [items, filter, query]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [visible, pinned]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pinned) return;
    const observer = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pinned]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <section className="chat" aria-label="Live chat">
      <header>
        <div className="panel-title"><Icon name="chat" /><h2>Live chat</h2><span className="view-label">Moderator view</span></div>
        <label className="chat-search"><Icon name="search" /><input type="search" aria-label="Search messages or participants" placeholder="Search chat…" value={query} onChange={(e) => { setQuery(e.target.value); setPinned(true); }} /></label>
      </header>
      <div className="chat-filterbar">
        <div className="segmented" role="group" aria-label="Filter chat">
          <button aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPinned(true); }}>All messages</button>
          <button aria-pressed={filter === "interventions"} onClick={() => { setFilter("interventions"); setPinned(true); }}>Interventions</button>
        </div>
        <span className="prepublish-note"><Icon name="shield" /> Checked before publishing</span>
      </div>
      <div className="chat-scroll" ref={ref} onScroll={onScroll}>
        {visible.length === 0 && (
          <div className="empty">
            <div className="empty-symbol"><Icon name={query ? "search" : "chat"} /></div>
            <strong>{query ? "No matching messages" : filter === "interventions" ? "No interventions yet" : "Ready when your community is."}</strong>
            <p>{query ? "Try a different phrase or participant name." : filter === "interventions" ? "Messages needing attention will appear here." : "Go live to see messages reviewed and released in real time."}</p>
          </div>
        )}
        {visible.map((d) => {
          const blocked = d.decision === "hide" || d.decision === "timeout_user" || d.decision === "care";
          const j = d.msg.judgment;
          const title = j
            ? `jev action: ${j.action} (${j.actionConfidence.toFixed(2)}) · harassment ${j.harassment.toFixed(2)} · scam ${j.scam_or_phishing.toFixed(2)} · self-harm ${j.self_harm_risk.toFixed(2)} · spam ${j.spam.toFixed(2)} · obfuscated ${j.is_obfuscated_slur_or_evasion.toFixed(2)} · severity ${j.severity.toFixed(2)}/3 · queued ${Math.round(d.msg.timing.queuedMs)} ms · jev ${Math.round(d.msg.timing.jevMs)} ms${d.msg.timing.retries ? ` · ${d.msg.timing.retries} retries` : ""}\nfixture label: ${d.msg.truth}`
            : `error: ${d.msg.error}`;
          return (
            <div key={d.msg.id} className={`row ${d.decision} ${blocked ? "blocked" : ""} ${d.msg.raid ? "raid" : ""}`} title={`${d.msg.text}\n${title}`}>
              <span className="avatar" data-tone={d.msg.user.charCodeAt(0) % 4} aria-hidden="true">{d.msg.user.slice(0, 2).toUpperCase()}</span>
              <div className="message-content">
                <div className="message-heading"><span className="user">{d.msg.user}</span><span className="time">{fmtTime(d.msg.ts)}</span>{d.msg.raid && <span className="raid-label">Raid</span>}</div>
                <span className="text">{d.msg.text}</span>
                {d.wordList && d.decision === "allow" && <span className="keyword-hit">A keyword filter would have blocked this</span>}
              </div>
              <span className="decision-cell">
                <span className={`badge ${d.decision}`} title={d.reason}>{d.decision === "allow" && <Icon name="check" />}{d.decision === "allow" ? "Released" : BADGE[d.decision]}</span>
                <span className={`held ${d.msg.timing.heldMs > 600 ? "slow" : ""}`}>held {Math.round(d.msg.timing.heldMs)} ms</span>
              </span>
            </div>
          );
        })}
      </div>
      <footer className="chat-footer"><span>Showing {visible.length} messages <span className="footer-separator">·</span> {items.length} in policy window</span>{pinned ? <span className="following"><span className="status-dot" /> Following live</span> : <button className="text-button" onClick={() => setPinned(true)}>Resume live <Icon name="arrow" /></button>}</footer>
    </section>
  );
}
