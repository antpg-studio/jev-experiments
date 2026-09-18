// Prints the whole 30-candidate shortlist for one query in both columns (live API).
// Usage: TYPESAFE_API_KEY=... node bench/dump.ts "quiet keyboard for open office"
import { generateCatalog } from "../src/catalog.ts";
import { buildRequest, parseAnswers, type JevResponse } from "../src/jev.ts";
import { combine, DEFAULT_WEIGHTS, lexicalOnly } from "../src/rank.ts";
import { createIndex, search } from "../src/retriever.ts";

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY not set");
const query = process.argv[2];
if (!query) throw new Error("usage: node bench/dump.ts <query>");

const catalog = generateCatalog();
const index = createIndex(catalog);
const byId = new Map(catalog.map((p) => [p.id, p]));
const hits = search(index, byId, query);
const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify(buildRequest(query, hits.map((h) => h.product))),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const json = (await res.json()) as JevResponse;
const answers = parseAnswers(query, hits.map((h) => h.product), json);
console.log(`usage: ${json.usage.input_tokens} in / ${json.usage.output_tokens} out`);
const left = lexicalOnly(hits).items;
const right = combine(hits, answers, DEFAULT_WEIGHTS).items;
for (let i = 0; i < hits.length; i++) {
  const l = left[i];
  const r = right[i];
  const desc = (p: typeof l.product) => p.description.split(". ")[0].slice(0, 50);
  console.log(
    `${String(i + 1).padStart(2)} | ${l.product.title.padEnd(42)} ${desc(l.product).padEnd(50)} | ${r.product.title.padEnd(42)} ${desc(r.product).padEnd(50)} ${r.relevance?.score.toFixed(2) ?? "-"}${r.belowFloor ? " floor" : ""}`
  );
}
