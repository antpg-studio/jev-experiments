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

const MARK: Record<MinuteItem["bucket"], string> = {
  actions: "☐",
  decisions: "✓",
  questions: "?",
  risks: "!",
};

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
  const first = item.speaker.split(" ")[0];
  return (
    <article className={`card imp-${item.importance}${superseded ? " superseded" : ""}${item.reverses ? " reverses" : ""}`}>
      <span className={`mark ${item.bucket}`}>{MARK[item.bucket]}</span>
      <div className="card-main">
        <p className="card-text">{item.text}</p>
        <div className="card-meta">
          <span className="who" title={`said by ${item.speaker}`}>
            <span className={`avatar xs ${speakerClass(item.speaker)}`}>{first[0]}</span>
            {first}
          </span>
          {item.bucket === "actions" && (
            <span className="owner-wrap">
              <button
                type="button"
                className={`owner${item.assigneeUncertain ? " uncertain" : ""}${item.assigneeEdited ? " edited" : ""}`}
                onClick={() => setOpen((o) => !o)}
                title={item.assigneeUncertain ? "Owner uncertain — click to fix" : "Click to change owner"}
              >
                {item.assigneeUncertain ? "Who owns this?" : item.assignee ? `Owner: ${item.assignee.split(" ")[0]}` : "Unassigned"}
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
                    <span>Unassigned</span>
                    <span className="p">{Math.round(unassignedP * 100)}%</span>
                  </button>
                </div>
              )}
            </span>
          )}
          {item.deadline.kind !== "none" && (
            <span className={`due${item.deadline.date ? "" : " vague"}`} title={item.deadline.date ?? "date not parsed"}>
              Due {item.deadline.label}
            </span>
          )}
          {item.blocked && <span className="flag blocked">Blocked</span>}
          {item.reverses && <span className="flag rev">Reverses earlier</span>}
          {superseded && <span className="flag old">Superseded</span>}
        </div>
      </div>
      <span className="card-lat" title="end of sentence → on screen">
        {item.latencyMs === null ? "…" : fmtMs(item.latencyMs)}
      </span>
    </article>
  );
}
