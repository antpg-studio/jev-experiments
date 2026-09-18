import type { JudgeRequest, JudgeResponse } from "./questions.ts";

export interface Health {
  ok: boolean;
  mock: boolean;
  hasKey: boolean;
  model: string;
}

export interface TimedJudgment {
  response: JudgeResponse;
  /** Browser-measured round trip: message arrival → answers in hand, via performance.now(). */
  panelMs: number;
}

export async function fetchHealth(): Promise<Health | null> {
  try {
    const r = await fetch("/api/health");
    if (!r.ok) return null;
    return (await r.json()) as Health;
  } catch {
    return null;
  }
}

export async function judgeMessage(req: JudgeRequest, signal?: AbortSignal): Promise<TimedJudgment> {
  const t0 = performance.now();
  const r = await fetch("/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  const body = (await r.json()) as JudgeResponse | { error: string };
  const panelMs = performance.now() - t0;
  if (!r.ok || "error" in body) {
    throw new Error("error" in body ? body.error : `HTTP ${r.status}`);
  }
  return { response: body, panelMs };
}
