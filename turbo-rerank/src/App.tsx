import { useCallback, useEffect, useRef, useState } from "react";
import type { Bm25Response, SearchResponse } from "../shared/types.ts";
import { fetchBm25, fetchHealth, fetchSearch, type Health } from "./api.ts";
import { Benchmark } from "./Benchmark.tsx";
import { ResultColumns } from "./ResultColumns.tsx";
import { LatencyPanel } from "./LatencyPanel.tsx";

const EXAMPLES = [
  "having a baby soon, how many weeks can I take off",
  "how long do we keep logs",
  "on-call pay",
  "spike in 401s from the auth gateway",
  "accidentally pushed a credential to github",
  "what is the office wifi password",
];

export interface SearchStat {
  jevMs: number;
  totalMs: number;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [query, setQuery] = useState("");
  const [bm25, setBm25] = useState<Bm25Response | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SearchStat[]>([]);
  const [tab, setTab] = useState<"search" | "bench">("search");
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim();
    abortRef.current?.abort();
    if (!trimmed) {
      setBm25(null);
      setResult(null);
      setPending(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const mySeq = ++seq.current;
    setPending(true);
    setError(null);
    const t0 = performance.now();
    try {
      // BM25 first so the left column paints immediately; Jev result replaces the right column when it lands.
      const fast = fetchBm25(trimmed, ctrl.signal).then((r) => {
        if (seq.current === mySeq) setBm25(r);
      });
      const full = await fetchSearch(trimmed, ctrl.signal);
      await fast;
      if (seq.current !== mySeq) return;
      setResult(full);
      setHistory((h) => [...h.slice(-49), { jevMs: full.timing.jevMs, totalMs: performance.now() - t0 }]);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq.current === mySeq) setPending(false);
    }
  }, []);

  // Search-as-you-type: a 50-candidate rerank is cheap enough to run on a short debounce.
  useEffect(() => {
    const t = setTimeout(() => run(query), 250);
    return () => clearTimeout(t);
  }, [query, run]);

  const stale = result !== null && result.query !== query.trim();
  const mock = health?.mock ?? result?.mock ?? false;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⚡</span>
          <div>
            <h1>Turbo Rerank</h1>
            <p>BM25 top-50 → one Jev request → semantic order. {health ? `${health.corpusSize} passages` : "…"}</p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>Search</button>
          <button className={tab === "bench" ? "active" : ""} onClick={() => setTab("bench")}>Benchmark</button>
        </nav>
        <div className="status">
          {mock && <span className="pill mock">MOCK MODE — no API calls</span>}
          {health && !health.hasKey && !health.mock && <span className="pill warn">TYPESAFE_API_KEY not set</span>}
          {health && health.hasKey && !health.mock && <span className="pill ok">jev-latest · live</span>}
          {health && health.batches > 1 && <span className="pill">{health.batches} batches</span>}
        </div>
      </header>

      {tab === "search" ? (
        <main className="search">
          <form
            className="searchbar"
            onSubmit={(e) => {
              e.preventDefault();
              run(query);
            }}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the Northwind handbook, HR policies, API docs and runbooks…"
              spellCheck={false}
            />
            <button type="submit" disabled={pending}>{pending ? "Reranking…" : "Search"}</button>
          </form>
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setQuery(ex)}>{ex}</button>
            ))}
          </div>

          {error && <div className="banner error">{error}</div>}
          {result && !stale && result.results.length > 0 && result.answerExists < 0.5 && (
            <div className="banner nogood">
              <strong>No good answer in the corpus</strong> — Jev says the chance that any candidate answers this is {(result.answerExists * 100).toFixed(0)}%. Showing the reranked list anyway for inspection.
            </div>
          )}
          {bm25 && bm25.results.length === 0 && <div className="banner">No BM25 matches — try different words.</div>}

          <LatencyPanel result={stale ? null : result} bm25={bm25} history={history} pending={pending} />
          <ResultColumns bm25={bm25} result={stale ? null : result} pending={pending} />
        </main>
      ) : (
        <Benchmark mock={mock} />
      )}
    </div>
  );
}
