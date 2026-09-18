import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { BUCKETS, RAID_BUCKETS, generateLine, makeRng, makeUsers } from "../shared/corpus.ts";
import type { ChatMessage, ClientCommand, ServerEvent, ServerStats, Truth } from "../shared/types.ts";
import { createJevClient, createMockJevClient, type JevClient } from "./jev.ts";
import { Limiter } from "./limiter.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MOCK = process.env.MOCK === "1";
const SEED = Number(process.env.SEED ?? 20260917);

// ---- Jev client ----------------------------------------------------------------

const truthByText = new Map<string, Truth>();
for (const b of BUCKETS) for (const l of b.lines) truthByText.set(l, b.truth);
const lookupTruth = (text: string): Truth | undefined => truthByText.get(text) ?? truthByText.get(text.replace(/@\S+/, "@{u}"));

let jev: JevClient;
if (MOCK) {
  jev = createMockJevClient(lookupTruth);
  console.log("[modstream] MOCK=1 — replaying canned judgments, no TypeSafe calls");
} else {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error(
      "\n[modstream] OPENROUTER_API_KEY is not set.\n  export OPENROUTER_API_KEY=...   (real Jev judgments, the default)\n  MOCK=1 npm run dev           (offline canned judgments, clearly labelled in the UI)\n",
    );
    process.exit(1);
  }
  jev = createJevClient(key);
}

// ---- simulator state -----------------------------------------------------------

const rng = makeRng(SEED);
const users = makeUsers(1000, rng);
const limiter = new Limiter(Number(process.env.CONCURRENCY ?? 16));
let rate = 12; // msg/s
let running = false;
let nextId = 1;
let raidRemaining = 0;
let totalJudged = 0;
let totalErrors = 0;
const lastTextByUser = new Map<string, { text: string; count: number }>();

const clients = new Set<WebSocket>();
const broadcast = (ev: ServerEvent) => {
  const data = JSON.stringify(ev);
  for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(data);
};

const stats = (): ServerStats => ({
  inFlight: limiter.inFlight,
  queued: limiter.queued,
  concurrency: limiter.concurrency,
  rate,
  running,
  mock: jev.mock,
  raidRemaining,
  totalJudged,
  totalErrors,
});

/** HOLD → judge → RELEASE. The message is only broadcast once Jev has answered. */
async function moderate(text: string, truth: Truth, raid: boolean): Promise<void> {
  const user = users[Math.floor(rng() * users.length)];
  const arrived = performance.now();
  const dup = lastTextByUser.get(user.name);
  const recentDuplicates = dup && dup.text === text ? dup.count : 0;
  lastTextByUser.set(user.name, { text, count: recentDuplicates + 1 });

  const msg: ChatMessage = {
    id: nextId++,
    user: user.name,
    color: user.color,
    text,
    truth,
    ts: Date.now(),
    raid,
    judgment: null,
    error: null,
    timing: { queuedMs: 0, jevMs: 0, heldMs: 0, retries: 0 },
  };

  await limiter.run(async (queuedMs) => {
    msg.timing.queuedMs = queuedMs;
    try {
      const r = await jev.judge({ text, user: user.name, recentDuplicatesFromUser: recentDuplicates });
      msg.judgment = r.judgment;
      msg.timing.jevMs = r.latencyMs;
      msg.timing.retries = r.retries;
      totalJudged++;
    } catch (err) {
      msg.error = (err as Error).message;
      totalErrors++;
    }
  });
  msg.timing.heldMs = performance.now() - arrived;
  broadcast({ type: "message", message: msg });
}

let loopTimer: NodeJS.Timeout | null = null;
function scheduleNext(): void {
  if (!running) return;
  // Poisson-ish arrivals around the target rate.
  const meanGap = 1000 / rate;
  const gap = Math.max(4, -Math.log(1 - rng()) * meanGap);
  loopTimer = setTimeout(() => {
    if (!running) return;
    const line = generateLine(rng, users);
    void moderate(line.text, line.truth, false);
    scheduleNext();
  }, gap);
}

function start(): void {
  if (running) return;
  running = true;
  scheduleNext();
  broadcast({ type: "stats", stats: stats() });
}
function stop(): void {
  running = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  broadcast({ type: "stats", stats: stats() });
}

/** Dump `count` raid messages onto the queue in ~1.5 s regardless of the slider. */
function raid(count: number): void {
  raidRemaining += count;
  const gap = 1500 / count;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const line = generateLine(rng, users, RAID_BUCKETS);
      raidRemaining--;
      void moderate(line.text, line.truth, true);
    }, i * gap);
  }
}

// ---- http + ws -----------------------------------------------------------------

const here = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(here, "..", "dist");
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...stats() }));
    return;
  }
  // Serve a production build when present (npm run build && npm run server).
  if (existsSync(distDir)) {
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = normalize(join(distDir, rel));
    if (file.startsWith(distDir) && existsSync(file)) {
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
      return;
    }
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", stats: stats() } satisfies ServerEvent));
  ws.on("message", (raw) => {
    let cmd: ClientCommand;
    try {
      cmd = JSON.parse(String(raw)) as ClientCommand;
    } catch {
      return;
    }
    switch (cmd.type) {
      case "start":
        start();
        break;
      case "stop":
        stop();
        break;
      case "set_rate":
        rate = Math.min(60, Math.max(1, Number(cmd.rate) || 1));
        break;
      case "set_concurrency":
        limiter.setLimit(Math.min(64, Math.max(1, Number(cmd.concurrency) || 1)));
        break;
      case "raid":
        raid(Math.min(600, Math.max(10, Number(cmd.count) || 150)));
        break;
    }
    broadcast({ type: "stats", stats: stats() });
  });
  ws.on("close", () => {
    clients.delete(ws);
    if (clients.size === 0) stop();
  });
});

setInterval(() => {
  if (clients.size > 0) broadcast({ type: "stats", stats: stats() });
}, 250);

server.listen(PORT, () => {
  console.log(`[modstream] server on http://localhost:${PORT}  (ws://localhost:${PORT}/ws)  mock=${jev.mock}`);
});
