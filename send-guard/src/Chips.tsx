import type { Answer } from "./lib/types";
import { CORE_QUESTION_IDS, QUESTION_LABEL, buildCoreQuestions } from "./lib/questions";
import { chipState, chipValue } from "./lib/policy";

const QUESTIONS = buildCoreQuestions();

interface Props {
  answers: Record<string, Answer>;
  inflight: boolean;
}

export default function Chips({ answers, inflight }: Props) {
  return (
    <div className={`chips ${inflight ? "chips-inflight" : ""}`}>
      {CORE_QUESTION_IDS.map((id) => {
        const st = chipState(id, answers);
        const q = QUESTIONS[id];
        const instr = typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions);
        return (
          <div key={id} className={`chip chip-${st}`} title={`${q.type}: ${instr}`}>
            <span className="chip-dot" />
            <span className="chip-label">{QUESTION_LABEL[id]}</span>
            <span className="chip-value">{chipValue(id, answers)}</span>
            <span className="chip-type">{q.type}</span>
          </div>
        );
      })}
    </div>
  );
}
