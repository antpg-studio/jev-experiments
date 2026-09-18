import type { Sample } from "./useGuard";
import { histogram, summarize } from "./lib/stats";

const BUCKET_MS = 25;
const MAX_MS = 500;

interface Props {
  samples: Sample[];
  cancelled: number;
}

const ms = (v: number) => `${Math.round(v)} ms`;

export default function Latency({ samples, cancelled }: Props) {
  const client = summarize(
    samples.map((s) => s.clientMs),
    samples.map((s) => s.judgments),
  );
  const api = summarize(
    samples.map((s) => s.apiMs),
    samples.map((s) => s.judgments),
  );
  const buckets = histogram(
    samples.map((s) => s.clientMs),
    BUCKET_MS,
    MAX_MS,
  );
  const peak = Math.max(1, ...buckets.map((b) => b.count));
  const totalJudgments = samples.reduce((a, s) => a + s.judgments, 0);

  return (
    <section className="latency">
      <div className="latency-stats">
        <Stat label="pauses judged" value={String(client.count)} />
        <Stat label="judgments" value={String(totalJudgments)} />
        <Stat label="p50 end-to-end" value={ms(client.p50)} accent />
        <Stat label="p95 end-to-end" value={ms(client.p95)} accent />
        <Stat label="p50 API round trip" value={ms(api.p50)} />
        <Stat label="p95 API round trip" value={ms(api.p95)} />
        <Stat label="judgments / s" value={client.judgmentsPerSecond.toFixed(0)} />
        <Stat label="stale cancelled" value={String(cancelled)} />
      </div>
      <div className="histogram" aria-label="End-to-end latency histogram">
        {buckets.map((b) => (
          <div key={b.from} className="bar-col" title={`${b.from}–${b.to} ms: ${b.count}`}>
            <div className="bar" style={{ height: `${(b.count / peak) * 100}%` }} />
            {b.from % 100 === 0 && <span className="bar-tick">{b.from}</span>}
          </div>
        ))}
        <span className="bar-tick bar-tick-end">{MAX_MS}+ ms</span>
      </div>
    </section>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "stat-accent" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
