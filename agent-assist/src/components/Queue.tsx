import { AlertTriangle, Scale, TrendingDown, Wallet } from "lucide-react";
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
        Queue <span className="muted">{chats.length} chats · sorted by risk</span>
      </div>
      <ul>
        {rows.map(({ chat, badges }) => {
          const last = chat.messages[chat.messages.length - 1];
          const churnHot = (badges?.churn ?? 0) >= CHURN_ALERT;
          return (
            <li
              key={chat.id}
              className={`row ${chat.id === activeId ? "active" : ""} ${badges?.escalate ? "hot" : ""}`}
              onClick={() => onSelect(chat.id)}
            >
              <div className="row-head">
                <span className="name">{chat.customer.name}</span>
                <span className="plan">{chat.customer.plan}</span>
                {chat.pending && <span className="dot pending" title="judging" />}
                {chat.playing && !chat.pending && <span className="dot live" title="script playing" />}
                {chat.judgment && <span className="lat">{fmtMs(chat.judgment.panelMs)}</span>}
              </div>
              <div className="row-label">{chat.label}</div>
              <div className="row-last">{last ? last.text : <span className="muted">waiting for first message…</span>}</div>
              <div className="badges">
                {badges?.escalate && (
                  <span className="badge red">
                    <AlertTriangle size={11} /> escalate
                  </span>
                )}
                {badges && (
                  <span className={`badge ${churnHot ? "orange" : "dim"}`}>
                    <TrendingDown size={11} /> churn {badges.churn.toFixed(1)}/3
                  </span>
                )}
                {badges && badges.frustration >= 2 && <span className="badge orange">frustrated {badges.frustration.toFixed(1)}/3</span>}
                {badges?.regulatory && (
                  <span className="badge purple">
                    <Scale size={11} /> regulatory
                  </span>
                )}
                {badges?.refundRequested && (
                  <span className="badge blue">
                    <Wallet size={11} /> refund
                  </span>
                )}
                <span className="badge count">
                  {chat.delivered}/{chat.scriptLength}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
