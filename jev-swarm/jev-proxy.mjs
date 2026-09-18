// Server-side proxy for /api/jev. Shared by the Vite dev middleware and server.mjs.
// The TypeSafe key never leaves this process.
import { readFileSync } from "node:fs";

const UPSTREAM = "https://openrouter.ai/api/alpha/decisions";

export function loadApiKey(envPath = new URL("./.env", import.meta.url)) {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*OPENROUTER_API_KEY\s*=\s*"?([^"#\s]+)"?/.exec(line);
      if (m) return m[1];
    }
  } catch {
    /* no .env file */
  }
  return "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Returns a (req, res) handler that forwards the JSON body to TypeSafe. */
export function createJevHandler(apiKey) {
  return async (req, res) => {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    if (!apiKey) return send(res, 500, { error: "OPENROUTER_API_KEY is not set on the server" });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    if (typeof body !== "object" || body === null || !body.questions) {
      return send(res, 400, { error: "expected { state, questions }" });
    }
    const t0 = performance.now();
    try {
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "typesafe/jev-1.13", state: body.state, questions: body.questions }),
      });
      const text = await upstream.text();
      if (!upstream.ok) console.error(`[jev] upstream ${upstream.status}: ${text.slice(0, 200)}`);
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Upstream-Ms", String(Math.round(performance.now() - t0)));
      const retry = upstream.headers.get("retry-after");
      if (retry) res.setHeader("Retry-After", retry);
      res.end(text);
    } catch (err) {
      send(res, 502, { error: String(err instanceof Error ? err.message : err) });
    }
  };
}
