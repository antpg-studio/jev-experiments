import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HAS_KEY, MOCK, judge } from "./jev.ts";
import type { JudgeRequest } from "../src/lib/questions.ts";

const PORT = Number(process.env.PORT ?? 8787);

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isJudgeRequest(v: unknown): v is JudgeRequest {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.chatId === "string" &&
    typeof o.messageIndex === "number" &&
    Array.isArray(o.conversation) &&
    typeof o.customer === "object" &&
    o.customer !== null
  );
}

function errorStatus(err: unknown): number {
  if (typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return 502;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, mock: MOCK, hasKey: HAS_KEY, model: "jev-latest" });
  }
  if (req.method === "POST" && url.pathname === "/api/judge") {
    if (!MOCK && !HAS_KEY) {
      return send(res, 503, {
        error: "TYPESAFE_API_KEY is not set. Export it before starting the server, or run with MOCK=1 for canned answers.",
      });
    }
    try {
      const body = await readJson(req);
      if (!isJudgeRequest(body)) return send(res, 400, { error: "Invalid judge request" });
      const result = await judge(body);
      return send(res, 200, result);
    } catch (err) {
      const status = errorStatus(err);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[judge] ${status} ${message}`);
      return send(res, status === 429 || status === 529 ? status : 502, { error: message, status });
    }
  }
  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  const mode = MOCK ? "MOCK answers (no API calls)" : HAS_KEY ? "live Jev (jev-latest)" : "NO API KEY — /api/judge will return 503";
  console.log(`[agent-assist] proxy listening on http://localhost:${PORT}  mode: ${mode}`);
});
