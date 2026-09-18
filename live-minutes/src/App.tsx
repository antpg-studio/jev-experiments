import { useEffect, useState } from "react";
import { useMeeting } from "./lib/useMeeting.ts";
import { MEETING, MEETING_TITLE } from "./data/transcript.ts";
import { Header, canStart } from "./components/Header.tsx";
import { Notes } from "./components/Notes.tsx";
import { Caption } from "./components/Caption.tsx";
import { Pulse } from "./components/Pulse.tsx";

export default function App() {
  const m = useMeeting();
  const s = m.state;
  const [, force] = useState(0);

  // The elapsed clock needs a heartbeat while running.
  useEffect(() => {
    if (s.phase !== "running") return;
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [s.phase]);

  // Single-key bindings (ignored while typing in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const running = s.phase === "running";
      switch (e.key) {
        case "s":
          if (running) m.stop();
          else if (canStart(s)) m.start();
          break;
        case "x":
          if (s.phase !== "idle") m.reset();
          break;
        case "r":
          if (!running) m.setMode("replay");
          break;
        case "m":
          if (!running && s.micSupported) m.setMode("mic");
          break;
        case "1":
          if (!running) m.setSpeed(1);
          break;
        case "4":
          if (!running) m.setSpeed(4);
          break;
        case "a":
          if (!running) m.setSpeed("instant");
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, m]);

  const attendees = s.mode === "mic" ? [{ name: s.micSpeaker || "You", role: "speaker" }, ...MEETING.attendees] : MEETING.attendees;
  const title = s.mode === "mic" ? "Live meeting" : MEETING_TITLE;

  return (
    <div className={`app ${s.phase}`}>
      {s.health?.mock && <div className="mock-banner">Mock mode — answers replayed from server/mock-answers.json, no TypeSafe calls are being made</div>}
      <Header
        s={s}
        title={title}
        attendees={attendees}
        onStart={m.start}
        onStop={m.stop}
        onReset={m.reset}
        onMode={m.setMode}
        onSpeed={m.setSpeed}
        onMicSpeaker={m.setMicSpeaker}
      />
      <Notes items={s.agg.items} rows={s.rows} attendees={attendees} phase={s.phase} onShown={m.shown} onFix={m.fixAssignee} />
      <Pulse s={s} />
      <Caption rows={s.rows} interim={s.micInterim} micSpeaker={s.micSpeaker} micError={s.micError} phase={s.phase} />
    </div>
  );
}
