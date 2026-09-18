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
        <div className="conv-who">
          <span className="name">{chat.customer.name}</span>
          <span className="muted">
            {chat.customer.plan} · {chat.customer.tenure_months} mo · {chat.customer.prior_tickets} prior tickets
          </span>
        </div>
        <div className="conv-controls">
          <button className="btn small ghost" onClick={onNext} disabled={done || chat.playing} title="Deliver the next scripted customer message">
            <ChevronRight size={14} /> Next
          </button>
          {chat.playing ? (
            <button className="btn small ghost" onClick={onPause}>
              <Pause size={14} /> Pause
            </button>
          ) : (
            <button className="btn small ghost" onClick={onPlay} disabled={done}>
              <Play size={14} /> Play
            </button>
          )}
        </div>
      </div>
      <div className="messages" ref={scroller}>
        {chat.messages.length === 0 && (
          <div className="empty">
            No messages yet. Press <b>Play</b> or <b>Run all 8 chats</b>.
          </div>
        )}
        {chat.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="who">{m.role === "customer" ? chat.customer.name : "You"}</div>
            <div className="bubble">{m.text}</div>
          </div>
        ))}
        {chat.pending && <div className="typing">judging…</div>}
      </div>
      <div className="composer">
        <textarea
          value={chat.draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="Reply… auto-filled when the copilot is confident"
          rows={3}
        />
        <div className="composer-foot">
          <span className="muted">
            {chat.draftSource === "auto" ? "Auto-filled from macro" : chat.draftSource === "manual" ? "Draft" : ""}
          </span>
          <button className="btn primary small" onClick={onSend} disabled={!chat.draft.trim()}>
            <Send size={14} /> Send
          </button>
        </div>
      </div>
    </section>
  );
}
