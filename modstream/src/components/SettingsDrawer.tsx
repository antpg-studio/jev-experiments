import { DEFAULT_THRESHOLDS, type Thresholds } from "../../shared/policy.ts";
import { useEffect, useRef } from "react";
import { Icon } from "./Icon.tsx";

interface Props {
  open: boolean;
  thresholds: Thresholds;
  onChange: (t: Thresholds) => void;
  onClose: () => void;
  windowSize: number;
}

const FIELDS: Array<{ key: keyof Thresholds; label: string; help: string; min: number; max: number; step: number }> = [
  { key: "selfHarm", label: "Self-harm → care", help: "P(self_harm_risk) at or above this routes to the care queue (takes precedence over everything)", min: 0.1, max: 0.95, step: 0.05 },
  { key: "timeout", label: "Timeout user", help: "P(harassment) or P(obfuscated slur) at or above this times the user out", min: 0.5, max: 0.99, step: 0.01 },
  { key: "hide", label: "Hide message", help: "P(harassment / scam / spam / evasion) at or above this hides the message", min: 0.3, max: 0.95, step: 0.05 },
  { key: "hideSeverity", label: "Hide at severity ≥", help: "Severity score (0–3) alone that hides a message", min: 0.5, max: 3, step: 0.1 },
  { key: "timeoutSeverity", label: "Timeout at severity ≥", help: "Severity score (0–3) alone that times a user out", min: 1, max: 3, step: 0.1 },
  { key: "reviewConfidence", label: "Review below confidence", help: "If Jev's action confidence is below this, hold for a human", min: 0.2, max: 0.95, step: 0.05 },
];

export function SettingsDrawer({ open, thresholds, onChange, onClose, windowSize }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  return (
    <dialog ref={ref} className="drawer" onCancel={onClose} aria-labelledby="policy-title">
      <header>
        <div><span className="eyebrow">Configuration</span><h2 id="policy-title">Policy thresholds</h2></div>
        <button className="btn ghost icon-button" onClick={onClose} aria-label="Close policy settings">
          <Icon name="close" />
        </button>
      </header>
      <p className="sub">
        Policy lives in code. Moving a slider re-decides the last {windowSize} messages from their stored Jev judgments — <b>no new inference</b>, updates instantly.
      </p>
      {FIELDS.map((f) => (
        <label key={f.key} className="field">
          <span className="row1">
            <span>{f.label}</span>
            <code>{thresholds[f.key].toFixed(2)}</code>
          </span>
          <input type="range" min={f.min} max={f.max} step={f.step} value={thresholds[f.key]} onChange={(e) => onChange({ ...thresholds, [f.key]: Number(e.target.value) })} />
          <span className="help">{f.help}</span>
        </label>
      ))}
      <button className="btn" onClick={() => onChange({ ...DEFAULT_THRESHOLDS })}>
        Reset to defaults
      </button>
    </dialog>
  );
}
