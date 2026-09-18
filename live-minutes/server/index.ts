import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HealthResponse, JudgeAnswers, JudgeRequest, JudgeResponse } from "../src/lib/types.ts";
import { JevError, judgeUtterance } from "./jev.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MOCK = process.env.MOCK === "1";
const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";

const here = dirname(fileURLToPath(import.meta.url));
const mockPath = join(here, "mock-answers.json");
const mockAnswers: Record<string, JudgeAnswers> =
  MOCK && existsSync(mockPath) ? JSON.parse(readFileSync(mockPath, "utf8")) : {};

export const hashUtterance = (text: string) => createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);

if (!MOCK && !apiKey) {
  console.error("\n  OPENROUTER_API_KEY is not set. Export it and restart, or run with MOCK=1 for recorded answers.\n");
}
if (MOCK) console.log(`  MOCK mode: ${Object.keys(mockAnswers).length} recorded answers loaded (no real API calls).`);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function fallbackMockAnswers(): JudgeAnswers {
  return {
    kind: { type: "choice", choice: "chit_chat", probabilities: { chit_chat: 1 }, confidence: 1 },
    assignee: { type: "choice", choice: "unassigned", probabilities: { unassigned: 1 }, confidence: 1 },
    has_deadline: { type: "noul", noul: 0 },
    deadline_kind: { type: "choice", choice: "none", probabilities: { none: 1 }, confidence: 1 },
    reverses_earlier_decision: { type: "noul", noul: 0 },
    is_blocked: { type: "noul", noul: 0 },
    importance: { type: "score", score: 0, legend: { "0": "Trivial" }, probabilities: { "0": 1 }, confidence: 1 },
  };
}

async function handleJudge(req: IncomingMessage, res: ServerResponse) {
  let body: JudgeRequest;
  try {
    body = JSON.parse(await readBody(req)) as JudgeRequest;
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  if (typeof body.utterance !== "string" || !body.utterance.trim()) return json(res, 400, { error: "utterance required" });

  if (MOCK) {
    const t0 = performance.now();
    const answers = mockAnswers[hashUtterance(body.utterance)] ?? fallbackMockAnswers();
    const out: JudgeResponse = { answers, apiMs: performance.now() - t0, mock: true };
    return json(res, 200, out);
  }
  if (!apiKey) return json(res, 503, { error: "OPENROUTER_API_KEY is not set on the server" });

  try {
    const r = await judgeUtterance(body, apiKey);
    const out: JudgeResponse = { answers: r.answers, apiMs: r.apiMs, mock: false, usage: r.usage };
    json(res, 200, out);
  } catch (e) {
    if (e instanceof JevError) return json(res, e.status === 401 ? 401 : 502, { error: `TypeSafe ${e.status}: ${e.message}` });
    json(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/api/health") {
    const out: HealthResponse = { ok: true, hasKey: Boolean(apiKey), mock: MOCK };
    return json(res, 200, out);
  }
  if (req.method === "POST" && url === "/api/judge") return handleJudge(req, res);
  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`  live-minutes proxy listening on http://127.0.0.1:${PORT} (${MOCK ? "MOCK" : apiKey ? "real Jev" : "NO KEY"})`);
});
