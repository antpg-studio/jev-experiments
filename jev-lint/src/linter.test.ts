import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Linter } from "./linter.ts";
import type { JevAnswer, JevRequest, JevResponse } from "./markers.ts";

const FILE = ["function add(a: number, b: number) {", "  return a + b;", "}", "", "function first(xs: number[]) {", "  return xs[0];", "}", ""].join("\n");

/** Answers every line as a confident probable bug so markers are easy to assert on. */
function bugEverywhere(req: JevRequest): JevResponse {
  const answers: Record<string, JevAnswer> = {};
  for (const id of Object.keys(req.questions)) {
    if (id.endsWith(".severity")) answers[id] = { type: "choice", choice: "error", confidence: 0.9, probabilities: { error: 0.9, warning: 0.1 } };
    else answers[id] = { type: "noul", noul: id.endsWith(".probable_bug") ? 0.95 : 0.05 };
  }
  return { model: "jev-test", answers, usage: { input_tokens: 500, output_tokens: 10 } };
}

interface Pending {
  req: JevRequest;
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
}

function mockFetch() {
  const pending: Pending[] = [];
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      pending.push({ req: JSON.parse(String(init?.body)) as JevRequest, resolve, reject });
    });
  const answer = (p: Pending, body: JevResponse = bugEverywhere(p.req)) => p.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  return { pending, fetchImpl, answer };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

describe("Linter", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("judges only the changed line, in its enclosing function, after the throttle window", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.onChange(FILE.replace("return xs[0];", "return xs[1];"));
    expect(pending).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60);
    expect(pending).toHaveLength(1);
    expect(pending[0].req.state.function_name).toBe("first");
    expect(pending[0].req.state.lines_under_review).toEqual([{ line: 6, text: "  return xs[1];" }]);
    answer(pending[0]);
    await flushMicrotasks();
    expect(linter.getMarkers().map((m) => [m.line, m.severity, m.source])).toEqual([[6, "error", "jev"]]);
    expect(linter.metrics.snapshot().requests).toBe(1);
    expect(linter.log[0].status).toBe("ok");
  });

  it("discards an answer for a line that changed in flight and re-judges the line as soon as it lands", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.onChange(FILE.replace("return xs[0];", "return xs[1];"));
    await vi.advanceTimersByTimeAsync(60);
    expect(pending).toHaveLength(1);
    // keep typing on the same line while the request is out: no second request yet
    linter.onChange(FILE.replace("return xs[0];", "return xs[12];"));
    await vi.advanceTimersByTimeAsync(200);
    expect(pending).toHaveLength(1);
    answer(pending[0]);
    await flushMicrotasks();
    expect(linter.getMarkers()).toEqual([]);
    expect(linter.log[0].status).toBe("stale");
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(2);
    expect(pending[1].req.state.lines_under_review).toEqual([{ line: 6, text: "  return xs[12];" }]);
    answer(pending[1]);
    await flushMicrotasks();
    expect(linter.getMarkers().map((m) => m.line)).toEqual([6]);
    expect(linter.metrics.snapshot().requests).toBe(2);
  });

  it("an in-flight Jev scan cannot overwrite markers after switching to the heuristic baseline", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl });
    const scan = linter.fullScan();
    expect(pending.length).toBeGreaterThan(0);
    linter.mode = "heuristic";
    const heuristic = await linter.fullScan();
    expect(heuristic.requests).toBe(0);
    const before = linter.getMarkers();
    for (const p of pending) answer(p);
    await scan;
    expect(linter.getMarkers()).toEqual(before);
    expect(linter.log[0].status).toBe("stale");
    expect(linter.log[0].detail).toBe("file or mode changed in flight");
  });

  it("edits to different functions overlap in flight", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.onChange(FILE.replace("return xs[0];", "return xs[1];"));
    await vi.advanceTimersByTimeAsync(60);
    linter.onChange(linter.getText().replace("return a + b;", "return a - b;"));
    await vi.advanceTimersByTimeAsync(60);
    expect(pending.map((p) => p.req.state.function_name)).toEqual(["first", "add"]);
    expect(linter.metrics.inFlight).toBe(2);
    answer(pending[1]);
    answer(pending[0]);
    await flushMicrotasks();
    expect(linter.getMarkers().map((m) => m.line)).toEqual([2, 6]);
  });

  it("falls back to the deterministic heuristic when a request fails", async () => {
    const { pending, fetchImpl } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.onChange(FILE.replace("return a + b;", 'return db.query("SELECT * FROM t WHERE id = " + a);'));
    await vi.advanceTimersByTimeAsync(60);
    pending[0].reject(new Error("network down"));
    await flushMicrotasks();
    const [m] = linter.getMarkers();
    expect(m.line).toBe(2);
    expect(m.source).toBe("heuristic");
    expect(m.kinds[0].kind).toBe("security_risk");
    expect(linter.log[0].status).toBe("fallback");
    expect(linter.metrics.snapshot().failures).toBe(1);
  });

  it("retries once after a 429 before giving up", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.onChange(FILE.replace("return xs[0];", "return xs[1];"));
    await vi.advanceTimersByTimeAsync(60);
    pending[0].resolve(new Response("slow down", { status: 429, headers: { "retry-after": "1" } }));
    await flushMicrotasks();
    expect(pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pending).toHaveLength(2);
    answer(pending[1]);
    await flushMicrotasks();
    expect(linter.getMarkers().map((m) => [m.line, m.source])).toEqual([[6, "jev"]]);
    expect(linter.metrics.snapshot().failures).toBe(0);
  });

  it("moves markers with the text when lines are inserted above them", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.onChange(FILE.replace("return xs[0];", "return xs[1];"));
    await vi.advanceTimersByTimeAsync(60);
    answer(pending[0]);
    await flushMicrotasks();
    expect(linter.getMarkers()[0].line).toBe(6);
    linter.onChange("// header\n" + linter.getText().replace("return xs[1];", "return xs[1];"));
    expect(linter.getMarkers()[0].line).toBe(7);
  });

  it("heuristic mode never touches the network", async () => {
    const { pending, fetchImpl } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl, debounceMs: 60 });
    linter.mode = "heuristic";
    linter.onChange(FILE.replace("return a + b;", "return eval(a);"));
    await vi.advanceTimersByTimeAsync(200);
    expect(pending).toHaveLength(0);
    expect(linter.getMarkers().map((m) => [m.line, m.source])).toEqual([[2, "heuristic"]]);
  });

  it("full scan batches every judgeable line into parallel requests and reports the burst", async () => {
    const { pending, fetchImpl, answer } = mockFetch();
    const linter = new Linter(FILE, "typescript", { fetchImpl });
    const scanP = linter.fullScan();
    await flushMicrotasks();
    expect(pending.length).toBe(2);
    for (const p of pending) answer(p);
    const scan = await scanP;
    expect(scan.requests).toBe(2);
    expect(scan.failed).toBe(0);
    expect(scan.inputTokens).toBe(1000);
    expect(scan.questions).toBe(pending.reduce((n, p) => n + Object.keys(p.req.questions).length, 0));
    expect(linter.getMarkers().map((m) => m.line)).toEqual([1, 2, 5, 6]);
  });
});
