import { useEffect, useRef, useState } from "react";
import type { Decided } from "../App.tsx";

const SHOW = 160;

const BADGE: Record<string, string> = {
  hide: "hidden",
  timeout_user: "timeout",
  care: "care",
  review: "review",
};

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};

export function ChatPane({ items }: { items: Decided[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const visible = items.slice(-SHOW);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [visible.length, items[items.length - 1]?.msg.id, pinned]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <section className="chat">
      <header>
        <h2>Stream chat</h2>
        <span className="sub">as viewers see it · hidden messages greyed for the moderator · {items.length} in policy window</span>
        {!pinned && (
          <button className="btn tiny" onClick={() => setPinned(true)}>
            ↓ jump to live
          </button>
        )}
      </header>
      <div className="chat-scroll" ref={ref} onScroll={onScroll}>
        {visible.length === 0 && (
          <div className="empty">
            Press <b>▶ Go live</b>. Every message is held, sent to Jev once (7 questions in one request), and released here with its measured hold time.
          </div>
        )}
        {visible.map((d) => {
          const blocked = d.decision === "hide" || d.decision === "timeout_user" || d.decision === "care";
          const j = d.msg.judgment;
          const title = j
            ? `jev action: ${j.action} (${j.actionConfidence.toFixed(2)}) · harassment ${j.harassment.toFixed(2)} · scam ${j.scam_or_phishing.toFixed(2)} · self-harm ${j.self_harm_risk.toFixed(2)} · spam ${j.spam.toFixed(2)} · obfuscated ${j.is_obfuscated_slur_or_evasion.toFixed(2)} · severity ${j.severity.toFixed(2)}/3 · queued ${Math.round(d.msg.timing.queuedMs)} ms · jev ${Math.round(d.msg.timing.jevMs)} ms${d.msg.timing.retries ? ` · ${d.msg.timing.retries} retries` : ""}\nfixture label: ${d.msg.truth}`
            : `error: ${d.msg.error}`;
          return (
            <div key={d.msg.id} className={`row ${d.decision} ${blocked ? "blocked" : ""} ${d.msg.raid ? "raid" : ""}`} title={title}>
              <span className="time">{fmtTime(d.msg.ts)}</span>
              <span className={`held ${d.msg.timing.heldMs > 600 ? "slow" : ""}`}>held {Math.round(d.msg.timing.heldMs)} ms</span>
              <span className="user" style={{ color: d.msg.color }}>
                {d.msg.user}
              </span>
              <span className="text">{d.msg.text}</span>
              {d.decision !== "allow" && (
                <span className={`badge ${d.decision}`}>
                  {BADGE[d.decision]} · {d.reason}
                </span>
              )}
              {d.wordList && d.decision === "allow" && (
                <span className="badge wl" title={`A word-list filter would have blocked this for "${d.wordList}"`}>
                  word list ✕ "{d.wordList}"
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
