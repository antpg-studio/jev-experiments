import { useCallback, useEffect, useRef, useState } from "react";
import type { Bm25Response, SearchResponse } from "../shared/types.ts";
import { fetchBm25, fetchHealth, fetchSearch, type Health } from "./api.ts";
import { Benchmark } from "./Benchmark.tsx";
import { ResultColumns } from "./ResultColumns.tsx";
import { LatencyPanel } from "./LatencyPanel.tsx";
import { Icon } from "./Icon.tsx";

const EXAMPLES = [
  { label: "Taking parental leave", query: "having a baby soon, how many weeks can I take off" },
  { label: "Log retention", query: "how long do we keep logs" },
  { label: "On-call compensation", query: "on-call pay" },
  { label: "Authentication failures", query: "spike in 401s from the auth gateway" },
  { label: "A leaked credential", query: "accidentally pushed a credential to github" },
  { label: "The office Wi-Fi password", query: "what is the office wifi password" },
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim();
    abortRef.current?.abort();
    const mySeq = ++seq.current;
    if (!trimmed) {
      setBm25(null);
      setResult(null);
      setPending(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPending(true);
    setError(null);
    const t0 = performance.now();
    try {
      // BM25 first so the left column paints immediately; Jev result replaces the right column when it lands.
      const [, full] = await Promise.all([
        fetchBm25(trimmed, ctrl.signal).then((r) => {
          if (seq.current === mySeq) setBm25(r);
        }),
        fetchSearch(trimmed, ctrl.signal),
      ]);
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
    debounceRef.current = setTimeout(() => run(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, run]);

  const hasQuery = query.trim().length > 0;
  const currentResult = result?.query === query.trim() ? result : null;
  const currentBm25 = bm25?.query === query.trim() ? bm25 : null;
  const mock = health?.mock ?? result?.mock ?? false;

  const chooseExample = (example: string) => {
    setQuery(example);
    setError(null);
    inputRef.current?.focus();
  };

  const examples = (
    <div className="example-list">
      {EXAMPLES.map((ex) => (
        <button key={ex.query} type="button" onClick={() => chooseExample(ex.query)} title={ex.query}>
          <Icon name="document" size={16} /><span>{ex.label}</span><Icon name="chevron" size={14} />
        </button>
      ))}
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#search" onClick={(e) => { e.preventDefault(); setTab("search"); setQuery(""); }}>
          <Icon name="mark" size={25} /><span>Turbo Rerank</span>
        </a>
        <nav className="tabs" aria-label="Main navigation">
          <button aria-current={tab === "search" ? "page" : undefined} onClick={() => setTab("search")}>Search</button>
          <button aria-current={tab === "bench" ? "page" : undefined} onClick={() => setTab("bench")}>Benchmark</button>
        </nav>
        <div className="status">
          {mock ? <span className="connection mock">Mock mode · no API calls</span>
            : health?.hasKey ? <span className="connection live">Jev · live</span>
              : <span className="connection">{health ? "API key missing" : "Proxy unavailable"}</span>}
        </div>
      </header>

      {tab === "search" ? (
        <main className={`search ${hasQuery ? "has-query" : "start"}`}>
          <div className="search-intro">
            <div className="eyebrow"><Icon name="book" size={16} /> Northwind workspace</div>
            <h1>{hasQuery ? "Documentation search" : "What are you looking for?"}</h1>
            {!hasQuery && <p>Ask in your own words. Find the passage that answers.</p>}
          </div>
          <form className="composer" role="search" onSubmit={(e) => {
            e.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            run(query);
          }}>
            <div className="query-field">
              <label className="sr-only" htmlFor="query">Search documentation</label>
              <input id="query" ref={inputRef} autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setError(null); }}
                placeholder="Ask a question about your workspace…" spellCheck={false} autoComplete="off" />
              {hasQuery && <button className="icon-button clear" type="button" aria-label="Clear search" onClick={() => { chooseExample(""); run(""); }}><Icon name="close" size={16} /></button>}
            </div>
            <div className="composer-footer">
              <span><Icon name="book" size={16} /> All documentation <span className="separator">/</span> {health?.corpusSize ?? "—"} passages</span>
              <div className="composer-actions">
                <span className="input-hint">{pending ? "Reranking…" : "Search as you type"}</span>
                <button className="submit" type="submit" aria-label="Search" disabled={!hasQuery || pending}>
                  {pending ? <span className="spinner" /> : <Icon name="arrow" size={21} />}
                </button>
              </div>
            </div>
          </form>
          {!hasQuery ? (
            <section className="suggestions" aria-label="Example questions">
              <p>Try a question</p>
              {examples}
              <p className="search-explainer">BM25 finds up to 50 candidates. Jev judges them together in one request.</p>
            </section>
          ) : (
            <>
              <details className="more-examples"><summary>Try another question <Icon name="chevron" size={13} /></summary>{examples}</details>
              {error && <div className="banner error" role="alert">{error}</div>}
              {currentResult && currentResult.results.length > 0 && currentResult.answerExists < 0.5 && (
                <div className="banner nogood" role="status">
                  <strong>No good answer in the corpus</strong>
                  <span>{(currentResult.answerExists * 100).toFixed(0)}% answer probability. These are the closest matches, shown for inspection.</span>
                </div>
              )}
              {currentBm25?.results.length === 0 && <div className="banner" role="status">No keyword matches. Try a different question or one of the examples.</div>}
              <LatencyPanel result={currentResult} bm25={currentBm25} history={history} pending={pending} />
              <ResultColumns key={query.trim()} bm25={currentBm25} result={currentResult} pending={pending} />
            </>
          )}
        </main>
      ) : (
        <Benchmark mock={mock} />
      )}
      <footer className="page-footer">
        <span>Northwind is a fictional workspace. All documentation is synthetic.</span>
        <span>BM25 retrieval <span aria-hidden="true">→</span> Jev relevance</span>
      </footer>
    </div>
  );
}
