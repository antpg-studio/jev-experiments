const UPSTREAM = "https://openrouter.ai/api/alpha/decisions";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleJev(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("method not allowed");
    return;
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "OPENROUTER_API_KEY is not set on the server" }));
    return;
  }
  const body = await readBody(req);
  const started = performance.now();
  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body,
    });
    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("content-type", "application/json");
    res.setHeader("x-upstream-ms", (performance.now() - started).toFixed(1));
    res.end(text);
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "upstream failure" }));
  }
}
