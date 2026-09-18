// Jev request construction and answer -> marker mapping. Pure functions; the
// network lives in linter.ts.

import { collectIdentifiers, extractImports, enclosingFunction, extractFunctions, fallbackSpan, isJudgeable, numberedSource, type FunctionSpan, type Language } from "./analysis.ts";

export type Kind = "probable_bug" | "security_risk" | "misleading_name" | "dead_or_unreachable" | "performance_smell";
export const KINDS: Kind[] = ["probable_bug", "security_risk", "misleading_name", "dead_or_unreachable", "performance_smell"];
export const KIND_LABEL: Record<Kind, string> = {
  probable_bug: "probable bug",
  security_risk: "security risk",
  misleading_name: "misleading name",
  dead_or_unreachable: "dead / unreachable",
  performance_smell: "performance smell",
};

export type Severity = "info" | "warning" | "error";
export type SeverityChoice = "ignore" | Severity;

export interface Marker {
  line: number;
  severity: Severity;
  /** every kind with its probability, sorted descending */
  kinds: { kind: Kind; p: number }[];
  message: string;
  source: "jev" | "heuristic";
  severityProbabilities?: Record<SeverityChoice, number>;
}

export interface LineRef {
  id: string;
  line: number;
  text: string;
}

export interface JevQuestion {
  type: "noul" | "choice";
  instructions: string;
  criteria?: Record<string, string | null>;
}

export interface JevRequest {
  state: Record<string, unknown>;
  model: "typesafe/jev-1.13";
  questions: Record<string, JevQuestion>;
}

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

/** Question wording. Each is one narrow yes/no judgment about one line in context. */
export function questionsForLine(ref: LineRef, index: number): Record<string, JevQuestion> {
  const L = `\`lines_under_review[${index}]\` (line ${ref.line})`;
  const ctx = "read in the context of `function_source`";
  return {
    [`${ref.id}.probable_bug`]: {
      type: "noul",
      instructions: `Does ${L}, ${ctx}, contain a logic error that would make the program behave incorrectly at runtime?`,
      criteria: {
        true: "A concrete defect: off-by-one bound, wrong comparison or assignment used as comparison, inverted condition, wrong variable, unhandled null/None/nil/empty case, missing error check, integer/float mistake",
        false: "The line does what the surrounding code expects, even if stylistically imperfect or incomplete",
      },
    },
    [`${ref.id}.security_risk`]: {
      type: "noul",
      instructions: `Does ${L} introduce a security vulnerability?`,
      criteria: {
        true: "Injection (SQL, shell, HTML/JS, path traversal) from untrusted input, eval/exec of dynamic code, a hardcoded secret or credential, insecure randomness or weak crypto used for a security purpose, disabled TLS verification, unsafe deserialization",
        false: "No security-relevant behaviour, or the risky-looking API is used with constant/trusted input",
      },
    },
    [`${ref.id}.misleading_name`]: {
      type: "noul",
      instructions: `Does an identifier declared or assigned on ${L} have a name that contradicts what the value actually holds or what the code does with it?`,
      criteria: {
        true: "The name asserts the opposite or a different meaning, e.g. `isEmpty = items.length > 0`, `maxRetries` holding a timeout, a function named `save` that deletes",
        false: "Names are accurate, or merely vague/short",
      },
    },
    [`${ref.id}.dead_or_unreachable`]: {
      type: "noul",
      instructions: `Is ${L} dead code that can never execute or never affect the program, ${ctx}?`,
      criteria: {
        true: "Follows an unconditional return/throw/break/exit in the same block, guarded by an always-false or always-true condition, or assigns a value that is never read",
        false: "The line can execute and its effect is observable",
      },
    },
    [`${ref.id}.performance_smell`]: {
      type: "noul",
      instructions: `Does ${L} create an avoidable performance problem, ${ctx}?`,
      criteria: {
        true: "A database/network/file call inside a loop (N+1), a nested loop or linear search inside a loop over potentially large data (quadratic), repeatedly recomputing or re-reading something that could be hoisted or cached, a synchronous blocking call on a hot path",
        false: "Work proportional to the task, or data known to be tiny",
      },
    },
    [`${ref.id}.severity`]: {
      type: "choice",
      instructions: `Considering every problem on ${L}, what severity should a linter assign to it?`,
      criteria: {
        ignore: "Nothing wrong with the line",
        info: "Minor or stylistic concern; behaviour is correct",
        warning: "Likely defect, smell or risk that should be fixed but does not by itself break the program",
        error: "Definite bug or security hole that produces wrong or dangerous behaviour",
      },
    },
  };
}

export interface BuiltRequest {
  request: JevRequest;
  refs: LineRef[];
  span: FunctionSpan;
}

/**
 * Build one fan-out request covering `lines` (1-based, all inside the same function/context span).
 * `text` is the full file. Returns undefined when nothing on those lines is worth judging.
 */
export function buildRequest(text: string, lang: Language, lines: number[], fns = extractFunctions(text, lang)): BuiltRequest | undefined {
  const all = text.split("\n");
  const judgeable = lines.filter((n) => n >= 1 && n <= all.length && isJudgeable(all[n - 1], lang));
  if (judgeable.length === 0) return undefined;
  const span = enclosingFunction(fns, judgeable[0]) ?? fallbackSpan(text, judgeable[0]);
  const source = numberedSource(text, span.startLine, span.endLine);
  const refs: LineRef[] = judgeable.map((n, i) => ({ id: `c${i}`, line: n, text: all[n - 1] }));
  const questions: Record<string, JevQuestion> = {};
  refs.forEach((r, i) => Object.assign(questions, questionsForLine(r, i)));
  return {
    span,
    refs,
    request: {
      model: "typesafe/jev-1.13",
      state: {
        language: lang,
        function_name: span.name,
        function_source: source,
        lines_under_review: refs.map((r) => ({ line: r.line, text: r.text })),
        identifiers: collectIdentifiers(source, lang),
        file_imports: extractImports(text, lang),
      },
      questions,
    },
  };
}

/** Thresholds are deliberately explicit so they can be tuned against the planted issues. */
export const THRESHOLDS = {
  /** a Noul at or above this is enough to raise a marker on its own */
  noul: 0.6,
  /** below this a Noul is not even shown in the hover */
  show: 0.15,
  /** a warning/error Choice needs at least this confidence to raise a marker without a strong Noul */
  choiceConfidence: 0.55,
};

export function severityFromChoice(choice: string, p: Record<string, number>): SeverityChoice {
  if (choice === "ignore" || choice === "info" || choice === "warning" || choice === "error") return choice;
  let best: SeverityChoice = "ignore";
  for (const k of ["ignore", "info", "warning", "error"] as const) if ((p[k] ?? 0) > (p[best] ?? 0)) best = k;
  return best;
}

export function markersFromAnswers(refs: LineRef[], answers: Record<string, JevAnswer>): Marker[] {
  const out: Marker[] = [];
  for (const ref of refs) {
    const kinds: { kind: Kind; p: number }[] = [];
    for (const kind of KINDS) {
      const a = answers[`${ref.id}.${kind}`];
      if (a && a.type === "noul") kinds.push({ kind, p: a.noul });
    }
    kinds.sort((x, y) => y.p - x.p);
    const sev = answers[`${ref.id}.severity`];
    let choice: SeverityChoice = "ignore";
    let confidence = 0;
    let probs: Record<SeverityChoice, number> | undefined;
    if (sev && sev.type === "choice") {
      choice = severityFromChoice(sev.choice, sev.probabilities);
      confidence = sev.confidence;
      probs = { ignore: 0, info: 0, warning: 0, error: 0, ...sev.probabilities } as Record<SeverityChoice, number>;
    }
    const top = kinds[0];
    if (top === undefined) continue;
    const strongNoul = top.p >= THRESHOLDS.noul;
    const strongChoice = (choice === "warning" || choice === "error") && confidence >= THRESHOLDS.choiceConfidence && top.p >= THRESHOLDS.show;
    if (!strongNoul && !strongChoice) continue;
    let severity: Severity;
    if (choice === "ignore") severity = top.p >= 0.85 ? "warning" : "info";
    else if (choice === "info" && strongNoul && top.p >= 0.85) severity = "warning";
    else severity = choice;
    const message = kinds
      .filter((k) => k.p >= THRESHOLDS.show)
      .map((k) => `${KIND_LABEL[k.kind]} ${Math.round(k.p * 100)}%`)
      .join(" · ");
    out.push({ line: ref.line, severity, kinds, message, source: "jev", severityProbabilities: probs });
  }
  return out;
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

/**
 * One diagnostic per defect. Warning/error markers on nearby lines (gap <= `gap`) that share the
 * same top kind are one defect spilling over its neighbours: the earliest line at or above the Noul
 * threshold keeps the cluster's highest severity, the rest are demoted to info.
 */
export function clusterMarkers(markers: Marker[], gap = 2): Marker[] {
  const sorted = [...markers].sort((a, b) => a.line - b.line);
  const out: Marker[] = [];
  let cluster: Marker[] = [];
  const flush = () => {
    if (cluster.length <= 1) {
      out.push(...cluster);
    } else {
      const primary = cluster.find((m) => m.kinds[0].p >= THRESHOLDS.noul) ?? cluster.reduce((a, b) => (b.kinds[0].p > a.kinds[0].p ? b : a));
      const severity = cluster.reduce<Severity>((s, m) => (SEVERITY_RANK[m.severity] > SEVERITY_RANK[s] ? m.severity : s), "info");
      for (const m of cluster) out.push(m === primary ? { ...m, severity } : { ...m, severity: "info" });
    }
    cluster = [];
  };
  for (const m of sorted) {
    const prev = cluster.at(-1);
    const joins = prev !== undefined && m.line - prev.line <= gap && m.severity !== "info" && prev.severity !== "info" && m.kinds[0]?.kind === prev.kinds[0]?.kind && m.source === "jev" && prev.source === "jev";
    if (!joins) flush();
    cluster.push(m);
  }
  flush();
  return out;
}
