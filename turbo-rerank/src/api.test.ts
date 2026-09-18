import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSearch, streamBench, type BenchEvents } from "./api.ts";

afterEach(() => vi.unstubAllGlobals());

describe("search transport", () => {
  it("explains an empty proxy failure response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(fetchSearch("leave")).rejects.toThrow("Search service unavailable (HTTP 500). Check that the proxy server is running and try again.");
  });

  it("explains network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchSearch("leave")).rejects.toThrow("Cannot reach the search service.");
  });

  it("preserves useful server errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "TypeSafe rate limit reached" }, { status: 429 })));
    await expect(fetchSearch("leave")).rejects.toThrow("TypeSafe rate limit reached");
  });

  it("preserves cancellation rather than reporting an unavailable service", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(fetchSearch("leave", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("benchmark transport", () => {
  function setup() {
    const sources: SourceStub[] = [];
    class SourceStub extends EventTarget {
      close = vi.fn();
      constructor() {
        super();
        sources.push(this);
      }
    }
    vi.stubGlobal("EventSource", SourceStub);
    const events: BenchEvents = {
      onStart: vi.fn(),
      onRow: vi.fn(),
      onError: vi.fn(),
      onFailure: vi.fn(),
      onDone: vi.fn(),
    };
    const stop = streamBench(events);
    return { source: sources[0], events, stop };
  }

  it("closes a disconnected stream and allows the UI to leave its running state", () => {
    const { source, events } = setup();
    source.dispatchEvent(new Event("error"));
    expect(source.close).toHaveBeenCalledOnce();
    expect(events.onFailure).toHaveBeenCalledWith("Benchmark connection lost. Check that the proxy server is running, then run again.");
    expect(events.onError).not.toHaveBeenCalled();
  });

  it("keeps per-query failures separate from transport failures", () => {
    const { source, events } = setup();
    source.dispatchEvent(new MessageEvent("error", {
      data: JSON.stringify({ index: 3, query: "leave", message: "Rate limited" }),
    }));
    expect(events.onError).toHaveBeenCalledWith(3, "leave", "Rate limited");
    expect(events.onFailure).not.toHaveBeenCalled();
    expect(source.close).not.toHaveBeenCalled();
  });

  it("closes intentionally without reporting a connection error", () => {
    const { source, events, stop } = setup();
    stop();
    expect(source.close).toHaveBeenCalledOnce();
    expect(events.onFailure).not.toHaveBeenCalled();
  });
});
