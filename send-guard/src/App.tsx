import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Composer from "./Composer";
import GuardPanel, { type ScenarioResult } from "./GuardPanel";
import { ChannelHeader, MessageList } from "./Messages";
import { Rail, Sidebar, TopBar, WORKSPACE } from "./Shell";
import { ALL_CHANNELS, CHANNELS, DECOR_CHANNELS } from "./lib/channels";
import { decide } from "./lib/policy";
import { SCENARIOS } from "./lib/scenarios";
import { PEOPLE, SEED, type Message } from "./lib/seed";
import { findSpans, regexOnlyFlags } from "./lib/spans";
import type { Verdict } from "./lib/types";
import { DEBOUNCE_MS, useGuard } from "./useGuard";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a classic regex DLP rule would decide: block on key-like tokens, warn on emails/phones, else send. */
function regexVerdict(kinds: string[]): { verdict: Verdict; reason: string } {
  if (kinds.includes("key")) return { verdict: "block", reason: "regex: key-like token" };
  if (kinds.includes("email") || kinds.includes("phone")) return { verdict: "warn", reason: "regex: contact detail" };
  return { verdict: "send", reason: "regex: no pattern matched" };
}

const SIDEBAR_CHANNELS = [
  ...DECOR_CHANNELS.filter((c) => c.id === "general"),
  ...CHANNELS.filter((c) => c.kind === "channel"),
  ...DECOR_CHANNELS.filter((c) => c.id !== "general"),
];
const DM_CHANNELS = CHANNELS.filter((c) => c.kind === "dm").map((c) => ({ channel: c, person: PEOPLE.jordan }));

const now = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function App() {
  const [channelId, setChannelId] = useState(CHANNELS[0].id);
  const [draft, setDraft] = useState("");
  const [regexOnly, setRegexOnly] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [results, setResults] = useState<ScenarioResult[]>([]);
  const [health, setHealth] = useState<{ mock: boolean; hasKey: boolean } | null>(null);
  const [guardOpen, setGuardOpen] = useState(true);
  const [history, setHistory] = useState<Record<string, Message[]>>(SEED);
  const abortReplay = useRef(false);

  const channel = useMemo(() => ALL_CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0], [channelId]);
  const guard = useGuard(draft, channel);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: { mock: boolean; hasKey: boolean }) => setHealth(h))
      .catch(() => setHealth({ mock: false, hasKey: false }));
  }, []);

  const stale = guard.judgedDraft !== draft || guard.judgedChannel !== channel.id;
  const decision = useMemo(() => decide(guard.answers, channel.audience, guard.spans), [guard.answers, channel.audience, guard.spans]);
  const liveSpans = useMemo(() => findSpans(draft), [draft]);
  const regexFlagged = useMemo(() => regexOnlyFlags(liveSpans), [liveSpans]);
  const regex = regexVerdict(regexFlagged.map((s) => s.kind));
  const hasAnswers = Object.keys(guard.answers).length > 0;

  const empty = draft.trim().length === 0;
  const shown: { verdict: Verdict; reason: string } = regexOnly ? regex : hasAnswers ? decision : { verdict: "send", reason: "" };
  const buttonVerdict: Verdict = empty ? "send" : shown.verdict;
  // Jev mode: Send only unlocks once the exact current draft + channel has been judged.
  const awaitingJudgment = !regexOnly && !empty && (stale || guard.inflight || !hasAnswers);
  const canSend = !empty && buttonVerdict !== "block" && !awaitingJudgment;

  const guardRef = useRef(guard);
  guardRef.current = guard;

  const replay = useCallback(async () => {
    if (replaying) {
      abortReplay.current = true;
      return;
    }
    setReplaying(true);
    setResults([]);
    abortReplay.current = false;
    for (const sc of SCENARIOS) {
      if (abortReplay.current) break;
      setChannelId(sc.channelId);
      setDraft("");
      await sleep(350);
      let typed = "";
      for (const ch of sc.draft) {
        if (abortReplay.current) break;
        typed += ch;
        setDraft(typed);
        // Humans type in bursts: fast inside a word, a longer pause after punctuation or a word boundary.
        if (/[.!?,;:—]/.test(ch)) await sleep(260);
        else if (ch === " " && Math.random() < 0.35) await sleep(180);
        else await sleep(18 + Math.random() * 22);
      }
      if (abortReplay.current) break;
      // Wait for the final judgment of the complete draft.
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline && (guardRef.current.judgedDraft !== sc.draft || guardRef.current.inflight)) await sleep(30);
      const g = guardRef.current;
      const ch = CHANNELS.find((c) => c.id === sc.channelId) ?? CHANNELS[0];
      const d = decide(g.answers, ch.audience, g.spans);
      const r = regexVerdict(regexOnlyFlags(g.spans).map((s) => s.kind));
      setResults((rs) => [
        ...rs,
        {
          title: sc.title,
          channel: ch.name,
          expect: sc.expect,
          jev: d.verdict,
          jevReason: d.reason,
          regex: r.verdict,
          ms: g.last?.clientMs ?? 0,
          judgments: g.last?.judgments ?? 0,
        },
      ]);
      await sleep(1400);
    }
    setReplaying(false);
  }, [replaying]);

  const onSend = () => {
    if (!canSend) return;
    const msg: Message = { id: `sent-${Date.now()}`, author: "me", time: now(), text: draft.trim() };
    setHistory((h) => ({ ...h, [channel.id]: [...(h[channel.id] ?? []), msg] }));
    setDraft("");
  };

  const status = regexOnly ? (
    <span className="dim">regex-only · 0 ms · {regexFlagged.length} pattern hit{regexFlagged.length === 1 ? "" : "s"}</span>
  ) : (
    <>
      <span className={`spinner ${guard.inflight ? "on" : ""}`} />
      {guard.last ? (
        <span>
          <b>{guard.last.judgments} judgments</b> in <b>{Math.round(guard.last.clientMs)} ms</b>
          <span className="dim"> · API {Math.round(guard.last.apiMs)} ms</span>
          {stale && !empty && <span className="dim"> · re-judging</span>}
        </span>
      ) : (
        <span className="dim">Jev judges every pause · {DEBOUNCE_MS} ms debounce</span>
      )}
    </>
  );

  const dmPerson = channel.kind === "dm" ? PEOPLE.jordan : undefined;
  const target = channel.kind === "dm" ? PEOPLE.jordan.name : channel.name;

  return (
    <div className={`app ${guardOpen ? "with-details" : ""}`}>
      <TopBar guardOpen={guardOpen} onToggleGuard={() => setGuardOpen((v) => !v)} />
      <div className="body">
        <Rail />
        <Sidebar channels={SIDEBAR_CHANNELS} dms={DM_CHANNELS} activeId={channel.id} unread={new Set(["support-escalations"])} onSelect={(id) => {
            setDraft("");
            setChannelId(id);
          }}
          disabled={replaying} />
        <main className="main">
          <ChannelHeader channel={channel} person={dmPerson} />
          <MessageList channel={channel} messages={history[channel.id] ?? []} />
          <div className="composer-wrap">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={onSend}
              spans={regexOnly ? liveSpans : guard.spans}
              culprits={new Set(decision.culpritSpanIds)}
              regexOnly={regexOnly}
              regexFlagged={new Set(regexFlagged.map((s) => s.id))}
              disabled={replaying}
              placeholder={`Message ${target}`}
              verdict={buttonVerdict}
              awaiting={awaitingJudgment}
              canSend={canSend}
              reason={shown.reason}
              status={status}
            />
            <div className="hint">
              {channel.shared || channel.audience === "public" ? (
                <span>
                  <b>{channel.audience === "public" ? "Public channel" : "Shared with Acme Corp"}</b> · people outside {WORKSPACE} can read this
                </span>
              ) : (
                <span>&nbsp;</span>
              )}
              <span>
                <b>Shift + Return</b> to add a new line
              </span>
            </div>
          </div>
        </main>
        {guardOpen && (
          <GuardPanel
            onClose={() => setGuardOpen(false)}
            answers={guard.answers}
            spans={guard.spans}
            decision={decision}
            hasAnswers={hasAnswers}
            inflight={guard.inflight}
            samples={guard.samples}
            cancelled={guard.cancelled}
            model={guard.model}
            mock={health?.mock ?? false}
            hasKey={health?.hasKey ?? true}
            regexOnly={regexOnly}
            onRegexOnly={setRegexOnly}
            regex={regex}
            draftEmpty={empty}
            replaying={replaying}
            onReplay={() => void replay()}
            results={results}
            error={guard.error}
          />
        )}
      </div>
    </div>
  );
}
