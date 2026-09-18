import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMAILS } from "../src/data/emails.ts";
import type { Email, JudgmentResult, LabelStreamEvent, StreamEvent } from "../src/lib/types.ts";
import { judgeEmail, matchEmail, MODEL, type JudgeOutcome } from "./jev.ts";

const MAX_INTENT_CHARS = 200;

const PORT = Number(process.env.PORT ?? 8787);
const MOCK = process.env.MOCK === "1";
const RECORD_MOCK = process.env.RECORD_MOCK === "1";
const API_KEY = process.env.TYPESAFE_API_KEY ?? "";
const MOCK_PATH = join(dirname(fileURLToPath(import.meta.url)), "mock-answers.json");

type Recorded = Record<string, Omit<JudgeOutcome, "model">>;

function loadMock(): Recorded {
  if (!existsSync(MOCK_PATH)) {
    console.error(`MOCK=1 but ${MOCK_PATH} is missing. Run once against the real API with RECORD_MOCK=1 first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(MOCK_PATH, "utf8")) as Recorded;
}
const mockAnswers: Recorded | null = MOCK ? loadMock() : null;

if (!MOCK && !API_KEY) {
  console.error("\n  TYPESAFE_API_KEY is not set. Export it (or run with MOCK=1 to replay recorded answers).\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function judge(email: Email, signal: AbortSignal): Promise<JudgeOutcome> {
  if (mockAnswers) {
    const rec = mockAnswers[email.id];
    if (!rec) throw new Error(`no recorded answer for ${email.id}`);
    const t0 = performance.now();
    await sleep(rec.latencyMs);
    return { ...rec, latencyMs: performance.now() - t0, model: "mock-replay" };
  }
  return judgeEmail(email, API_KEY, signal);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleTriage(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let concurrency = 12;
  let ids: string[] | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as { concurrency?: number; ids?: string[] }) : {};
    if (typeof parsed.concurrency === "number") concurrency = Math.max(1, Math.min(32, parsed.concurrency));
    if (Array.isArray(parsed.ids)) ids = parsed.ids;
  } catch {
    json(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (!MOCK && !API_KEY) {
    json(res, 500, { error: "TYPESAFE_API_KEY is not set on the server. Export it and restart `npm run dev`." });
    return;
  }

  const emails = ids ? EMAILS.filter((e) => ids!.includes(e.id)) : EMAILS;
  const ac = new AbortController();
  res.on("close", () => ac.abort());

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    "Transfer-Encoding": "chunked",
  });
  const send = (ev: StreamEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(ev) + "\n");
  };

  send({ type: "start", total: emails.length, concurrency, mock: MOCK, model: MOCK ? "mock-replay" : MODEL });
  const t0 = performance.now();
  const recorded: Recorded = {};
  let next = 0;

  async function worker() {
    while (next < emails.length && !ac.signal.aborted) {
      const email = emails[next++];
      try {
        const out = await judge(email, ac.signal);
        const result: JudgmentResult = {
          id: email.id,
          judgment: out.judgment,
          latencyMs: out.latencyMs,
          inputTokens: out.inputTokens,
          retries: out.retries,
        };
        if (RECORD_MOCK) recorded[email.id] = { judgment: out.judgment, latencyMs: out.latencyMs, inputTokens: out.inputTokens, retries: 0 };
        send({ type: "result", ...result });
      } catch (err) {
        if (ac.signal.aborted) return;
        send({ type: "error", id: email.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  send({ type: "done", elapsedMs: performance.now() - t0 });
  res.end();

  if (RECORD_MOCK && !MOCK && Object.keys(recorded).length === EMAILS.length) {
    writeFileSync(MOCK_PATH, JSON.stringify(recorded));
    console.log(`recorded ${Object.keys(recorded).length} answers to ${MOCK_PATH}`);
  }
}

/**
 * Natural-language labelling: one noul question ("does this email match the
 * operator's description?") per email, streamed as NDJSON. Recorded mock
 * answers only cover the fixed triage questions, so this endpoint is live-only.
 */
async function handleLabel(req: IncomingMessage, res: ServerResponse) {
  const raw = await readBody(req);
  let concurrency = 12;
  let intent = "";
  try {
    const parsed = raw ? (JSON.parse(raw) as { concurrency?: number; intent?: string }) : {};
    if (typeof parsed.concurrency === "number") concurrency = Math.max(1, Math.min(32, parsed.concurrency));
    if (typeof parsed.intent === "string") intent = parsed.intent.trim().slice(0, MAX_INTENT_CHARS);
  } catch {
    json(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (!intent) {
    json(res, 400, { error: "intent is required" });
    return;
  }
  if (MOCK) {
    json(res, 400, { error: "Natural-language labels need live inference — restart without MOCK=1." });
    return;
  }
  if (!API_KEY) {
    json(res, 500, { error: "TYPESAFE_API_KEY is not set on the server. Export it and restart `npm run dev`." });
    return;
  }

  const ac = new AbortController();
  res.on("close", () => ac.abort());
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    "Transfer-Encoding": "chunked",
  });
  const send = (ev: LabelStreamEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(ev) + "\n");
  };

  send({ type: "start", total: EMAILS.length, concurrency, mock: false, model: MODEL, intent });
  const t0 = performance.now();
  let next = 0;

  async function worker() {
    while (next < EMAILS.length && !ac.signal.aborted) {
      const email = EMAILS[next++];
      try {
        const out = await matchEmail(email, intent, API_KEY, ac.signal);
        send({ type: "match", id: email.id, match: out.match, latencyMs: out.latencyMs, inputTokens: out.inputTokens, retries: out.retries });
      } catch (err) {
        if (ac.signal.aborted) return;
        send({ type: "error", id: email.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  send({ type: "done", elapsedMs: performance.now() - t0 });
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true, hasKey: Boolean(API_KEY), mock: MOCK, model: MOCK ? "mock-replay" : MODEL, emails: EMAILS.length });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/triage") {
      await handleTriage(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/label") {
      await handleLabel(req, res);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : "internal error" });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`inbox-blitz server on http://localhost:${PORT}  mode=${MOCK ? "MOCK (replaying recorded answers)" : "live TypeSafe"}  key=${API_KEY ? "present" : "MISSING"}`);
});
