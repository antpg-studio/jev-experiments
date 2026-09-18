import type { JevRequest } from "./jev.ts";
import type { DeciderResult } from "./sim.ts";

const RETRY_STATUS = new Set([429, 529]);
const RETRY_DELAYS_MS = [200, 400, 800];

/**
 * Sends one fan-out request to `url`. 429/529 are retried with backoff; the
 * reported latency covers the whole exchange including retries.
 */
export function makeLiveDecider(url: string, headers: Record<string, string> = {}): (req: JevRequest) => Promise<DeciderResult> {
  return async (req) => {
    const t0 = performance.now();
    const body = JSON.stringify(req);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      if (res.ok) return { json: await res.json(), latencyMs: performance.now() - t0 };
      if (!RETRY_STATUS.has(res.status) || attempt >= RETRY_DELAYS_MS.length) throw new Error(`HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] + Math.random() * 100));
    }
  };
}
