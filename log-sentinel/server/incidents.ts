import { SEVERITIES, type Incident, type Judgment, type LogEvent } from "../shared/types.ts";

/**
 * `same_incident_as_recent` is decided in code, not by inference: actionable events from the same
 * service with the same root-cause category within `windowMs` of the incident's last event belong to
 * the same incident. Severity is the max seen so far.
 */
export class IncidentTracker {
  private incidents = new Map<string, Incident>();
  constructor(private windowMs = 60_000, private maxIncidents = 40) {}

  add(event: LogEvent, j: Judgment): Incident | null {
    if (!j.actionable) return null;
    const key = `${event.service}:${j.category}`;
    const existing = this.incidents.get(key);
    if (existing && event.ts - existing.lastSeen <= this.windowMs) {
      existing.lastSeen = event.ts;
      existing.count += 1;
      existing.eventIds.push(event.id);
      if (existing.eventIds.length > 50) existing.eventIds.shift();
      if (SEVERITIES.indexOf(j.severity) > SEVERITIES.indexOf(existing.severity)) {
        existing.severity = j.severity;
        existing.sample = event.line.split("\n")[0];
      }
      existing.security ||= j.security;
      return existing;
    }
    if (existing) this.incidents.delete(key);
    const inc: Incident = {
      key: `${key}:${event.id}`,
      service: event.service,
      category: j.category,
      severity: j.severity,
      firstSeen: event.ts,
      lastSeen: event.ts,
      count: 1,
      security: j.security,
      sample: event.line.split("\n")[0],
      eventIds: [event.id],
    };
    this.incidents.set(key, inc);
    return inc;
  }

  /** Open incidents, most severe and most recent first. */
  list(now = Date.now()): Incident[] {
    const out = [...this.incidents.values()]
      .filter((i) => now - i.lastSeen <= this.windowMs * 3)
      .sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || b.lastSeen - a.lastSeen);
    return out.slice(0, this.maxIncidents);
  }

  clear(): void {
    this.incidents.clear();
  }
}
