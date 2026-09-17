import { useEffect, useState } from "react";
import type { MeetingState } from "../lib/useMeeting.ts";
import { CONCURRENCY } from "../lib/useMeeting.ts";
import { fmtClock, fmtMs, summarize } from "../lib/stats.ts";
import { PANES, type PaneIdx } from "./Pane.tsx";
import { sourceBadge } from "./Controls.tsx";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`hud-stat${tone ? ` ${tone}` : ""}`}>
      <span className="hud-l">{label}</span>
      <span className="hud-v">{value}</span>
      {sub && <span className="hud-s">{sub}</span>}
    </div>
  );
}

/** Measured numbers: the line above the tmux status bar. */
export function Hud({ s }: { s: MeetingState }) {
  const screen = summarize(s.screenLatencies);
  const api = summarize(s.apiLatencies);
  const client = summarize(s.clientLatencies);
  const wallElapsed = s.wallStart !== null ? ((s.wallEnd ?? performance.now()) - s.wallStart) / 1000 : 0;
  const judged = s.rows.filter((r) => r.status === "done").length;
  const items = s.agg.items.length;
  const rate = wallElapsed > 0 ? judged / wallElapsed : 0;
  const last = s.rows.filter((r) => r.status === "done").at(-1);

  return (
    <footer className="hud">
      <Stat label="clock" value={fmtClock(s.clock)} sub={s.mode === "replay" && s.speed !== "instant" ? `${s.speed}×` : s.mode === "replay" ? "all-at-once" : "live-mic"} />
      <Stat label="wall" value={`${wallElapsed.toFixed(1)}s`} />
      <Stat label="judged" value={`${judged}/${s.rows.length}`} sub={`${s.inFlight} in-flight/${CONCURRENCY}`} />
      <Stat label="items" value={String(items)} sub={`${rate.toFixed(1)} utt/s`} />
      <Stat label="last" value={last?.clientMs ? fmtMs(last.clientMs) : "—"} sub={last?.apiMs ? `api ${fmtMs(last.apiMs)}` : undefined} tone="accent" />
      <Stat label="p50→screen" value={screen.n ? fmtMs(screen.p50) : "—"} sub={client.n ? `rtt ${fmtMs(client.p50)}` : undefined} tone="accent" />
      <Stat label="p95→screen" value={screen.n ? fmtMs(screen.p95) : "—"} sub={client.n ? `rtt ${fmtMs(client.p95)}` : undefined} tone="accent" />
      <Stat label="jev-p50" value={api.n ? fmtMs(api.p50) : "—"} sub={api.n ? `max ${fmtMs(api.max)}` : undefined} />
      <Stat label="err" value={String(s.errors)} tone={s.errors ? "bad" : undefined} sub={s.lastError ?? undefined} />
    </footer>
  );
}

const WINDOWS: { name: string; panes: PaneIdx[] }[] = [
  { name: "transcript", panes: [0] },
  { name: "minutes", panes: [1, 2, 3, 4] },
  { name: "baselines", panes: [5, 6] },
];

/** tmux status line: [session] windows … keys · source · clock */
export function StatusBar({ s, active }: { s: MeetingState; active: PaneIdx }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const source = sourceBadge(s);
  const running = s.phase === "running";
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return (
    <footer className="statusbar">
      <span className="status-left">live-minutes</span>
      <div className="windows">
        {WINDOWS.map((w, i) => (
          <span key={w.name} className={`win${w.panes.includes(active) ? " current" : ""}`}>
            {i}:{w.name}
            {w.panes.includes(active) ? "*" : ""}
          </span>
        ))}
        <span className="win">pane {active}:{PANES[active]}</span>
      </div>
      <div className="status-right">
        <span className="k">
          <kbd>s</kbd> {running ? "stop" : "start"} · <kbd>x</kbd> reset · <kbd>r</kbd>/<kbd>m</kbd> mode · <kbd>1</kbd>/<kbd>4</kbd>/<kbd>a</kbd> speed · <kbd>j</kbd>/<kbd>k</kbd> pane
        </span>
        <span>{source.text}</span>
        <span className="clock">{hh}:{mm}</span>
      </div>
    </footer>
  );
}
