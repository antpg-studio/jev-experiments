// Minimal production server: serves dist/ and proxies POST /api/jev to TypeSafe.
// The API key stays on this process; the browser only ever talks to /api/jev.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
const PORT = Number(process.env.PORT ?? 4173);
const DIST = new URL("./dist/", import.meta.url).pathname;

async function loadKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = new URL("./.env", import.meta.url).pathname;
  if (!existsSync(envPath)) return undefined;
  const text = await readFile(envPath, "utf8");
  const line = text.split("\n").find((l) => l.startsWith("OPENROUTER_API_KEY="));
  return line ? line.slice("OPENROUTER_API_KEY=".length).trim().replace(/^["']|["']$/g, "") : undefined;
}

const apiKey = await loadKey();
if (!apiKey) console.warn("OPENROUTER_API_KEY not set: /api/jev will return 503 and the app will use its fallback heuristic");
if (!existsSync(DIST)) console.warn("dist/ not found: run `npm run build` first");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

createServer(async (req, res) => {
  if (req.url === "/api/jev") {
    if (req.method !== "POST") return void res.writeHead(405).end();
    if (!apiKey) {
      res.writeHead(503, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ error: "OPENROUTER_API_KEY is not set on the server" }));
    }
    try {
      const upstream = await fetch(JEV_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: await readBody(req),
      });
      res.writeHead(upstream.status, { "content-type": "application/json" });
      return void res.end(await upstream.text());
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ error: err instanceof Error ? err.message : "proxy failure" }));
    }
  }
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
  let file = join(DIST, path === "/" ? "index.html" : path);
  if (!file.startsWith(DIST) || !existsSync(file)) file = join(DIST, "index.html");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, "0.0.0.0", () => console.log(`jev-dispatch on http://localhost:${PORT}`));
