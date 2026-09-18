import { Check, Zap } from "lucide-react";
import type { Macro } from "../data/macros.ts";
import type { Chat } from "../lib/store.ts";
import { LLM_BASELINE_MS } from "../lib/store.ts";
import { YES, fmtMs, gateMacro, pct, refundEligibleByPolicy, scoreLabel } from "../lib/engine.ts";
import type { NoulResponse } from "@typesafe-ai/sdk";

interface Props {
  chat: Chat;
  baseline: boolean;
  macros: Macro[];
  onInsertMacro: (id: string) => void;
}

interface Signal {
  label: string;
  answer: NoulResponse;
  tone: "bad" | "good";
}

export function Copilot({ chat, baseline, macros, onInsertMacro }: Props) {
  const j = chat.judgment;
  const refundOk = refundEligibleByPolicy(chat.customer);

  const sinceArrival = j ? performance.now() - j.arrivedAt : 0;
  const greyed = baseline && j !== null && sinceArrival < LLM_BASELINE_MS;
  const remaining = Math.max(0, LLM_BASELINE_MS - sinceArrival);

  const signals: Signal[] = j
    ? [
        { label: "Needs supervisor", answer: j.answers.needs_escalation_to_human_supervisor, tone: "bad" },
        { label: "Regulatory / legal", answer: j.answers.contains_regulatory_request, tone: "bad" },
        { label: "Requests refund", answer: j.answers.customer_requests_refund, tone: "bad" },
        { label: "Apologize first", answer: j.answers.agent_should_apologize_first, tone: "bad" },
        { label: "Resolvable now", answer: j.answers.resolution_likely_this_session, tone: "good" },
      ]
    : [];
  const fired = signals.filter((s) => s.answer.noul >= YES);
  const quiet = signals.filter((s) => s.answer.noul < YES);

  return (
    <aside className={`panel copilot ${greyed ? "greyed" : ""}`}>
      <div className="panel-title">
        <span className="title-with-icon">
          <Zap size={15} /> Copilot
        </span>
        {j && (
          <span className="lat-badge" title={`Jev server-side: ${fmtMs(j.jevMs)} · browser round trip: ${fmtMs(j.panelMs)}`}>
            {fmtMs(j.panelMs)}
          </span>
        )}
      </div>

      {greyed && (
        <div className="baseline-overlay">
          <div className="baseline-box">
            <div className="baseline-title">Simulated LLM baseline</div>
            <div className="baseline-num">{(remaining / 1000).toFixed(1)} s</div>
            <div className="muted">Jev already answered in {fmtMs(j!.panelMs)}. This wait is artificial.</div>
          </div>
        </div>
      )}

      <div className="copilot-body">
        {chat.error && <div className="error">Judgment failed: {chat.error}</div>}
        {!j && !chat.error && (
          <div className="empty">{chat.pending ? "Judging…" : "Waiting for the first customer message."}</div>
        )}
        {j && (
          <>
            <div className="block">
              <div className="block-title">Intent</div>
              <div className="intent">
                <span className="intent-name">{j.answers.intent.choice.replace(/_/g, " ")}</span>
                <span className="muted">{pct(j.answers.intent.confidence)}</span>
              </div>
            </div>

            <div className="block gauges">
              <Gauge title="Churn risk" score={j.answers.churn_risk.score} label={scoreLabel(j.answers.churn_risk)} />
              <Gauge title="Frustration" score={j.answers.frustration.score} label={scoreLabel(j.answers.frustration)} />
            </div>

            <div className="block">
              <div className="block-title">Signals</div>
              <div className="chips">
                {fired.map((s) => (
                  <span key={s.label} className={`chip ${s.tone}`} title={`${pct(s.answer.noul)} yes`}>
                    <Check size={12} /> {s.label}
                  </span>
                ))}
                <span
                  className={`chip ${refundOk ? "good" : "off"}`}
                  title={`Deterministic policy from code: ${chat.customer.plan} plan, ${chat.customer.tenure_months} mo tenure`}
                >
                  {refundOk ? <Check size={12} /> : null} Refund eligible
                </span>
              </div>
              {quiet.length > 0 && <div className="quiet">Not flagged: {quiet.map((s) => s.label.toLowerCase()).join(", ")}</div>}
            </div>

            <MacroSection chat={chat} macros={macros} onInsertMacro={onInsertMacro} />
          </>
        )}
      </div>
    </aside>
  );
}

function Gauge({ title, score, label }: { title: string; score: number; label: string }) {
  const tone = score >= 3 ? "bad" : score >= 2 ? "warn" : score >= 1 ? "mild" : "good";
  return (
    <div className={`gauge ${tone}`}>
      <div className="block-title">{title}</div>
      <div className="gauge-value">
        {score.toFixed(1)}
        <span className="muted"> / 3</span>
      </div>
      <div className="gauge-bar">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i <= Math.round(score) ? "on" : ""} />
        ))}
      </div>
      <div className="gauge-label">{label.split(":")[0]}</div>
    </div>
  );
}

function MacroSection({ chat, macros, onInsertMacro }: Pick<Props, "chat" | "macros" | "onInsertMacro">) {
  const j = chat.judgment!;
  const gate = gateMacro(j.answers.best_macro);
  const title = (id: string) => (id === "none" ? "No macro" : (macros.find((m) => m.id === id)?.title ?? id));

  return (
    <div className="block">
      <div className="block-title">
        Suggested reply <span className="muted">{pct(gate.confidence)} confident</span>
      </div>
      {gate.kind === "auto" && (
        <div className="macro auto">
          <div className="macro-head">
            <Check size={14} /> {title(gate.macroId)}
          </div>
          <div className="macro-sub">Auto-filled into the reply box.</div>
        </div>
      )}
      {gate.kind === "none" && <div className="macro none">No macro fits — reply freehand.</div>}
      {gate.kind === "options" && (
        <div className="macro options">
          {gate.top.map((o) => (
            <button key={o.id} className="option" onClick={() => onInsertMacro(o.id)} disabled={o.id === "none"}>
              <span>{title(o.id)}</span>
              <span className="prob">{pct(o.probability)}</span>
            </button>
          ))}
        </div>
      )}
      {gate.kind !== "options" && (
        <div className="top3">
          {gate.top.map((o) => (
            <div key={o.id} className="top3-row">
              <span className="top3-name">{title(o.id)}</span>
              <span className="top3-bar">
                <span style={{ width: `${Math.round(o.probability * 100)}%` }} />
              </span>
              <span className="prob">{pct(o.probability)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
