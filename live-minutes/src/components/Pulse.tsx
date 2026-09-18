import type { MeetingState } from "../lib/useMeeting.ts";
import { fmtMs, summarize } from "../lib/stats.ts";

/** The single line of measured numbers under the notes. */
export function Pulse({ s }: { s: MeetingState }) {
  if (s.phase === "idle") return null;
  const screen = summarize(s.screenLatencies);
  const judged = s.rows.filter((r) => r.status === "done").length;
  const notes = s.agg.items.length;

  return (
    <footer className="pulse">
      <span>
        <b>{notes}</b> {notes === 1 ? "note" : "notes"}
      </span>
      <span>
        <b>{judged}</b> {judged === 1 ? "sentence" : "sentences"}
      </span>
      {screen.n > 0 && (
        <span title="end of sentence → note on screen, median (p95)">
          <b>{fmtMs(screen.p50)}</b> to screen <span className="p95">(p95 {fmtMs(screen.p95)})</span>
        </span>
      )}
      {s.errors > 0 && (
        <span className="err" title={s.lastError ?? undefined}>
          {s.errors} failed
        </span>
      )}
      <span className="src">{s.health?.mock ? "Mock answers" : "TypeSafe Jev"}</span>
    </footer>
  );
}
