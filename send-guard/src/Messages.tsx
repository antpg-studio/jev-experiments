import { useEffect, useRef } from "react";
import type { Channel } from "./lib/types";
import { PEOPLE, type Message } from "./lib/seed";
import { Avatar } from "./Shell";
import { Bookmark, Chevron, Emoji, Hash, Lock, Members, Pin, Reply, Share, Star } from "./Icons";

export function ChannelHeader({ channel, person }: { channel: Channel; person?: (typeof PEOPLE)[string] }) {
  return (
    <div className="chan-head">
      <button className="chan-title">
        {channel.kind === "dm" && person ? (
          <>
            <Avatar person={person} size={24} presence />
            <span>{person.name}</span>
          </>
        ) : (
          <>
            {channel.private ? <Lock size={18} /> : <Hash size={18} />}
            <span>{channel.name.replace(/^#/, "")}</span>
          </>
        )}
        <Chevron size={16} className="dim-icon" />
      </button>
      {channel.shared && (
        <span className="connect-pill" title="Slack Connect-style shared channel">
          <span className="connect-dot" /> Acme Corp
        </span>
      )}
      {channel.topic && <span className="chan-topic">{channel.topic}</span>}
      <div className="chan-right">
        {channel.kind === "channel" && (
          <button className="members-pill">
            <Members size={16} />
            <span>{channel.members.toLocaleString()}</span>
          </button>
        )}
        <button className="icon-btn light" aria-label="Pinned">
          <Pin size={18} />
        </button>
        <button className="icon-btn light" aria-label="Star">
          <Star size={18} />
        </button>
      </div>
    </div>
  );
}

function renderText(text: string) {
  // `code` and #4821-style ticket refs, enough for the seed data to look real.
  const parts = text.split(/(`[^`]+`|#\d{3,5})/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^#\d{3,5}$/.test(p)) return (
      <a key={i} className="link" href="#top">
        {p}
      </a>
    );
    return <span key={i}>{p}</span>;
  });
}

export function MessageList({ channel, messages }: { channel: Channel; messages: Message[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, channel.id]);

  return (
    <div className="messages">
      <div className="chan-intro">
        {channel.kind === "dm" ? (
          <p>
            This conversation is just between <b>you</b> and <b>{channel.label.replace(" (customer)", "")}</b>. It&apos;s a person outside your
            organisation.
          </p>
        ) : (
          <p>
            {channel.shared ? "This channel is shared with Acme Corp. " : ""}
            {channel.description}
          </p>
        )}
      </div>
      <div className="day-divider">
        <span>Today</span>
      </div>
      {messages.map((m, i) => {
        const p = PEOPLE[m.author];
        const prev = messages[i - 1];
        const grouped = prev && prev.author === m.author && prev.time === m.time;
        return (
          <div key={m.id} className={`msg ${grouped ? "grouped" : ""}`}>
            {grouped ? <span className="msg-time-gutter">{m.time.replace(/^Yesterday /, "")}</span> : <Avatar person={p} size={36} />}
            <div className="msg-body">
              {!grouped && (
                <div className="msg-meta">
                  <span className="msg-author">{p.name}</span>
                  {p.external && <span className="ext-badge">Acme Corp</span>}
                  <span className="msg-time">{m.time}</span>
                </div>
              )}
              <div className="msg-text">{renderText(m.text)}</div>
              {m.reactions && (
                <div className="reactions">
                  {m.reactions.map((r) => (
                    <span key={r.emoji} className="reaction">
                      {r.emoji} <b>{r.count}</b>
                    </span>
                  ))}
                  <span className="reaction reaction-add">
                    <Emoji size={14} />
                  </span>
                </div>
              )}
            </div>
            <div className="msg-actions">
              <button className="icon-btn light">
                <Emoji size={16} />
              </button>
              <button className="icon-btn light">
                <Reply size={16} />
              </button>
              <button className="icon-btn light">
                <Share size={16} />
              </button>
              <button className="icon-btn light">
                <Bookmark size={16} />
              </button>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
