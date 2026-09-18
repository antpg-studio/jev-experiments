// Live benchmark: batching vs concurrency for re-ranking 30 candidates.
// Usage: OPENROUTER_API_KEY=... node bench/latency.ts
import { generateCatalog } from "../src/catalog.ts";
import { buildRequest, type JevRequest, type JevResponse } from "../src/jev.ts";
import { createIndex, search } from "../src/retriever.ts";
import { EXAMPLES } from "../src/examples.ts";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY not set");

const catalog = generateCatalog();
const index = createIndex(catalog);
const byId = new Map(catalog.map((p) => [p.id, p]));

let rateLimited = 0;

async function call(req: JevRequest, attempt = 0): Promise<JevResponse> {
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 429 && attempt < 3) {
    rateLimited++;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    return call(req, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as JevResponse;
}

function pct(xs: number[], p: number) {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

async function run(batchSize: number, rounds: number) {
  const wall: number[] = [];
  let tokens = 0;
  let requests = 0;
  const limitedBefore = rateLimited;
  for (let r = 0; r < rounds; r++) {
    const query = EXAMPLES[r % EXAMPLES.length];
    const hits = search(index, byId, query).map((h) => h.product);
    const batches: JevRequest[] = [];
    for (let i = 0; i < hits.length; i += batchSize) batches.push(buildRequest(query, hits.slice(i, i + batchSize), i === 0));
    const t0 = performance.now();
    const out = await Promise.all(batches.map(call));
    wall.push(performance.now() - t0);
    requests += batches.length;
    tokens += out.reduce((a, o) => a + o.usage.input_tokens, 0);
  }
  return {
    batchSize,
    requestsPerKeystroke: requests / rounds,
    p50: pct(wall, 50),
    p95: pct(wall, 95),
    tokensPerKeystroke: tokens / rounds,
    rateLimited: rateLimited - limitedBefore,
  };
}

const rounds = Number(process.argv[2] ?? 10);
await run(30, 2); // warm-up
const rows = [];
for (const b of [30, 15, 10, 5, 1]) rows.push(await run(b, rounds));
console.log(`\n${rounds} keystrokes per row, rotating the 5 example queries, 30 candidates each\n`);
console.log("| batch size | requests / keystroke | wall p50 (ms) | wall p95 (ms) | input tokens / keystroke | 429s (retried) |");
console.log("|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.batchSize} | ${r.requestsPerKeystroke} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${Math.round(r.tokensPerKeystroke).toLocaleString()} | ${r.rateLimited} |`
  );
}
