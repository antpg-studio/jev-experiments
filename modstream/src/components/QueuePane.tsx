import { useState } from "react";
import type { Decided, Override } from "../App.tsx";
import { Icon } from "./Icon.tsx";

interface Props {
  review: Decided[];
  care: Decided[];
  careReply: string;
  onOverride: (id: number, ov: Override) => void;
}

function Probs({ d }: { d: Decided }) {
  const j = d.msg.judgment;
  if (!j) return <div className="probs err">no judgment: {d.msg.error}</div>;
  const bars: Array<[string, number]> = [
    ["Harassment", j.harassment],
    ["Scam", j.scam_or_phishing],
    ["Self-harm", j.self_harm_risk],
    ["Spam", j.spam],
    ["Evasion", j.is_obfuscated_slur_or_evasion],
    ["Severity", j.severity / 3],
  ];
  return (
    <details className="judgment-details">
      <summary>Action confidence <b>{Math.round(j.actionConfidence * 100)}%</b><span>View judgment</span></summary>
      <div className="probs">
        {bars.map(([k, v]) => <div key={k} className="prob"><span>{k}</span><div className="prob-track"><i style={{ width: `${Math.round(v * 100)}%` }} /></div><span>{Math.round(v * 100)}%</span></div>)}
        <span className="jev-choice">Jev action: <b>{j.action}</b></span>
      </div>
    </details>
  );
}

export function QueuePane({ review, care, careReply, onOverride }: Props) {
  const [tab, setTab] = useState<"review" | "care">("review");

  return (
    <aside className="queues" aria-label="Moderation inbox">
      <header className="inbox-heading"><div><h2>Moderation inbox</h2><p>Messages that need your attention.</p></div><span className="inbox-total">{review.length + care.length}</span></header>
      <div className="inbox-tabs segmented" role="group" aria-label="Select moderation queue">
        <button aria-pressed={tab === "review"} onClick={() => setTab("review")}><Icon name="people" /> Human review <span className="count">{review.length}</span></button>
        <button aria-pressed={tab === "care"} onClick={() => setTab("care")}><Icon name="heart" /> Care <span className="count">{care.length}</span></button>
      </div>
      <section className="queue review-q" hidden={tab !== "review"} aria-label="Human review">
        <div className="queue-scroll">
          {review.length === 0 && <div className="empty"><div className="empty-symbol"><Icon name="check" /></div><strong>You're all caught up</strong><p>When a message needs a second look, you'll find it here.</p></div>}
          {review.map((d) => (
            <article key={d.msg.id} className="qitem">
              <div className="qhead">
                <span className="avatar" aria-hidden="true">{d.msg.user.slice(0, 2).toUpperCase()}</span>
                <div><span className="user">{d.msg.user}</span><span className="reason" title={d.reason}>Waiting for your decision</span></div>
                <span className="message-id">#{d.msg.id}</span>
              </div>
              <p className="qtext">{d.msg.text}</p>
              <div className="qactions">
                <button className="btn ok" onClick={() => onOverride(d.msg.id, "allow")}>
                  <Icon name="check" /> Approve
                </button>
                <button className="btn bad" onClick={() => onOverride(d.msg.id, "hide")}>
                  <Icon name="close" /> Reject
                </button>
                <span className="truth" title={`Fixture label: ${d.msg.truth}`}>{d.msg.truth.replaceAll("_", " ")}</span>
              </div>
              <Probs d={d} />
            </article>
          ))}
        </div>
      </section>

      <section className="queue care-q" hidden={tab !== "care"} aria-label="Care queue">
        <div className="queue-scroll">
          {care.length === 0 && <div className="empty"><div className="empty-symbol"><Icon name="heart" /></div><strong>No one waiting for support</strong><p>Self-harm concerns are routed here for care, never an automatic ban.</p></div>}
          {care.map((d) => (
            <article key={d.msg.id} className="qitem care">
              <div className="qhead">
                <span className="avatar" aria-hidden="true">{d.msg.user.slice(0, 2).toUpperCase()}</span>
                <div><span className="user">{d.msg.user}</span><span className="reason">Routed for support</span></div>
                <span className="message-id">#{d.msg.id}</span>
              </div>
              <p className="qtext">{d.msg.text}</p>
              <div className="auto-reply">
                <b><Icon name="heart" /> Supportive reply · ModBot</b> {careReply}
              </div>
              <div className="qactions">
                <button className="btn ok" onClick={() => onOverride(d.msg.id, "handled")}>
                  <Icon name="check" /> Mark as contacted
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <footer className="inbox-footer"><Icon name="shield" />{tab === "review" ? "Messages stay held until you decide." : "Support first. Never an automatic ban."}</footer>
    </aside>
  );
}
