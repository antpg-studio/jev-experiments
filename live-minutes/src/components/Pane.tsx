import type { ReactNode } from "react";

export const PANES = ["transcript", "action-items", "decisions", "open-questions", "risks", "post-meeting", "keyword-heuristic"] as const;
export type PaneIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface Props {
  idx: PaneIdx;
  title?: ReactNode;
  right?: ReactNode;
  className?: string;
  active: PaneIdx;
  onActivate: (idx: PaneIdx) => void;
  children: ReactNode;
}

/** A tmux pane: single-line border with the `index:title` in the top border, green when active. */
export function Pane({ idx, title, right, className, active, onActivate, children }: Props) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}${active === idx ? " active" : ""}`} onMouseDown={() => onActivate(idx)}>
      <header className="panel-head">
        <h2 data-idx={idx}>{title ?? PANES[idx]}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}
