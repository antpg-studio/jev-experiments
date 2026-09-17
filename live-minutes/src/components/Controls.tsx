import type { MeetingState, Mode, Speed } from "../lib/useMeeting.ts";
import { MEETING, MEETING_TITLE, TRANSCRIPT } from "../data/transcript.ts";

interface Props {
  s: MeetingState;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onMode: (m: Mode) => void;
  onSpeed: (sp: Speed) => void;
  onMicSpeaker: (n: string) => void;
}

export function sourceBadge(s: MeetingState): { cls: string; text: string } {
  const h = s.health;
  if (h === null) return { cls: "bad", text: "proxy offline" };
  if (h.mock) return { cls: "warn", text: "MOCK · recorded answers" };
  if (h.hasKey) return { cls: "good", text: "real TypeSafe Jev · jev-latest" };
  return { cls: "bad", text: "no TYPESAFE_API_KEY" };
}

export function canStart(s: MeetingState): boolean {
  const h = s.health;
  return !(h !== null && !h.mock && !h.hasKey);
}

const SPEEDS: { sp: Speed; label: string; key: string }[] = [
  { sp: 1, label: "1×", key: "1" },
  { sp: 4, label: "4×", key: "4" },
  { sp: "instant", label: "all", key: "a" },
];

export function Controls({ s, onStart, onStop, onReset, onMode, onSpeed, onMicSpeaker }: Props) {
  const running = s.phase === "running";
  const source = sourceBadge(s);

  return (
    <header className="topbar">
      <div className="brand">
        <img src="./live-minutes.svg" alt="" width={22} height={22} />
        <h1>live-minutes</h1>
        <span className="tagline">who owns what by when — as it is said</span>
      </div>

      <div className="mode">
        <button type="button" className={`key ${s.mode === "replay" ? "on" : ""}`} disabled={running} onClick={() => onMode("replay")} title="r">
          [<u>r</u>eplay]
        </button>
        <button
          type="button"
          className={`key ${s.mode === "mic" ? "on" : ""}`}
          disabled={running || !s.micSupported}
          title={s.micSupported ? "m — Web Speech API (Chrome)" : "Web Speech API not available in this browser"}
          onClick={() => onMode("mic")}
        >
          [<u>m</u>ic{!s.micSupported && " n/a"}]
        </button>
      </div>

      {s.mode === "replay" ? (
        <div className="speed">
          {SPEEDS.map(({ sp, label, key }) => (
            <button type="button" key={key} className={`key ${s.speed === sp ? "on" : ""}`} disabled={running} onClick={() => onSpeed(sp)} title={key}>
              [<u>{key}</u>{label.startsWith(key) ? label.slice(1) : `:${label}`}]
            </button>
          ))}
          <span className="fixture muted small" title={MEETING_TITLE}>
            {MEETING_TITLE} · {TRANSCRIPT.length} utt · {MEETING.attendees.length} people · 12 min
          </span>
        </div>
      ) : (
        <div className="speed mic">
          <input value={s.micSpeaker} disabled={running} onChange={(e) => onMicSpeaker(e.target.value)} />
        </div>
      )}

      <div className="topbar-actions">
        {!running ? (
          <button type="button" className="primary key" onClick={onStart} disabled={!canStart(s)} title="s">
            ▶ <u>s</u>tart
          </button>
        ) : (
          <button type="button" className="danger key" onClick={onStop} title="s">
            ■ <u>s</u>top
          </button>
        )}
        <button type="button" className="key" onClick={onReset} disabled={s.phase === "idle"} title="x">
          [<u>x</u>:reset]
        </button>
        <span className={`source ${source.cls}`}>{source.text}</span>
      </div>
    </header>
  );
}
