import { useEffect, useMemo, useRef, useState } from "react";
import type { Judgment } from "./jev.ts";
import { defaultThresholds, inModQueue, isSpoiler, isStreamerQuestion, modReason, type Thresholds } from "./policy.ts";
import { fmtCompact, fmtInt, fmtMs, histogram, HIST_EDGES } from "./stats.ts";
import { Console, type ModAction, type Row, type Sample } from "./store.ts";
import { streamContext } from "./generator.ts";

const REASON_LABEL: Record<ReturnType<typeof modReason>, string> = { harassment: "harassment", scam: "spam / scam", spoiler: "spoiler", review: "review" };
const LANG_TAG: Record<string, string> = { english: "EN", spanish: "ES", portuguese: "PT", german: "DE", french: "FR", russian: "RU", japanese: "JA", korean: "KO", other: "??" };

export default function App() {
  const [seed, setSeed] = useState(2024);
  const con = useRef<Console>(null);
  if (!con.current) con.current = new Console(seed);
  const c = con.current;

  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(300);
  const [inFlight, setInFlight] = useState(96);
  const [slow, setSlow] = useState(false);
  const [heuristicOnly, setHeuristicOnly] = useState(false);
  const [shield, setShield] = useState(true);
  const [th, setTh] = useState<Thresholds>(defaultThresholds);
  const [sample, setSample] = useState<Sample>(() => c.sample());
  const [, bump] = useState(0);

  c.pool.config.maxInFlight = inFlight;
  c.pool.config.simulatedDelayMs = slow ? 2000 : 0;
  c.heuristicOnly = heuristicOnly;

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      c.tick(rate, now - last);
      last = now;
    }, 50);
    return () => clearInterval(id);
  }, [running, rate, c]);

  useEffect(() => {
    const id = setInterval(() => {
      c.pool.shedStale();
      setSample(c.sample());
    }, 100);
    return () => clearInterval(id);
  }, [c]);

  const judgedRows = useMemo(() => {
    const out: Row[] = [];
    for (let i = c.order.length - 1; i >= 0 && out.length < 2500; i--) {
      const r = c.order[i];
      if (r.judgment) out.push(r);
    }
    return out;
  }, [c, sample]);

  const modQueue = judgedRows.filter((r) => !r.action && inModQueue(r.judgment!, th));
  const streamerFeed = collapseDuplicates(judgedRows.filter((r) => isStreamerQuestion(r.judgment!, th)));
  // anchor the visible window on the newest judged message so rows arrive with their pips
  let end = c.order.length;
  while (end > 0 && !c.order[end - 1].judgment && c.order.length - end < 3000) end--;
  const firehose = c.order.slice(Math.max(0, end - 42), end).reverse();

  const act = (row: Row, action: ModAction) => {
    c.act(row, action, modReason(row.judgment!, th));
    bump((n) => n + 1);
  };

  const reset = () => {
    setRunning(false);
    c.reset(seed);
    setSample(c.sample());
  };

  return (
    <div className="app">
      <header className="bar top">
        <div className="brand">
          <span className="dot" data-on={running} />
          <span className="prompt">$</span> jev-firehose
          <span className="sub">
            --streamer={streamContext.streamer} --game=&quot;{streamContext.game}&quot;
          </span>
        </div>
        <div className="controls">
          <button className={running ? "btn stop" : "btn go"} onClick={() => setRunning((r) => !r)}>
            {running ? "[ pause ]" : "[ start ]"}
          </button>
          <label>
            rate <b>{rate}</b>/s
            <input type="range" min={0} max={1000} step={10} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </label>
          <label>
            in-flight <b>{inFlight}</b>
            <input type="range" min={8} max={256} step={8} value={inFlight} onChange={(e) => setInFlight(Number(e.target.value))} />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> slow LLM +2s
          </label>
          <label className="toggle">
            <input type="checkbox" checked={heuristicOnly} onChange={(e) => setHeuristicOnly(e.target.checked)} /> heuristic only
          </label>
          <label className="seed">
            seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </label>
          <button className="btn" onClick={reset}>
            [ reset ]
          </button>
        </div>
      </header>

      <Strip s={sample} slow={slow} />

      <main className="cols">
        <section className="col pane">
          <h2>
            <span className="title">[0] firehose <span className="count">{fmtCompact(sample.totalIngested)}</span></span>
            <label className="toggle small">
              <input type="checkbox" checked={shield} onChange={(e) => setShield(e.target.checked)} /> spoiler shield
            </label>
            <Slider label="spoiler ≥" value={th.spoiler} onChange={(v) => setTh({ ...th, spoiler: v })} />
          </h2>
          <ul className="feed raw">
            {firehose.map((r) => (
              <li key={r.msg.id} className={r.judgment && shield && isSpoiler(r.judgment, th) ? "row blur" : "row"} data-pending={!r.judgment}>
                <Pips j={r.judgment} th={th} />
                <span className="user">&lt;{r.msg.user}&gt;</span>
                <span className="text">{r.msg.text}</span>
                {r.judgment && <span className="lang">{LANG_TAG[r.judgment.language]}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="col pane active">
          <h2>
            <span className="title">[1] mod-queue <span className="count">{modQueue.length}</span></span>
            <Slider label="mod ≥" value={th.modAttention} onChange={(v) => setTh({ ...th, modAttention: v })} />
            <Slider label="harass ≥" value={th.harassment} onChange={(v) => setTh({ ...th, harassment: v })} />
          </h2>
          <ul className="feed mod">
            {modQueue.slice(0, 40).map((r) => {
              const j = r.judgment!;
              const reason = modReason(j, th);
              return (
                <li key={r.msg.id} className={`row card ${reason}`}>
                  <div className="line">
                    <span className={`badge ${reason}`}>{REASON_LABEL[reason]}</span>
                    <span className="user">&lt;{r.msg.user}&gt;</span>
                    <span className="lang">{LANG_TAG[j.language]}</span>
                    {j.source === "heuristic" && <span className="badge heur">heuristic</span>}
                  </div>
                  <div className="text">{r.msg.text}</div>
                  <div className="bars">
                    <Bar label="harass" v={j.harassment} cls="red" />
                    <Bar label="scam" v={j.spam_or_scam} cls="amber" />
                    <Bar label="spoiler" v={j.spoiler} cls="purple" />
                    <Bar label="mod" v={j.needs_mod_attention} cls="blue" />
                  </div>
                  <div className="actions">
                    <button onClick={() => act(r, "timeout")}>[t]imeout</button>
                    <button onClick={() => act(r, "delete")}>[d]elete</button>
                    <button onClick={() => act(r, "ignore")}>[i]gnore</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="col pane">
          <h2>
            <span className="title">[2] streamer-feed <span className="count">{streamerFeed.length}</span></span>
            <Slider label="question ≥" value={th.question} onChange={(v) => setTh({ ...th, question: v })} />
          </h2>
          <ul className="feed streamer">
            {streamerFeed.slice(0, 40).map(({ row: r, dupes }) => (
              <li key={r.msg.id} className="row q">
                <span className="prob">{Math.round(r.judgment!.question_for_streamer * 100)}</span>
                <div>
                  <div className="line">
                    <span className="user">&lt;{r.msg.user}&gt;</span>
                    <span className="lang">{LANG_TAG[r.judgment!.language]}</span>
                    {dupes > 0 && <span className="dupes">+{dupes} asked the same</span>}
                  </div>
                  <div className="text">{r.msg.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="status">
        <span className="session">[jev]</span>
        <span className="win">0:firehose</span>
        <span className="win cur">1:mod*</span>
        <span className="win">2:streamer</span>
        <span className="stat">
          req <b>{fmtInt(sample.pool.requests)}</b>
        </span>
        <span className="stat">
          429 <b>{fmtInt(sample.pool.rateLimited)}</b>
        </span>
        <span className="stat">
          fail <b>{fmtInt(sample.pool.failed)}</b>
        </span>
        <span className="stat">
          stale <b>{fmtInt(sample.pool.stale)}</b>
        </span>
        <span className="stat">
          fallback <b>{fmtInt(sample.pool.fallback)}</b>
        </span>
        <span className="ticker">
          {c.actionLog[0] ?? "mod actions are logged here"}
          <span className="cursor" />
        </span>
        <Clock />
      </footer>
    </div>
  );
}

function Strip({ s, slow }: { s: Sample; slow: boolean }) {
  const p = s.pool;
  const fallbackPct = p.judged + p.fallback ? (100 * p.fallback) / (p.judged + p.fallback) : 0;
  return (
    <section className="strip">
      <Stat label="ingest /s" value={fmtInt(s.ingestRate)} />
      <Stat label="judged /s" value={fmtInt(s.judgeRate)} accent="green" />
      <Stat label="in-flight" value={fmtInt(p.inFlight)} />
      <Stat label="backlog" value={fmtInt(p.backlog)} accent={p.backlog > 500 ? "red" : undefined} />
      <Stat label="jev p50·p95 ms" value={`${fmtMs(s.apiP50)}·${fmtMs(s.apiP95)}`} sub={`last ${fmtMs(s.lastApiMs)} ms`} accent="blue" />
      <Stat label="e2e p50·p95 ms" value={`${fmtMs(s.e2eP50)}·${fmtMs(s.e2eP95)}`} sub={slow ? "+2 s simulated" : "queue + proxy + jev"} accent={slow ? "amber" : undefined} />
      <Stat label="judged" value={fmtCompact(p.judged)} sub={`${fallbackPct.toFixed(1)}% fallback`} />
      <Stat label="tokens in" value={fmtCompact(p.inputTokens)} sub={`${fmtInt(s.avgTokens)}/msg · ${fmtCompact(s.tokensPerSec)}/s`} />
      <Stat label="cost / hr" value={`$${s.costPerHour.toFixed(2)}`} sub="$0.042 / Mtok in" accent="green" />
      <Histogram values={s.apiLatencies} />
    </section>
  );
}

function collapseDuplicates(rows: Row[]): { row: Row; dupes: number }[] {
  const seen = new Map<string, { row: Row; dupes: number }>();
  for (const row of rows) {
    const key = row.msg.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const hit = seen.get(key);
    if (hit) hit.dupes++;
    else seen.set(key, { row, dupes: 0 });
  }
  return [...seen.values()];
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return (
    <span className="clock">
      "{streamContext.streamer}" {hh}:{mm}
    </span>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="stat-box pane" data-accent={accent}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="th">
      {label} <b>{value.toFixed(2)}</b>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const BAR_CELLS = 12;

function Bar({ label, v, cls }: { label: string; v: number; cls: string }) {
  const on = Math.round(v * BAR_CELLS);
  return (
    <div className="bar-wrap" title={`${label} ${v.toFixed(2)}`}>
      <span>{label}</span>
      <span className={`track ${cls}`}>
        <b>{"█".repeat(on)}</b>
        {"░".repeat(BAR_CELLS - on)}
      </span>
      <em>{v.toFixed(2)}</em>
    </div>
  );
}

function Pips({ j, th }: { j?: Judgment; th: Thresholds }) {
  if (!j) return <span className="pips pending">·····</span>;
  return (
    <span className="pips">
      <i className={j.harassment >= th.harassment ? "on red" : ""} title="harassment">H</i>
      <i className={j.spam_or_scam >= 0.5 ? "on amber" : ""} title="spam/scam">S</i>
      <i className={j.spoiler >= th.spoiler ? "on purple" : ""} title="spoiler">P</i>
      <i className={j.question_for_streamer >= th.question ? "on blue" : ""} title="question">Q</i>
      <i className={j.positive_hype >= 0.7 ? "on green" : ""} title="hype">+</i>
    </span>
  );
}

function Histogram({ values }: { values: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bins = histogram(values);
    const max = Math.max(1, ...bins);
    const bw = w / bins.length;
    bins.forEach((n, i) => {
      const bh = (n / max) * (h - 14);
      const edge = HIST_EDGES[i];
      ctx.fillStyle = edge >= 1000 ? "#ff5c5c" : edge >= 300 ? "#ffb454" : "#3ddc97";
      ctx.fillRect(i * bw + 1, h - 12 - bh, bw - 2, bh);
    });
    ctx.fillStyle = "#7a7a7a";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textBaseline = "bottom";
    for (const i of [0, 4, 7, 9, 11, 14]) ctx.fillText(HIST_EDGES[i] >= 1000 ? `${HIST_EDGES[i] / 1000}s` : `${HIST_EDGES[i]}`, i * bw + 1, h);
  }, [values]);
  return (
    <div className="stat-box pane hist">
      <div className="label">jev latency · n={fmtInt(values.length)}</div>
      <div className="plot">
        <canvas ref={ref} />
      </div>
    </div>
  );
}
