import type { HealthResponse, JudgeRequest, JudgeResponse } from "./types.ts";

export class JudgeHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One fan-out request per utterance; `clientMs` is measured browser-side with performance.now(). */
export async function judge(req: JudgeRequest, signal?: AbortSignal): Promise<JudgeResponse & { clientMs: number }> {
  const t0 = performance.now();
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  const clientMs = performance.now() - t0;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new JudgeHttpError(res.status, body.error ?? res.statusText);
  }
  const json = (await res.json()) as JudgeResponse;
  return { ...json, clientMs };
}

export async function health(): Promise<HealthResponse | null> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}
