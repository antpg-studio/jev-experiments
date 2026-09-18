import { useEffect, useRef } from "react";
import { ChevronRight, Pause, Play, Send } from "lucide-react";
import type { Chat } from "../lib/store.ts";

interface Props {
  chat: Chat;
  onDraft: (draft: string) => void;
  onSend: () => void;
  onNext: () => void;
  onPlay: () => void;
  onPause: () => void;
}

export function Conversation({ chat, onDraft, onSend, onNext, onPlay, onPause }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat.messages.length, chat.id]);

  const done = chat.delivered >= chat.scriptLength;

  return (
    <section className="panel conversation">
      <div className="panel-title conv-head">
        <div>
          <span className="name">{chat.customer.name}</span>
          <span className="muted">
            {" "}
            · {chat.customer.plan} plan · {chat.customer.tenure_months} mo tenure · {chat.customer.prior_tickets} prior tickets
          </span>
        </div>
        <div className="conv-controls">
          <button className="btn small" onClick={onNext} disabled={done || chat.playing} title="Deliver the next scripted customer message">
            <ChevronRight size={13} /> Next message
          </button>
          {chat.playing ? (
            <button className="btn small" onClick={onPause}>
              <Pause size={13} /> Pause
            </button>
          ) : (
            <button className="btn small" onClick={onPlay} disabled={done}>
              <Play size={13} /> Play script
            </button>
          )}
        </div>
      </div>
      <div className="messages" ref={scroller}>
        {chat.messages.length === 0 && (
          <div className="empty">
            No messages yet. Press <b>Next message</b>, <b>Play script</b>, or <b>Run all 8 conversations</b>.
          </div>
        )}
        {chat.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="who">{m.role === "customer" ? chat.customer.name : "You (agent)"}</div>
            <div className="bubble">{m.text}</div>
          </div>
        ))}
        {chat.pending && <div className="typing">copilot judging…</div>}
      </div>
      <div className="composer">
        <textarea
          value={chat.draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="Reply to the customer… (auto-filled when the copilot is confident)"
          rows={4}
        />
        <div className="composer-foot">
          <span className="muted">
            {chat.draftSource === "auto" ? "Draft auto-filled from macro — edit or send" : chat.draftSource === "manual" ? "Manual draft" : ""}
          </span>
          <button className="btn primary small" onClick={onSend} disabled={!chat.draft.trim()}>
            <Send size={13} /> Send
          </button>
        </div>
      </div>
    </section>
  );
}
