// Server-side proxy for the TypeSafe API. The browser only ever calls /api/jev;
// the key stays in the Node process. Used by vite.config.ts (dev) and server.mjs (preview).

const UPSTREAM = "https://api.typesafe.ai/v1/systemone";

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleJev(req, res) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "TYPESAFE_API_KEY is not set on the server" }));
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }
  const body = await readBody(req);
  const started = performance.now();
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
    });
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: `upstream unreachable: ${err instanceof Error ? err.message : String(err)}` }));
    return;
  }
  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader("content-type", "application/json");
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) res.setHeader("retry-after", retryAfter);
  res.setHeader("x-upstream-ms", String(Math.round(performance.now() - started)));
  res.end(text);
}
