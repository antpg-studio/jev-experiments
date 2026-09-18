import { createHash } from "node:crypto";
import https from "node:https";

// Shared by the Vite dev middleware and server.mjs. Two entry points, one
// upstream: each item becomes exactly one Jev request (one state per call),
// fanned out concurrently over a keep-alive connection pool.
//   POST /api/jev     { questions, items: [{ id, state }] } -> { results }
//   WS   /api/jev/ws  {"questions"} once, then {"id","state"} per message;
//                     each result is pushed back the moment it completes, so a
//                     slow answer never holds up the fast ones behind it.
// The key never leaves this process.

const UPSTREAM = new URL("https://openrouter.ai/api/alpha/decisions");
const agent = new https.Agent({ keepAlive: true, maxSockets: 512, maxFreeSockets: 256, timeout: 30_000 });

function callJev(key, body) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const payload = JSON.stringify(body);
    const req = https.request(
      UPSTREAM,
      {
        method: "POST",
        agent,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const ms = performance.now() - t0;
          const text = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            const ra = Number(res.headers["retry-after"]);
            return resolve({ ok: false, status: res.statusCode, ms, error: text.slice(0, 200), retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined });
          }
          try {
            const json = JSON.parse(text);
            resolve({ ok: true, ms, answers: json.answers, usage: json.usage, model: json.model });
          } catch {
            resolve({ ok: false, status: 502, ms, error: "bad json from upstream" });
          }
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, status: 502, ms: performance.now() - t0, error: e.message }));
    req.end(payload);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429/529 are backpressure, not failures: retry with exponential backoff
// (honoring retry-after when present), then give up so the client can fall back.
async function callJevWithRetry(key, body, maxAttempts = 4) {
  let attempt = 0;
  for (;;) {
    const r = await callJev(key, body);
    if (r.ok || (r.status !== 429 && r.status !== 529) || attempt >= maxAttempts - 1) return { ...r, retries: attempt };
    const wait = Math.min(1000, 150 * 2 ** attempt) + Math.random() * 100;
    await sleep(r.retryAfterMs ?? wait);
    attempt++;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export async function handleJev(req, res) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return send(res, 500, { error: "OPENROUTER_API_KEY is not set on the server" });
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: "invalid json" });
  }
  const { questions, items } = parsed ?? {};
  if (!questions || !Array.isArray(items) || items.length === 0 || items.length > 64) {
    return send(res, 400, { error: "expected { questions, items: [1..64] }" });
  }
  const results = await Promise.all(items.map((it) => judgeItem(key, questions, it)));
  send(res, 200, { results });
}

async function judgeItem(key, questions, it) {
  const r = await callJevWithRetry(key, { state: it.state, model: "typesafe/jev-1.13", questions });
  return { id: it.id, ok: r.ok, status: r.status, ms: r.ms, retries: r.retries, answers: r.answers, usage: r.usage, error: r.error };
}

// --- minimal RFC 6455 server (text frames only), so no ws dependency is needed ---

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function encodeTextFrame(str) {
  const payload = Buffer.from(str, "utf8");
  const n = payload.length;
  let header;
  if (n < 126) header = Buffer.from([0x81, n]);
  else if (n < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(n, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Parse as many complete frames as `buf` holds. Returns { frames, rest }. */
export function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const maskKey = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (maskKey) for (let i = 0; i < len; i++) payload[i] ^= maskKey[i & 3];
    frames.push({ fin, opcode, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

function handleSocket(socket, key) {
  let buf = Buffer.alloc(0);
  let fragments = [];
  let questions = null;
  let open = true;
  const write = (obj) => {
    if (open) socket.write(encodeTextFrame(JSON.stringify(obj)));
  };
  const onText = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return write({ error: "invalid json" });
    }
    if (msg.questions) {
      questions = msg.questions;
      return;
    }
    if (!questions) return write({ id: msg.id, ok: false, status: 400, ms: 0, error: "send { questions } first" });
    if (typeof msg.id !== "string") return write({ error: "expected { id, state }" });
    void judgeItem(key, questions, msg).then(write);
  };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = decodeFrames(buf);
    buf = rest;
    for (const f of frames) {
      if (f.opcode === 0x8) {
        open = false;
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (f.opcode === 0x9) {
        socket.write(Buffer.concat([Buffer.from([0x8a, f.payload.length]), f.payload]));
        continue;
      }
      if (f.opcode === 0x1 || f.opcode === 0x0) {
        fragments.push(f.payload);
        if (f.fin) {
          const text = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          onText(text);
        }
      }
    }
  });
  socket.on("close", () => {
    open = false;
  });
  socket.on("error", () => {
    open = false;
  });
}

/** Handle WebSocket upgrades for `/api/jev/ws` on an existing http.Server. */
export function attachJevSocket(httpServer, path = "/api/jev/ws") {
  httpServer.on("upgrade", (req, socket) => {
    if (new URL(req.url, "http://x").pathname !== path) return;
    const key = process.env.OPENROUTER_API_KEY;
    const wsKey = req.headers["sec-websocket-key"];
    if (!key || !wsKey || req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.end(`HTTP/1.1 ${key ? 400 : 500} ${key ? "Bad Request" : "OPENROUTER_API_KEY is not set"}\r\n\r\n`);
      return;
    }
    const accept = createHash("sha1").update(wsKey + WS_MAGIC).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    handleSocket(socket, key);
  });
}
