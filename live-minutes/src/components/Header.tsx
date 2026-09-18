import type { MeetingState, Mode, Speed } from "../lib/useMeeting.ts";
import type { Attendee } from "../lib/types.ts";
import { MEETING } from "../data/transcript.ts";
import { fmtClock } from "../lib/stats.ts";
import { speakerClass } from "./labels.ts";

export const APP_NAME = "Fern";

interface Props {
  s: MeetingState;
  title: string;
  attendees: Attendee[];
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onMode: (m: Mode) => void;
  onSpeed: (sp: Speed) => void;
  onMicSpeaker: (n: string) => void;
}

export function canStart(s: MeetingState): boolean {
  const h = s.health;
  return !(h !== null && !h.mock && !h.hasKey);
}

const SPEEDS: { sp: Speed; label: string }[] = [
  { sp: 1, label: "1×" },
  { sp: 4, label: "4×" },
  { sp: "instant", label: "All at once" },
];

export function Header({ s, title, attendees, onStart, onStop, onReset, onMode, onSpeed, onMicSpeaker }: Props) {
  const running = s.phase === "running";
  const idle = s.phase === "idle";
  const date = new Date(`${MEETING.today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const noKey = s.health !== null && !s.health.mock && !s.health.hasKey;

  return (
    <header className="head">
      <div className="brand">
        <img src="./fern.svg" alt="" width={22} height={22} />
        <span>{APP_NAME}</span>
      </div>

      <h1>{title}</h1>

      <div className="meta">
        <span className="people">
          {attendees.map((a) => (
            <span key={a.name} className={`avatar ${speakerClass(a.name)}`} title={`${a.name} — ${a.role}`}>
              {a.name[0]}
            </span>
          ))}
        </span>
        <span className="date">{date}</span>
        <span className={`status ${s.phase}`}>
          {running && <span className="dot" />}
          {running ? fmtClock(s.clock) : s.phase === "done" ? `Ended · ${fmtClock(s.clock)}` : "Not started"}
        </span>
      </div>

      <div className="controls">
        {running ? (
          <button type="button" className="btn end" onClick={onStop} title="s">
            End meeting
          </button>
        ) : (
          <button type="button" className="btn go" onClick={onStart} disabled={!canStart(s)} title="s">
            {s.phase === "done" ? "Play again" : s.mode === "mic" ? "Start listening" : "Start meeting"}
          </button>
        )}
        {!idle && !running && (
          <button type="button" className="btn quiet" onClick={onReset} title="x">
            Clear
          </button>
        )}

        {!running && (
          <div className="options">
            {s.mode === "replay" ? (
              <>
                <span className="seg">
                  {SPEEDS.map(({ sp, label }) => (
                    <button type="button" key={label} className={s.speed === sp ? "on" : ""} onClick={() => onSpeed(sp)}>
                      {label}
                    </button>
                  ))}
                </span>
                {s.micSupported && (
                  <button type="button" className="link" onClick={() => onMode("mic")} title="m">
                    Use my microphone instead
                  </button>
                )}
              </>
            ) : (
              <>
                <label className="name">
                  I am
                  <input value={s.micSpeaker} onChange={(e) => onMicSpeaker(e.target.value)} />
                </label>
                <button type="button" className="link" onClick={() => onMode("replay")} title="r">
                  Replay the sample standup instead
                </button>
              </>
            )}
          </div>
        )}
        {noKey && <p className="warn">OPENROUTER_API_KEY is not set on the server, so nothing can be judged.</p>}
        {s.health === null && <p className="warn">The local proxy is not running — start it with <code>npm run dev</code>.</p>}
      </div>
    </header>
  );
}
