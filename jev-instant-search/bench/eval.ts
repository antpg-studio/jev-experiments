// Offline relevance eval: top-5 for the 5 example queries, lexical-only vs lexical+Jev, using the live API once per query.
// Usage: TYPESAFE_API_KEY=... node bench/eval.ts
import { generateCatalog } from "../src/catalog.ts";
import { EXAMPLES } from "../src/examples.ts";
import { buildRequest, parseAnswers, type JevResponse } from "../src/jev.ts";
import { combine, DEFAULT_WEIGHTS, lexicalOnly, type RankedItem } from "../src/rank.ts";
import { createIndex, search } from "../src/retriever.ts";

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY not set");

const catalog = generateCatalog();
const index = createIndex(catalog);
const byId = new Map(catalog.map((p) => [p.id, p]));

const row = (it: RankedItem) => {
  const rel = it.relevance ? ` · rel ${it.relevance.score.toFixed(2)}` : "";
  const hint = it.product.description.split(". ")[0];
  return `${it.product.title} ($${it.product.price.toFixed(0)}) — ${hint}${rel}`;
};

for (const query of EXAMPLES) {
  const t0 = performance.now();
  const hits = search(index, byId, query);
  const retrieverMs = performance.now() - t0;
  const t1 = performance.now();
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(buildRequest(query, hits.map((h) => h.product))),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const json = (await res.json()) as JevResponse;
  const jevMs = performance.now() - t1;
  const answers = parseAnswers(query, hits.map((h) => h.product), json);
  const left = lexicalOnly(hits);
  const right = combine(hits, answers, DEFAULT_WEIGHTS);
  const q = answers.query;
  console.log(`\n### "${query}"\n`);
  console.log(`retriever ${retrieverMs.toFixed(1)} ms · jev ${jevMs.toFixed(0)} ms · ${json.usage.input_tokens} input tokens · ${json.model}`);
  console.log(`intent ${q.intent} (${(q.intentConfidence * 100).toFixed(0)}%) · cheap ${q.wantsCheap.toFixed(2)} · premium ${q.wantsPremium.toFixed(2)} · gift ${q.isGift.toFixed(2)} · sort ${q.sort} (${(q.sortConfidence * 100).toFixed(0)}%) → applied ${right.appliedSort}\n`);
  console.log("| # | Lexical only | Lexical + Jev |");
  console.log("|---|---|---|");
  for (let i = 0; i < 5; i++) console.log(`| ${i + 1} | ${row(left.items[i])} | ${row(right.items[i])} |`);
}
