import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { performance } from "node:perf_hooks";
import { buildQuestions, type ResolveRequestBody, type SystemOneResponse } from "../src/shared/questions.ts";
import { JevError, systemOne } from "./jev.ts";
import { mockAnswers } from "./mock.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MOCK = process.env.MOCK === "1";
const API_KEY = process.env.TYPESAFE_API_KEY;
const QUESTIONS = buildQuestions();

if (!MOCK && !API_KEY) {
  console.error("\n  TYPESAFE_API_KEY is not set. Export it (or run with MOCK=1 for a clearly-labelled offline mode).\n");
  process.exit(1);
}

export interface ResolveResponse {
  answers: SystemOneResponse["answers"];
  model: string;
  usage: SystemOneResponse["usage"];
  /** Server-side round trip to TypeSafe, ms. */
  jevLatencyMs: number;
  retries: number;
  mock: boolean;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function isResolveBody(v: unknown): v is ResolveRequestBody {
  return typeof v === "object" && v !== null && typeof (v as ResolveRequestBody).query === "string" && typeof (v as ResolveRequestBody).app_state === "object";
}

async function handleResolve(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }
  if (!isResolveBody(body)) return json(res, 400, { error: "expected {query, app_state}" });
  const query = body.query.trim().slice(0, 300);
  if (!query) return json(res, 400, { error: "empty query" });

  const state = { query, app_state: body.app_state };
  const controller = new AbortController();
  req.on("close", () => controller.abort());

  if (MOCK) {
    const t0 = performance.now();
    const answers = mockAnswers(query);
    const out: ResolveResponse = { answers, model: "mock", usage: { input_tokens: 0, output_tokens: 0 }, jevLatencyMs: performance.now() - t0, retries: 0, mock: true };
    return json(res, 200, out);
  }

  try {
    const { response, latencyMs, retries } = await systemOne(API_KEY!, state, QUESTIONS, controller.signal);
    const out: ResolveResponse = { answers: response.answers, model: response.model, usage: response.usage, jevLatencyMs: latencyMs, retries, mock: false };
    json(res, 200, out);
  } catch (err) {
    if (controller.signal.aborted) return;
    if (err instanceof JevError) return json(res, err.status === 401 ? 401 : 502, { error: `TypeSafe ${err.status}: ${err.message}` });
    json(res, 502, { error: err instanceof Error ? err.message : String(err) });
  }
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/resolve") return void handleResolve(req, res);
  if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true, mock: MOCK, questions: Object.keys(QUESTIONS).length });
  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`nl-palette server on http://localhost:${PORT}  (${MOCK ? "MOCK MODE — no real Jev calls" : "live Jev"}, ${Object.keys(QUESTIONS).length} questions per request)`);
});
