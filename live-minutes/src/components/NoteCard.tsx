import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { MinuteItem } from "../lib/aggregate.ts";
import type { Attendee } from "../lib/types.ts";
import { fmtMs } from "../lib/stats.ts";
import { speakerClass } from "./labels.ts";

interface Props {
  item: MinuteItem;
  spokenAt: number;
  attendees: Attendee[];
  onShown: (id: number, ms: number) => void;
  onFix: (id: number, name: string | null) => void;
}

const MENU_H = 5 * 40 + 12;

const LABEL: Record<MinuteItem["bucket"], string> = {
  actions: "To do",
  decisions: "Decided",
  questions: "Open question",
  risks: "Risk",
};

export function NoteCard({ item, spokenAt, attendees, onShown, onFix }: Props) {
  const [menu, setMenu] = useState<{
    left: number;
    top: number;
    up: boolean;
  } | null>(null);
  const reported = useRef(false);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (menu) return setMenu(null);
    const r = e.currentTarget.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < MENU_H + 12;
    setMenu({ left: r.left, top: up ? r.top - 8 : r.bottom + 8, up });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  // Measured end-of-utterance → this card committed to the DOM.
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onShown(item.id, performance.now() - spokenAt);
  }, [item.id, spokenAt, onShown]);

  const superseded = item.supersededBy !== null;
  const unassignedP = Math.max(
    0,
    1 - item.assigneeCandidates.reduce((s, c) => s + c.p, 0),
  );
  const owner = item.assignee ? item.assignee.split(" ")[0] : null;
  const ownerFull = item.assignee ?? "";

  return (
    <article
      className={`note ${item.bucket}${superseded ? " superseded" : ""}`}
    >
      <div className="note-kind">
        <span className="tick" />
        {superseded ? "Reversed" : LABEL[item.bucket]}
      </div>
      <p className="note-text">{item.text}</p>
      <div className="note-meta">
        {item.bucket === "actions" ? (
          <button
            type="button"
            className={`owner${item.assigneeUncertain ? " unsure" : ""}`}
            onClick={toggle}
            title={
              item.assigneeUncertain
                ? "Not sure who owns this — tap to fix"
                : "Tap to change owner"
            }
          >
            {item.assigneeUncertain ? (
              <>
                <span className="avatar q">?</span>
                Who owns this?
              </>
            ) : owner ? (
              <>
                <span className={`avatar ${speakerClass(ownerFull)}`}>
                  {owner[0]}
                </span>
                {owner}
              </>
            ) : (
              <>
                <span className="avatar q">–</span>
                Unassigned
              </>
            )}
          </button>
        ) : (
          <span className="said">
            <span className={`avatar ${speakerClass(item.speaker)}`}>
              {item.speaker[0]}
            </span>
            {item.speaker.split(" ")[0]}
          </span>
        )}
        {item.deadline.kind !== "none" && (
          <span
            className={`due${item.deadline.date ? "" : " vague"}`}
            title={item.deadline.date ?? "date not parsed"}
          >
            {item.deadline.label}
          </span>
        )}
        {item.blocked && <span className="flag">Blocked</span>}
        <span className="lat" title="end of sentence → on screen">
          {item.latencyMs === null ? "" : fmtMs(item.latencyMs)}
        </span>
      </div>

      {menu &&
        createPortal(
          <div
            className={`owner-menu${menu.up ? " up" : ""}`}
            style={{ left: menu.left, top: menu.top }}
            onMouseLeave={() => setMenu(null)}
          >
            {attendees.map((a) => {
              const p =
                item.assigneeCandidates.find((c) => c.name === a.name)?.p ?? 0;
              return (
                <button
                  type="button"
                  key={a.name}
                  onClick={() => {
                    onFix(item.id, a.name);
                    setMenu(null);
                  }}
                >
                  <span className={`avatar ${speakerClass(a.name)}`}>
                    {a.name[0]}
                  </span>
                  <span className="n">{a.name}</span>
                  <span className="p">{Math.round(p * 100)}%</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                onFix(item.id, null);
                setMenu(null);
              }}
            >
              <span className="avatar q">–</span>
              <span className="n">Unassigned</span>
              <span className="p">{Math.round(unassignedP * 100)}%</span>
            </button>
          </div>,
          document.body,
        )}
    </article>
  );
}
