import http from "node:http";
import { BENCH_QUERIES } from "../shared/bench-queries.ts";
import { runBenchQuery, summarize } from "../shared/bench.ts";
import type { BenchRow, SearchResponse } from "../shared/types.ts";
import { BATCHES, describeError, MOCK, rerank } from "./jev.ts";
import { bm25Response, bm25Search, byId, corpusSize } from "./search.ts";

const PORT = Number(process.env.PORT ?? 8787);

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sse(res: http.ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  return (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function search(query: string): Promise<SearchResponse> {
  const { hits, bm25Ms } = bm25Search(query);
  if (!hits.length) {
    return {
      query,
      results: [],
      answerExists: 0,
      timing: { bm25Ms, jevMs: 0, totalMs: bm25Ms, batches: 0, inputTokens: 0, outputTokens: 0 },
      mock: MOCK,
    };
  }
  const r = await rerank(query, hits, byId, bm25Ms);
  console.log(`[server] "${query}" bm25 ${bm25Ms.toFixed(2)} ms · jev ${r.timing.jevMs.toFixed(0)} ms (${hits.length} candidates, ${r.timing.inputTokens} tok) · exists ${r.answerExists.toFixed(2)} · #1 ${r.results[0]?.id}`);
  return { query, ...r };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/health") {
      return json(res, 200, { ok: true, mock: MOCK, corpusSize, batches: BATCHES, hasKey: Boolean(process.env.OPENROUTER_API_KEY) });
    }
    if (url.pathname === "/api/bm25") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      return json(res, 200, bm25Response(q));
    }
    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (!q) return json(res, 400, { error: "missing q" });
      return json(res, 200, await search(q));
    }
    if (url.pathname === "/api/bench") {
      const send = sse(res);
      const rows: BenchRow[] = [];
      const t0 = performance.now();
      let inputTokens = 0;
      let outputTokens = 0;
      send("start", { n: BENCH_QUERIES.length, mock: MOCK });
      // Run with bounded concurrency so the demo shows a stream of results while staying under rate limits.
      const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 4);
      let next = 0;
      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });
      const worker = async () => {
        while (next < BENCH_QUERIES.length && !aborted) {
          const i = next++;
          const bq = BENCH_QUERIES[i];
          try {
            const { row, timing } = await runBenchQuery(bq, (q, hits, ms) => rerank(q, hits, byId, ms), bm25Search, byId);
            inputTokens += timing.inputTokens;
            outputTokens += timing.outputTokens;
            rows.push(row);
            send("row", { index: i, row, summary: summarize(rows, performance.now() - t0, inputTokens, outputTokens) });
          } catch (err) {
            send("error", { index: i, query: bq.query, ...describeError(err) });
          }
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));
      send("done", summarize(rows, performance.now() - t0, inputTokens, outputTokens));
      return res.end();
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    const { status, message } = describeError(err);
    console.error(`[server] ${req.method} ${url.pathname} -> ${status}: ${message}`);
    json(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(
    `[server] turbo-rerank proxy on http://localhost:${PORT} — corpus ${corpusSize} passages, ` +
      (MOCK ? "MOCK MODE (no API calls)" : process.env.OPENROUTER_API_KEY ? "TypeSafe key loaded" : "WARNING: OPENROUTER_API_KEY not set") +
      `, batches=${BATCHES}`,
  );
});
