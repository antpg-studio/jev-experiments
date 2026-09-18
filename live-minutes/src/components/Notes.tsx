import { useEffect, useRef } from "react";
import type { MinuteItem } from "../lib/aggregate.ts";
import type { Attendee } from "../lib/types.ts";
import type { Phase, Row } from "../lib/useMeeting.ts";
import { NoteCard } from "./NoteCard.tsx";

interface Props {
  items: MinuteItem[];
  rows: Row[];
  attendees: Attendee[];
  phase: Phase;
  onShown: (id: number, ms: number) => void;
  onFix: (id: number, name: string | null) => void;
}

export function Notes({ items, rows, attendees, phase, onShown, onFix }: Props) {
  const spokenAt = new Map(rows.map((r) => [r.id, r.spokenAt]));
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== "idle") end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [items.length, phase]);

  return (
    <main className="notes">
      {items.length === 0 && (
        <p className="empty">
          {phase === "idle" && "Press Start. As people speak, what they agree to do — and by when — is written down here."}
          {phase === "running" && "Listening…"}
          {phase === "done" && "Nothing was noted."}
        </p>
      )}
      {items.map((x) => (
        <NoteCard key={x.id} item={x} spokenAt={spokenAt.get(x.utteranceId) ?? performance.now()} attendees={attendees} onShown={onShown} onFix={onFix} />
      ))}
      <div ref={end} className="notes-end" />
    </main>
  );
}
