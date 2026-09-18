import type { MinuteItem } from "../lib/aggregate.ts";
import type { Row, Phase } from "../lib/useMeeting.ts";
import { fmtClock } from "../lib/stats.ts";
import { ACTION_KEYWORDS } from "../lib/keyword.ts";
import { BUCKET_TITLE } from "./labels.ts";
import type { Bucket } from "../lib/resolve.ts";
import { Pane, type PaneIdx } from "./Pane.tsx";

interface PaneProps {
  active: PaneIdx;
  onActivate: (i: PaneIdx) => void;
}

export function PostMeetingPanel({ phase, clock, wallStart, wallEnd, items, active, onActivate }: { phase: Phase; clock: number; wallStart: number | null; wallEnd: number | null; items: MinuteItem[] } & PaneProps) {
  const waited = wallStart !== null ? ((wallEnd ?? performance.now()) - wallStart) / 1000 : 0;
  const order: Bucket[] = ["actions", "decisions", "questions", "risks"];
  return (
    <Pane
      idx={5}
      className="baseline post"
      active={active}
      onActivate={onActivate}
      title="Post-meeting summary"
      right={
        <>
          <span className="pill illustrative">illustrative</span>
          <span className={`pill${phase === "done" ? " delivered" : ""}`}>{phase === "done" ? "Delivered" : "Waiting…"}</span>
        </>
      }
    >
      <div className="scroll">
        {phase !== "done" ? (
          <div className="waiting">
            <div className="big-timer">{fmtClock(clock)}</div>
            <p>
              {phase === "idle" ? "The usual way: one big summarisation prompt over the whole transcript, after the call. Nothing until the meeting ends." : "Meeting in progress — the summariser has nothing to show yet."}
            </p>
            <p className="muted small">The notes on the left have been visible for as long as this counter has been running.</p>
          </div>
        ) : (
          <div className="dump">
            <p className="muted small">
              Same {items.filter((x) => x.supersededBy === null).length} items, first visible {waited.toFixed(0)} s after the meeting started — all at once, when nobody can correct them in the room.
            </p>
            {order.map((b) => {
              const list = items.filter((x) => x.bucket === b && x.supersededBy === null);
              if (!list.length) return null;
              return (
                <div key={b} className="dump-group">
                  <h3>{BUCKET_TITLE[b]}</h3>
                  <ul>
                    {list.map((x) => (
                      <li key={x.id}>
                        {x.text}
                        {x.bucket === "actions" && <span className="muted"> — {x.assignee ?? "unassigned"}{x.deadline.kind !== "none" ? `, ${x.deadline.label}` : ""}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Pane>
  );
}

export function KeywordPanel({ rows, hasTruth, active, onActivate }: { rows: Row[]; hasTruth: boolean } & PaneProps) {
  const flagged = rows.filter((r) => r.keywordFlag);
  const trueActions = rows.filter((r) => r.truth?.kind === "action_item");
  const missed = trueActions.filter((r) => !r.keywordFlag);
  const fps = flagged.filter((r) => r.truth && r.truth.kind !== "action_item");
  const missRate = trueActions.length ? missed.length / trueActions.length : 0;
  const jevActions = rows.filter((r) => r.judgment?.kind === "action_item");
  const jevMissed = trueActions.filter((r) => r.status === "done" && r.judgment?.kind !== "action_item");

  return (
    <Pane
      idx={6}
      className="baseline keyword"
      active={active}
      onActivate={onActivate}
      title={<>Keyword heuristic <span className="pill">old way</span></>}
      right={<span className="muted mono small" title={ACTION_KEYWORDS.source}>/{ACTION_KEYWORDS.source.slice(0, 22)}…/</span>}
    >
      <div className="kw-stats">
        <div className="stat">
          <span className="v">{flagged.length}</span>
          <span className="l">Flagged</span>
        </div>
        {hasTruth && (
          <>
            <div className="stat bad">
              <span className="v">{(missRate * 100).toFixed(0)}%</span>
              <span className="l">Missed · {missed.length} of {trueActions.length} real action items</span>
            </div>
            <div className="stat bad">
              <span className="v">{fps.length}</span>
              <span className="l">False positives</span>
            </div>
            <div className="stat good">
              <span className="v">{trueActions.length ? (((trueActions.length - jevMissed.length) / trueActions.length) * 100).toFixed(0) : 0}%</span>
              <span className="l">Jev recall · {jevActions.length} flagged</span>
            </div>
          </>
        )}
      </div>
      <div className="scroll kw-list">
        {hasTruth &&
          missed.slice(-6).map((r) => (
            <div key={r.id} className="kw-miss">
              <span className="tag err">Missed</span> <span className="muted">{r.speaker.split(" ")[0]}:</span> {r.text}
            </div>
          ))}
        {!hasTruth && flagged.slice(-6).map((r) => <div key={r.id} className="kw-miss">{r.text}</div>)}
      </div>
    </Pane>
  );
}
