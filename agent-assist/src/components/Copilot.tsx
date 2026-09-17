import { Check, Minus, Zap } from "lucide-react";
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

function Flag({ label, answer, invert = false }: { label: string; answer: NoulResponse; invert?: boolean }) {
  const yes = answer.noul >= YES;
  const tone = yes ? (invert ? "good" : "bad") : "neutral";
  return (
    <div className={`flag ${tone}`}>
      {yes ? <Check size={13} /> : <Minus size={13} />}
      <span className="flag-label">{label}</span>
      <span className="flag-p">{pct(answer.noul)}</span>
    </div>
  );
}

export function Copilot({ chat, baseline, macros, onInsertMacro }: Props) {
  const j = chat.judgment;
  const refundOk = refundEligibleByPolicy(chat.customer);

  const sinceArrival = j ? performance.now() - j.arrivedAt : 0;
  const greyed = baseline && j !== null && sinceArrival < LLM_BASELINE_MS;
  const remaining = Math.max(0, LLM_BASELINE_MS - sinceArrival);

  return (
    <aside className={`panel copilot ${greyed ? "greyed" : ""}`}>
      <div className="panel-title">
        <span>
          <Zap size={13} /> Copilot
        </span>
        {j && (
          <span className="lat-badge" title={`Jev server-side: ${fmtMs(j.jevMs)} · browser round trip: ${fmtMs(j.panelMs)}`}>
            panel refreshed in <b>{fmtMs(j.panelMs)}</b> <span className="muted">(Jev {fmtMs(j.jevMs)})</span>
          </span>
        )}
      </div>

      {greyed && (
        <div className="baseline-overlay">
          <div className="baseline-box">
            <div className="baseline-title">SIMULATED LLM baseline</div>
            <div className="baseline-num">{(remaining / 1000).toFixed(1)} s</div>
            <div className="muted">
              A typical prompt-and-parse copilot takes ~{LLM_BASELINE_MS / 1000} s. Jev already answered in {fmtMs(j!.panelMs)} — this
              wait is artificial.
            </div>
          </div>
        </div>
      )}

      <div className="copilot-body">
        {chat.error && <div className="error">Judgment failed: {chat.error}</div>}
        {!j && !chat.error && (
          <div className="empty">
            {chat.pending ? "Judging first message…" : "No customer message yet. The panel fills in ~150 ms after each one."}
          </div>
        )}
        {j && (
          <>
            <div className="section">
              <div className="section-title">Intent</div>
              <div className="intent">
                <span className="intent-name">{j.answers.intent.choice.replace(/_/g, " ")}</span>
                <span className="muted">{pct(j.answers.intent.confidence)} conf</span>
              </div>
            </div>

            <div className="section two">
              <Gauge title="Churn risk" score={j.answers.churn_risk.score} label={scoreLabel(j.answers.churn_risk)} />
              <Gauge title="Frustration" score={j.answers.frustration.score} label={scoreLabel(j.answers.frustration)} />
            </div>

            <div className="section">
              <div className="section-title">Flags</div>
              <Flag label="Needs supervisor escalation" answer={j.answers.needs_escalation_to_human_supervisor} />
              <Flag label="Regulatory / legal request" answer={j.answers.contains_regulatory_request} />
              <Flag label="Customer requests refund" answer={j.answers.customer_requests_refund} />
              <Flag label="Apologize first" answer={j.answers.agent_should_apologize_first} />
              <Flag label="Resolvable this session" answer={j.answers.resolution_likely_this_session} invert />
              <div className={`flag policy ${refundOk ? "good" : "neutral"}`}>
                {refundOk ? <Check size={13} /> : <Minus size={13} />}
                <span className="flag-label">Refund eligible by policy</span>
                <span className="flag-p code">from code · {chat.customer.plan}/{chat.customer.tenure_months}mo</span>
              </div>
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
      <div className="section-title">{title}</div>
      <div className="gauge-bar">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i <= Math.round(score) ? "on" : ""} />
        ))}
      </div>
      <div className="gauge-label">
        {score.toFixed(1)}/3 · {label.split(":")[0]}
      </div>
    </div>
  );
}

function MacroSection({ chat, macros, onInsertMacro }: Pick<Props, "chat" | "macros" | "onInsertMacro">) {
  const j = chat.judgment!;
  const gate = gateMacro(j.answers.best_macro);
  const title = (id: string) => macros.find((m) => m.id === id)?.title ?? id;

  return (
    <div className="section">
      <div className="section-title">
        Suggested macro <span className="muted">confidence {pct(gate.confidence)}</span>
      </div>
      {gate.kind === "auto" && (
        <div className="macro auto">
          <div className="macro-head">
            <Check size={13} /> {title(gate.macroId)}
          </div>
          <div className="muted">Auto-filled into the reply box (confidence ≥ 60%).</div>
        </div>
      )}
      {gate.kind === "none" && <div className="macro none">No macro fits — reply freehand.</div>}
      {gate.kind === "options" && (
        <div className="macro options">
          <div className="muted">Low confidence — pick one:</div>
          {gate.top.map((o) => (
            <button key={o.id} className="option" onClick={() => onInsertMacro(o.id)}>
              <span>{title(o.id)}</span>
              <span className="prob">{pct(o.probability)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="top3">
        {gate.top.map((o) => (
          <div key={o.id} className="top3-row">
            <span className="top3-name">{o.id === "none" ? "none" : title(o.id)}</span>
            <span className="top3-bar">
              <span style={{ width: `${Math.round(o.probability * 100)}%` }} />
            </span>
            <span className="prob">{pct(o.probability)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
