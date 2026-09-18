import type { MeetingState } from "../lib/useMeeting.ts";
import { CONCURRENCY } from "../lib/useMeeting.ts";
import { fmtClock, fmtMs, summarize } from "../lib/stats.ts";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`hud-stat${tone ? ` ${tone}` : ""}`}>
      <span className="hud-l">{label}</span>
      <span className="hud-v">
        {value}
        {sub && <span className="hud-s">{sub}</span>}
      </span>
    </div>
  );
}

/** Measured numbers, live: the strip along the bottom of the notes. */
export function Hud({ s }: { s: MeetingState }) {
  const screen = summarize(s.screenLatencies);
  const api = summarize(s.apiLatencies);
  const client = summarize(s.clientLatencies);
  const wallElapsed = s.wallStart !== null ? ((s.wallEnd ?? performance.now()) - s.wallStart) / 1000 : 0;
  const judged = s.rows.filter((r) => r.status === "done").length;
  const items = s.agg.items.length;
  const rate = wallElapsed > 0 ? judged / wallElapsed : 0;
  const last = s.rows.filter((r) => r.status === "done").at(-1);
  const speed = s.mode === "replay" && s.speed !== "instant" ? `${s.speed}×` : s.mode === "replay" ? "all at once" : "live mic";

  return (
    <footer className="hud">
      <Stat label="Meeting clock" value={fmtClock(s.clock)} sub={speed} />
      <Stat label="Wall time" value={`${wallElapsed.toFixed(1)} s`} />
      <Stat label="Sentences judged" value={`${judged} / ${s.rows.length}`} sub={`${s.inFlight} in flight of ${CONCURRENCY}`} />
      <Stat label="Items surfaced" value={String(items)} sub={`${rate.toFixed(1)} sentences/s`} />
      <Stat label="Last sentence" value={last?.clientMs !== undefined ? fmtMs(last.clientMs) : "—"} sub={last?.apiMs !== undefined ? `Jev ${fmtMs(last.apiMs)}` : undefined} />
      <Stat label="p50 to screen" value={screen.n ? fmtMs(screen.p50) : "—"} sub={client.n ? `round-trip ${fmtMs(client.p50)}` : undefined} tone="accent" />
      <Stat label="p95 to screen" value={screen.n ? fmtMs(screen.p95) : "—"} sub={client.n ? `round-trip ${fmtMs(client.p95)}` : undefined} tone="accent" />
      <Stat label="Jev p50" value={api.n ? fmtMs(api.p50) : "—"} sub={api.n ? `max ${fmtMs(api.max)}` : undefined} />
      <Stat label="Errors" value={String(s.errors)} tone={s.errors ? "bad" : undefined} sub={s.lastError ?? undefined} />
    </footer>
  );
}
