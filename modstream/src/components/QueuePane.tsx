import type { Decided, Override } from "../App.tsx";

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
    ["harass", j.harassment],
    ["scam", j.scam_or_phishing],
    ["self-harm", j.self_harm_risk],
    ["spam", j.spam],
    ["obfusc.", j.is_obfuscated_slur_or_evasion],
    ["severity", j.severity / 3],
  ];
  return (
    <div className="probs">
      {bars.map(([k, v]) => (
        <span key={k} className="prob" title={`${k}: ${v.toFixed(2)}`}>
          <i style={{ width: `${Math.round(v * 100)}%` }} />
          <em>{k}</em>
        </span>
      ))}
      <span className="jev-choice">
        jev → <b>{j.action}</b> @ {j.actionConfidence.toFixed(2)}
      </span>
    </div>
  );
}

export function QueuePane({ review, care, careReply, onOverride }: Props) {
  return (
    <aside className="queues">
      <section className="queue review-q">
        <header>
          <h2>Human review</h2>
          <span className="count">{review.length}</span>
          <span className="sub">low-confidence or escalated · message is held from viewers until you decide</span>
        </header>
        <div className="queue-scroll">
          {review.length === 0 && <div className="empty">Nothing waiting. Jev was confident about everything so far.</div>}
          {review.map((d) => (
            <article key={d.msg.id} className="qitem">
              <div className="qhead">
                <span className="user" style={{ color: d.msg.color }}>
                  {d.msg.user}
                </span>
                <span className="reason">{d.reason}</span>
              </div>
              <p className="qtext">{d.msg.text}</p>
              <Probs d={d} />
              <div className="qactions">
                <button className="btn ok" onClick={() => onOverride(d.msg.id, "allow")}>
                  ✓ Approve
                </button>
                <button className="btn bad" onClick={() => onOverride(d.msg.id, "hide")}>
                  ✕ Reject
                </button>
                <span className="truth">label: {d.msg.truth}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="queue care-q">
        <header>
          <h2>Care queue</h2>
          <span className="count">{care.length}</span>
          <span className="sub">self-harm risk → supportive auto-reply, never a ban</span>
        </header>
        <div className="queue-scroll">
          {care.length === 0 && <div className="empty">No one flagged for care right now.</div>}
          {care.map((d) => (
            <article key={d.msg.id} className="qitem care">
              <div className="qhead">
                <span className="user" style={{ color: d.msg.color }}>
                  {d.msg.user}
                </span>
                <span className="reason">{d.reason}</span>
              </div>
              <p className="qtext">{d.msg.text}</p>
              <div className="auto-reply">
                <b>ModBot → @{d.msg.user}</b> {careReply}
              </div>
              <div className="qactions">
                <button className="btn ok" onClick={() => onOverride(d.msg.id, "handled")}>
                  ✓ Mod has reached out
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}
