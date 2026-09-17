import { useEffect, useRef, useState } from "react";
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

export function ItemCard({ item, spokenAt, attendees, onShown, onFix }: Props) {
  const [open, setOpen] = useState(false);
  const reported = useRef(false);

  // Measured end-of-utterance → this card committed to the DOM.
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onShown(item.id, performance.now() - spokenAt);
  }, [item.id, spokenAt, onShown]);

  const superseded = item.supersededBy !== null;
  const unassignedP = Math.max(0, 1 - item.assigneeCandidates.reduce((s, c) => s + c.p, 0));
  return (
    <article className={`card imp-${item.importance}${superseded ? " superseded" : ""}${item.reverses ? " reverses" : ""}`}>
      <div className="card-main">
        <p className="card-text">{item.text}</p>
        <div className="card-meta">
          <span className={`who ${speakerClass(item.speaker)}`} title={`said by ${item.speaker}`}>
            {item.speaker.split(" ")[0]}
          </span>
          {item.bucket === "actions" && (
            <span className="owner-wrap">
              <button
                type="button"
                className={`owner${item.assigneeUncertain ? " uncertain" : ""}${item.assigneeEdited ? " edited" : ""}`}
                onClick={() => setOpen((o) => !o)}
                title={item.assigneeUncertain ? "Owner uncertain — click to fix" : "Click to change owner"}
              >
                <span className="owner-name">{item.assigneeUncertain ? "who?" : item.assignee ? item.assignee.split(" ")[0].toLowerCase() : "unassigned"}</span>
              </button>
              {open && (
                <div className="owner-menu" onMouseLeave={() => setOpen(false)}>
                  {attendees.map((a) => {
                    const p = item.assigneeCandidates.find((c) => c.name === a.name)?.p ?? 0;
                    return (
                      <button
                        type="button"
                        key={a.name}
                        onClick={() => {
                          onFix(item.id, a.name);
                          setOpen(false);
                        }}
                      >
                        <span>{a.name}</span>
                        <span className="p">{Math.round(p * 100)}%</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      onFix(item.id, null);
                      setOpen(false);
                    }}
                  >
                    <span>unassigned</span>
                    <span className="p">{Math.round(unassignedP * 100)}%</span>
                  </button>
                </div>
              )}
            </span>
          )}
          {item.deadline.kind !== "none" && (
            <span className={`due${item.deadline.date ? "" : " vague"}`} title={item.deadline.date ?? "date not parsed"}>
              {item.deadline.label}
            </span>
          )}
          {item.blocked && <span className="flag blocked">blocked</span>}
          {item.reverses && <span className="flag rev">reverses</span>}
          {superseded && <span className="flag old">superseded</span>}
        </div>
      </div>
      <span className="card-lat" title="end of utterance → on screen">
        {item.latencyMs === null ? "…" : fmtMs(item.latencyMs)}
      </span>
    </article>
  );
}
