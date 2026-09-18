import http from "node:http";
import { judge, JevError } from "./jev.ts";
import type { JudgeRequest } from "../src/lib/types.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MOCK = process.env.MOCK === "1";
const apiKey = process.env.OPENROUTER_API_KEY;

if (!MOCK && !apiKey) {
  console.error("\n  OPENROUTER_API_KEY is not set. The UI will show an error until you export it (or run MOCK=1 npm run dev).\n");
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

const isJudgeRequest = (v: unknown): v is JudgeRequest => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const ch = o.channel as Record<string, unknown> | undefined;
  return typeof o.draft === "string" && Array.isArray(o.spans) && !!ch && typeof ch.name === "string" && typeof ch.audience === "string";
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok: true, mock: MOCK, hasKey: Boolean(apiKey) });

  if (req.method === "POST" && req.url === "/api/judge") {
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ac.abort();
    });
    try {
      const parsed: unknown = JSON.parse(await readBody(req));
      if (!isJudgeRequest(parsed)) return json(res, 400, { error: "bad request" });
      if (parsed.draft.length > 4000) return json(res, 413, { error: "draft too long" });
      const out = await judge(parsed, { apiKey, mock: MOCK, signal: ac.signal });
      return json(res, 200, out);
    } catch (err) {
      if (ac.signal.aborted) return;
      if (err instanceof JevError) return json(res, err.status >= 400 && err.status < 600 ? err.status : 502, { error: err.message });
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`send-guard server on http://localhost:${PORT}${MOCK ? "  [MOCK MODE — no real judgments]" : ""}`);
});
