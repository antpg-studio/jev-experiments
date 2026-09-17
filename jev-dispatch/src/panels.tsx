import { useState } from "react";
import { fmtMs, fmtSeconds } from "./kpi.ts";
import type { FeedItem, Incident, LogEntry } from "./sim.ts";
import { SEVERITY_LEVELS, type Decision, type Severity } from "./types.ts";

export function Chip({ category }: { category: string | null }) {
  if (!category) return <span className="chip ghost">pending</span>;
  return <span className={`chip ${category}`}>{category.replace("_", " ")}</span>;
}

export function SeverityBar({ level }: { level: Severity | null }) {
  const n = level === null ? 0 : level + 1;
  return (
    <span className="sev" data-level={level ?? 0} title={level === null ? "" : SEVERITY_LEVELS[level]}>
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < n ? "on" : ""} />)}
    </span>
  );
}

function ProbRows({ probs, pick }: { probs: Record<string, number>; pick: string }) {
  const rows = Object.entries(probs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <>
      {rows.map(([k, p]) => (
        <div className="prow" key={k}>
          <span>{k}</span>
          <span className="bar"><i className={k === pick ? "pick" : ""} style={{ width: `${Math.round(p * 100)}%` }} /></span>
          <span className="v">{(p * 100).toFixed(0)}%</span>
        </div>
      ))}
    </>
  );
}

function Probs({ d, latencyMs, top }: { d: Decision; latencyMs: number | null; top: number }) {
  return (
    <div className="probs" style={{ top }}>
      <h4>category · confidence {(d.categoryConfidence * 100).toFixed(0)}%</h4>
      <ProbRows probs={d.categoryProbs} pick={d.category} />
      <h4>severity · {SEVERITY_LEVELS[d.severity]}</h4>
      <ProbRows probs={d.severityProbs} pick={String(d.severityScore)} />
      <h4>units needed</h4>
      <ProbRows probs={d.unitsProbs} pick={d.units} />
      <h4>nouls</h4>
      <div className="prow"><span>multiple victims</span><span className="bar"><i style={{ width: `${d.multipleVictims * 100}%` }} /></span><span className="v">{(d.multipleVictims * 100).toFixed(0)}%</span></div>
      <div className="prow"><span>hazmat / spread</span><span className="bar"><i style={{ width: `${d.hazmat * 100}%` }} /></span><span className="v">{(d.hazmat * 100).toFixed(0)}%</span></div>
      <div className="prow"><span>caller in danger</span><span className="bar"><i style={{ width: `${d.callerInDanger * 100}%` }} /></span><span className="v">{(d.callerInDanger * 100).toFixed(0)}%</span></div>
      <div className="prow"><span>duplicate of open</span><span className="bar"><i style={{ width: `${d.duplicateP * 100}%` }} /></span><span className="v">{(d.duplicateP * 100).toFixed(0)}%</span></div>
      <div className="meta">
        source {d.source}{d.lowConfidence ? " · low confidence → heuristic category" : ""}
        {latencyMs !== null ? ` · ${fmtMs(latencyMs)}` : ""}
        {d.mergeInto ? ` · merge → ${d.mergeInto}` : ""}
      </div>
    </div>
  );
}

const CHANNEL_ICON = { call: "CALL", sms: "SMS", sensor: "SENS" } as const;

const PROBS_HEIGHT = 400;

export function Feed({ items, time }: { items: FeedItem[]; time: number }) {
  const [hover, setHover] = useState<{ id: string; top: number } | null>(null);
  const hovered = hover ? items.find((f) => f.report.id === hover.id) : undefined;
  return (
    <div className="panel">
      <h2>Incoming reports <span>{items.length} arrived</span></h2>
      <div className="scroll" onMouseLeave={() => setHover(null)}>
        {items.slice(-60).reverse().map((f) => {
          const d = f.decision;
          const wait = (f.decidedAt ?? time) - f.report.t;
          return (
            <div
              key={f.report.id}
              className={`feed-item ${f.status}`}
              onMouseEnter={(e) => {
                const top = e.currentTarget.getBoundingClientRect().top;
                setHover({ id: f.report.id, top: Math.max(8, Math.min(top, window.innerHeight - PROBS_HEIGHT)) });
              }}
            >
              <div className="feed-head">
                <span className="chan">{CHANNEL_ICON[f.report.channel]}</span>
                <span className="id">{f.report.id}</span>
                <span>{f.report.address}</span>
                <span className="outcome">{f.status === "done" ? "" : f.status === "deciding" ? "deciding…" : `queued ${fmtSeconds(wait)}`}</span>
              </div>
              <div className="feed-text">{f.report.text}</div>
              <div className="feed-foot">
                <Chip category={d?.category ?? null} />
                <SeverityBar level={d?.severity ?? null} />
                {d && d.source === "jev" && f.latencyMs !== null && <span className="latency">{fmtMs(f.latencyMs)}</span>}
                {d && d.source === "fallback" && <span className="latency fallback">{f.timedOut ? "timeout→fallback" : "fallback"}</span>}
                {f.outcome && (
                  <span className={`outcome ${f.outcome}`}>
                    {f.outcome === "merged" ? `→ ${f.incidentId}` : f.outcome === "new" ? `${f.incidentId}` : "no action"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {hover && hovered?.decision && <Probs d={hovered.decision} latencyMs={hovered.latencyMs} top={hover.top} />}
    </div>
  );
}

export function Incidents({ incidents, time }: { incidents: Incident[]; time: number }) {
  const open = incidents.filter((i) => i.status !== "closed").sort((a, b) => b.severity - a.severity || a.firstReportT - b.firstReportT);
  const closed = incidents.length - open.length;
  return (
    <div className="panel">
      <h2>Open incidents <span>{open.length} open · {closed} closed</span></h2>
      <div className="scroll">
        {open.map((i) => (
          <div key={i.id} className={`inc ${i.status}`}>
            <div className="inc-head">
              <span className="id">{i.id}</span>
              <Chip category={i.category} />
              <SeverityBar level={i.severity} />
              <span className="age">{fmtSeconds(time - i.firstReportT)}</span>
            </div>
            <div className="inc-addr">{i.address} · {i.summary}</div>
            <div className="inc-foot">
              <span className="status">{i.status.replace("_", " ")}</span>
              <span className="units-list">{i.unitIds.length ? i.unitIds.join(" ") : `needs ${i.required.join("+")}`}</span>
              {i.mergedCount > 0 && <span className="merged">+{i.mergedCount} merged</span>}
            </div>
          </div>
        ))}
        {open.length === 0 && <div className="inc"><span className="inc-addr">No open incidents.</span></div>}
      </div>
    </div>
  );
}

export function EventLog({ log }: { log: LogEntry[] }) {
  return (
    <div className="log">
      <h2 className="subhead">Event log</h2>
      <div className="lines">
        {log.slice(-40).reverse().map((e, idx) => (
          <div className="line" key={`${e.t}-${idx}`}>
            <span className="t">{fmtSeconds(e.t).padStart(6)}</span>
            <span className={`k ${e.kind}`}>{e.kind.replace("_", " ")}</span>
            <span>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
