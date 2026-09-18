import { useEffect, useState } from "react";
import { useMeeting } from "./lib/useMeeting.ts";
import { MEETING, MEETING_TITLE } from "./data/transcript.ts";
import { Sidebar, canStart } from "./components/Controls.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { Lists } from "./components/Lists.tsx";
import { KeywordPanel, PostMeetingPanel } from "./components/Baselines.tsx";
import { Hud } from "./components/Hud.tsx";
import { fmtClock } from "./lib/stats.ts";
import { PANES, type PaneIdx } from "./components/Pane.tsx";

export default function App() {
  const m = useMeeting();
  const s = m.state;
  const [, force] = useState(0);
  const [active, setActive] = useState<PaneIdx>(0);

  // The HUD's wall clock and the post-meeting timer need a heartbeat while running.
  useEffect(() => {
    if (s.phase !== "running") return;
    const id = window.setInterval(() => force((n) => n + 1), 100);
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
        case "j":
          setActive((p) => ((p + 1) % PANES.length) as PaneIdx);
          break;
        case "k":
          setActive((p) => ((p + PANES.length - 1) % PANES.length) as PaneIdx);
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

  return (
    <div className={`app ${s.health?.mock ? "mock" : ""}`}>
      {s.health?.mock && <div className="mock-banner">MOCK MODE — answers replayed from server/mock-answers.json, no TypeSafe calls are being made</div>}
      <Sidebar s={s} onStart={m.start} onStop={m.stop} onReset={m.reset} onMode={m.setMode} onSpeed={m.setSpeed} onMicSpeaker={m.setMicSpeaker} />
      <div className="workspace">
        <main className="notes">
          <header className="doc-head">
            <h1>{s.mode === "mic" ? "Live meeting" : MEETING_TITLE}</h1>
            <div className="doc-sub">
              <span>{new Date(`${MEETING.today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
              <span>·</span>
              <span>{attendees.map((a) => a.name.split(" ")[0]).join(", ")}</span>
              <span>·</span>
              <span className={`live-pill ${s.phase}`}>
                {s.phase === "running" ? <><span className="dot" /> Live · {fmtClock(s.clock)}</> : s.phase === "done" ? `Ended · ${fmtClock(s.clock)}` : "Not started"}
              </span>
            </div>
          </header>
          <Lists items={s.agg.items} rows={s.rows} attendees={attendees} onShown={m.shown} onFix={m.fixAssignee} active={active} onActivate={setActive} />
        </main>
        <aside className="side">
          <Transcript rows={s.rows} interim={s.micInterim} micSpeaker={s.micSpeaker} micError={s.micError} running={s.phase === "running"} active={active} onActivate={setActive} />
          <div className="baselines">
            <PostMeetingPanel phase={s.phase} clock={s.clock} wallStart={s.wallStart} wallEnd={s.wallEnd} items={s.agg.items} active={active} onActivate={setActive} />
            <KeywordPanel rows={s.rows} hasTruth={s.mode === "replay"} active={active} onActivate={setActive} />
          </div>
        </aside>
        <Hud s={s} />
      </div>
    </div>
  );
}
