import { useEffect, useRef } from "react";
import type { Row } from "../lib/useMeeting.ts";
import { fmtClock, fmtMs } from "../lib/stats.ts";
import { KIND_LABEL, speakerClass } from "./labels.ts";
import { Pane, type PaneIdx } from "./Pane.tsx";

export function Transcript({
  rows,
  interim,
  micSpeaker,
  micError,
  running,
  active,
  onActivate,
}: {
  rows: Row[];
  interim: string;
  micSpeaker: string;
  micError: string | null;
  running: boolean;
  active: PaneIdx;
  onActivate: (i: PaneIdx) => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [rows.length, interim]);

  return (
    <Pane idx={0} className="transcript" active={active} onActivate={onActivate} right={<span className="muted">{rows.length} sentences</span>}>
      <div className="scroll">
        {micError && <p className="empty mic-error">{micError}</p>}
        {rows.length === 0 && !interim && !micError && (
          <p className="empty">
            Press <b>Start meeting</b> to replay the standup. Every finished sentence is judged the moment it ends.
          </p>
        )}
        {rows.map((r) => (
          <div key={r.id} className={`utt ${r.status}`}>
            <span className={`avatar sm ${speakerClass(r.speaker)}`}>{r.speaker[0]}</span>
            <span className="utt-speaker">{r.speaker.split(" ")[0]}</span>
            <span className="utt-time">{fmtClock(r.endsAt)}</span>
            <span className="utt-text">{r.text}</span>
            <span className="utt-tag">
              {r.status === "pending" && <span className="spin" title="judging…" />}
              {r.status === "pending" && <span className="lat">judging</span>}
              {r.status === "error" && <span className="tag err" title={r.error}>error</span>}
              {r.status === "done" && r.judgment && (
                <>
                  <span className={`tag k-${r.judgment.kind}`}>{KIND_LABEL[r.judgment.kind]}</span>
                  <span className="lat">{fmtMs(r.clientMs ?? 0)}</span>
                </>
              )}
            </span>
          </div>
        ))}
        {interim && (
          <div className="utt interim">
            <span className={`avatar sm ${speakerClass(micSpeaker)}`}>{micSpeaker[0] ?? "?"}</span>
            <span className="utt-speaker">{micSpeaker}</span>
            <span className="utt-time">…</span>
            <span className="utt-text">{interim}</span>
          </div>
        )}
        {running && !interim && (
          <div className="utt listening">
            <span className="avatar sm">…</span>
            <span className="utt-speaker muted">Listening</span>
            <span className="utt-time" />
            <span className="utt-text">
              <span className="cursor" />
            </span>
          </div>
        )}
        <div ref={bottom} />
      </div>
    </Pane>
  );
}
