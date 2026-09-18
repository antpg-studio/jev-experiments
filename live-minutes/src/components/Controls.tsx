import type { MeetingState, Mode, Speed } from "../lib/useMeeting.ts";
import { MEETING, MEETING_TITLE, TRANSCRIPT } from "../data/transcript.ts";
import { speakerClass } from "./labels.ts";

interface Props {
  s: MeetingState;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onMode: (m: Mode) => void;
  onSpeed: (sp: Speed) => void;
  onMicSpeaker: (n: string) => void;
}

export const APP_NAME = "Fern";

export function sourceBadge(s: MeetingState): { cls: string; text: string } {
  const h = s.health;
  if (h === null) return { cls: "bad", text: "Proxy offline" };
  if (h.mock) return { cls: "warn", text: "Mock · recorded answers" };
  if (h.hasKey) return { cls: "good", text: "TypeSafe Jev · jev-latest" };
  return { cls: "bad", text: "No TYPESAFE_API_KEY" };
}

export function canStart(s: MeetingState): boolean {
  const h = s.health;
  return !(h !== null && !h.mock && !h.hasKey);
}

const SPEEDS: { sp: Speed; label: string; key: string }[] = [
  { sp: 1, label: "1×", key: "1" },
  { sp: 4, label: "4×", key: "4" },
  { sp: "instant", label: "All", key: "a" },
];

export function Sidebar({ s, onStart, onStop, onReset, onMode, onSpeed, onMicSpeaker }: Props) {
  const running = s.phase === "running";
  const source = sourceBadge(s);
  const live = running || s.phase === "done";

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="./fern.svg" alt="" width={28} height={28} />
        <span className="brand-name">{APP_NAME}</span>
      </div>

      <nav className="nav">
        <div className="nav-label">Today</div>
        <div className={`meeting${live ? " live" : ""}`}>
          <div className="meeting-title">{MEETING_TITLE}</div>
          <div className="meeting-sub">
            {live && <span className="dot" />}
            {running ? "In progress" : s.phase === "done" ? "Ended" : "9:30 AM"} · {MEETING.attendees.length} people · 12 min
          </div>
          <div className="avatars">
            {MEETING.attendees.map((a) => (
              <span key={a.name} className={`avatar ${speakerClass(a.name)}`} title={`${a.name} — ${a.role}`}>
                {a.name[0]}
              </span>
            ))}
          </div>
        </div>
        <div className="nav-label">Attendees</div>
        <ul className="attendee-list">
          {MEETING.attendees.map((a) => (
            <li key={a.name}>
              <span className={`avatar sm ${speakerClass(a.name)}`}>{a.name[0]}</span>
              <span className="att-name">{a.name}</span>
              <span className="att-role">{a.role}</span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="controls">
        <div className="control-label">Source</div>
        <div className="seg">
          <button type="button" className={s.mode === "replay" ? "on" : ""} disabled={running} onClick={() => onMode("replay")} title="r">
            Replay
          </button>
          <button
            type="button"
            className={s.mode === "mic" ? "on" : ""}
            disabled={running || !s.micSupported}
            title={s.micSupported ? "m — Web Speech API (Chrome)" : "Web Speech API not available in this browser"}
            onClick={() => onMode("mic")}
          >
            Microphone
          </button>
        </div>

        {s.mode === "replay" ? (
          <>
            <div className="control-label">Speed</div>
            <div className="seg">
              {SPEEDS.map(({ sp, label, key }) => (
                <button type="button" key={key} className={s.speed === sp ? "on" : ""} disabled={running} onClick={() => onSpeed(sp)} title={key}>
                  {label}
                </button>
              ))}
            </div>
            <div className="fixture">{TRANSCRIPT.length} utterances · seeded standup</div>
          </>
        ) : (
          <>
            <div className="control-label">Your name</div>
            <input className="name-input" value={s.micSpeaker} disabled={running} onChange={(e) => onMicSpeaker(e.target.value)} />
          </>
        )}

        <div className="control-row">
          {!running ? (
            <button type="button" className="primary" onClick={onStart} disabled={!canStart(s)} title="s">
              {s.phase === "done" ? "Play again" : "Start meeting"}
            </button>
          ) : (
            <button type="button" className="danger" onClick={onStop} title="s">
              End meeting
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={onReset} disabled={s.phase === "idle"} title="x">
            Reset
          </button>
        </div>

        <div className={`source ${source.cls}`}>
          <span className="dot" />
          {source.text}
        </div>
        <div className="shortcuts">
          <kbd>s</kbd> start/stop · <kbd>x</kbd> reset · <kbd>1</kbd>/<kbd>4</kbd>/<kbd>a</kbd> speed
        </div>
      </div>
    </aside>
  );
}
