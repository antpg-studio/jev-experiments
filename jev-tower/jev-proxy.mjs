// Shared by the Vite dev middleware and server.mjs. The API key never leaves this process.
const JEV_URL = "https://api.typesafe.ai/v1/systemone";

/** @param {import("node:http").IncomingMessage} req */
export function readJevBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * @param {string} body raw JSON request body from the browser
 * @param {string | undefined} apiKey
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function forwardToJev(body, apiKey) {
  if (!apiKey) {
    return { status: 503, body: JSON.stringify({ error: "TYPESAFE_API_KEY is not set on the server" }) };
  }
  try {
    const r = await fetch(JEV_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body,
    });
    return { status: r.status, body: await r.text() };
  } catch (err) {
    return { status: 502, body: JSON.stringify({ error: String(err) }) };
  }
}
