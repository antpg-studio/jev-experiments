import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ClientCommand, ServerEvent, ServerStats } from "../shared/types.ts";
import { emptyScore, scoreVerdict, type FilterScore } from "../shared/policy.ts";
import { wordListMatch } from "../shared/wordlist.ts";
import { Rolling } from "../shared/stats.ts";

export const WINDOW = 500;

export interface StreamState {
  connected: boolean;
  server: ServerStats | null;
  /** last WINDOW messages, oldest first */
  messages: ChatMessage[];
  /** word-list verdicts for messages that fell out of the window (cumulative) */
  archivedWordList: FilterScore;
  /** messages evicted from the window — the caller re-scores these with the thresholds active at eviction time */
  evicted: ChatMessage[];
  totalReleased: number;
  totalErrors: number;
  startedAt: number | null;
  holdMs: Rolling;
  jevMs: Rolling;
  /** client receive timestamps for the rolling msg/s figure */
  releaseTimes: number[];
}

const initial = (): StreamState => ({
  connected: false,
  server: null,
  messages: [],
  archivedWordList: emptyScore(),
  evicted: [],
  totalReleased: 0,
  totalErrors: 0,
  startedAt: null,
  holdMs: new Rolling(300),
  jevMs: new Rolling(300),
  releaseTimes: [],
});

export function useStream(url: string) {
  const [state, setState] = useState<StreamState>(initial);
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef<ChatMessage[]>([]);
  const pendingStats = useRef<ServerStats | null>(null);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setState((s) => ({ ...s, connected: true }));
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data as string) as ServerEvent;
        if (data.type === "message") pending.current.push(data.message);
        else pendingStats.current = data.stats;
      };
    };
    connect();

    // Flush at 10 Hz: at 60 msg/s we do not want 60 renders/s.
    const flush = setInterval(() => {
      const batch = pending.current;
      const st = pendingStats.current;
      if (batch.length === 0 && !st) return;
      pending.current = [];
      pendingStats.current = null;
      const now = performance.now();
      setState((s) => {
        const next: StreamState = { ...s, server: st ?? s.server };
        if (st?.running && s.startedAt === null) next.startedAt = Date.now();
        if (st && !st.running && s.startedAt !== null && s.totalReleased === 0) next.startedAt = null;
        if (batch.length === 0) return next;
        for (const m of batch) {
          next.holdMs.push(m.timing.heldMs);
          if (m.judgment) next.jevMs.push(m.timing.jevMs);
        }
        const merged = s.messages.concat(batch);
        const overflow = merged.length - WINDOW;
        const evicted = overflow > 0 ? merged.slice(0, overflow) : [];
        const archivedWordList = { ...s.archivedWordList };
        for (const m of evicted) scoreVerdict(archivedWordList, m.truth, wordListMatch(m.text) !== null);
        const releaseTimes = s.releaseTimes.concat(batch.map(() => now)).filter((t) => now - t <= 3000);
        next.messages = overflow > 0 ? merged.slice(overflow) : merged;
        next.evicted = evicted;
        next.archivedWordList = archivedWordList;
        next.totalReleased = s.totalReleased + batch.length;
        next.totalErrors = s.totalErrors + batch.filter((m) => m.error).length;
        next.releaseTimes = releaseTimes;
        return next;
      });
    }, 100);

    return () => {
      closed = true;
      clearInterval(flush);
      if (retry) clearTimeout(retry);
      ws.close();
    };
  }, [url]);

  const send = useCallback((cmd: ClientCommand) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }, []);

  const reset = useCallback(() => {
    setState((s) => ({ ...initial(), connected: s.connected, server: s.server }));
  }, []);

  return { state, send, reset };
}
