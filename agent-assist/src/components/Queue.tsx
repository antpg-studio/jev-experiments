import type { Chat } from "../lib/store.ts";
import { CHURN_ALERT, fmtMs, queueBadges, queuePriority } from "../lib/engine.ts";

interface Props {
  chats: Chat[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function Queue({ chats, activeId, onSelect }: Props) {
  const rows = chats
    .map((c) => ({ chat: c, badges: c.judgment ? queueBadges(c.judgment.answers) : undefined }))
    .sort((a, b) => queuePriority(b.badges) - queuePriority(a.badges));

  return (
    <aside className="panel queue">
      <div className="panel-title">
        Queue <span className="muted">sorted by risk</span>
      </div>
      <ul>
        {rows.map(({ chat, badges }) => {
          const last = chat.messages[chat.messages.length - 1];
          const churnHot = (badges?.churn ?? 0) >= CHURN_ALERT;
          const frustrated = (badges?.frustration ?? 0) >= 2;
          const hasSignal = badges && (badges.escalate || churnHot || frustrated || badges.regulatory || badges.refundRequested);
          return (
            <li
              key={chat.id}
              className={`row ${chat.id === activeId ? "active" : ""} ${badges?.escalate ? "hot" : ""}`}
              onClick={() => onSelect(chat.id)}
            >
              <div className="row-head">
                <span className="name">{chat.customer.name}</span>
                {chat.pending && <span className="dot pending" title="judging" />}
                {!chat.pending && chat.playing && <span className="dot live" title="script playing" />}
                <span className="row-meta">
                  {chat.judgment ? fmtMs(chat.judgment.panelMs) : `${chat.delivered}/${chat.scriptLength}`}
                </span>
              </div>
              <div className="row-last">{last ? last.text : <span className="muted">{chat.label}</span>}</div>
              {hasSignal && (
                <div className="badges">
                  {badges.escalate && <span className="badge red">escalate</span>}
                  {churnHot && <span className="badge orange">churn {badges.churn.toFixed(1)}</span>}
                  {frustrated && <span className="badge orange">frustrated</span>}
                  {badges.regulatory && <span className="badge purple">regulatory</span>}
                  {badges.refundRequested && <span className="badge blue">refund</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
