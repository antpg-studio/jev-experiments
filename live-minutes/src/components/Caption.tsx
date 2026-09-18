import type { Phase, Row } from "../lib/useMeeting.ts";
import { KIND_LABEL, speakerClass } from "./labels.ts";

interface Props {
  rows: Row[];
  interim: string;
  micSpeaker: string;
  micError: string | null;
  phase: Phase;
}

/** What is being said right now — a subtitle strip, not a transcript. */
export function Caption({ rows, interim, micSpeaker, micError, phase }: Props) {
  if (phase !== "running" && !micError) return null;

  const last = rows.at(-1);
  const speaker = interim ? micSpeaker : last?.speaker;
  const text = interim || last?.text;

  return (
    <div className={`caption${phase === "done" ? " ended" : ""}`}>
      {micError ? (
        <span className="mic-error">{micError}</span>
      ) : text && speaker ? (
        <>
          <span className={`avatar ${speakerClass(speaker)}`}>{speaker[0]}</span>
          <span className="who">{speaker.split(" ")[0]}</span>
          <span className={`text${interim ? " interim" : ""}`}>{text}</span>
          {!interim && last && (
            <span className={`verdict ${last.status}`}>
              {last.status === "pending" && <span className="spin" />}
              {last.status === "done" && last.judgment && KIND_LABEL[last.judgment.kind]}
              {last.status === "error" && "Failed"}
            </span>
          )}
        </>
      ) : (
        <span className="listening">
          <span className="spin" /> Listening
        </span>
      )}
    </div>
  );
}
