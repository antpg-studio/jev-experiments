import http from "node:http";
import type { Config, ServerMessage } from "../shared/types.ts";
import { createJev } from "./jev.ts";
import { Pipeline } from "./pipeline.ts";
import { REGEX_RULES } from "./regex.ts";

const PORT = Number(process.env.PORT ?? 8787);

let jev;
try {
  jev = createJev();
} catch (err) {
  console.error(`\n[log-sentinel] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const pipeline = new Pipeline(jev);
if (jev.mock) console.warn("[log-sentinel] MOCK=1: replaying fixture labels, NOT calling TypeSafe");

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (msg: ServerMessage) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
    const unsub = pipeline.subscribe(send);
    const ka = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(ka);
      unsub();
    });
    return;
  }

  if (url.pathname === "/api/config" && req.method === "POST") {
    const patch = (await readJson(req)) as Partial<Config>;
    pipeline.setConfig(patch);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(pipeline.config));
  }

  if (url.pathname === "/api/storm" && req.method === "POST") {
    pipeline.triggerStorm();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (url.pathname === "/api/rules") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ rules: REGEX_RULES }));
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, () => {
  console.log(`[log-sentinel] server on http://localhost:${PORT} (${jev.mock ? "MOCK" : "live TypeSafe"})`);
  void pipeline.start();
});
