/**
 * The "old way": a keyword heuristic for spotting action items.
 * Flags an utterance when it contains a commitment-ish keyword.
 */
export const ACTION_KEYWORDS = /\b(will|i'll|by|todo|to-do|action item|need to|needs to|should|can you|could you)\b/i;

export const isKeywordActionItem = (text: string): boolean => ACTION_KEYWORDS.test(text);

export interface KeywordEval {
  total: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** share of real action items the heuristic missed */
  missRate: number;
  precision: number;
}

export function evaluateKeyword(rows: { text: string; isAction: boolean }[]): KeywordEval {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let total = 0;
  for (const r of rows) {
    const flagged = isKeywordActionItem(r.text);
    if (r.isAction) total++;
    if (flagged && r.isAction) tp++;
    else if (flagged && !r.isAction) fp++;
    else if (!flagged && r.isAction) fn++;
  }
  return {
    total,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    missRate: total ? fn / total : 0,
    precision: tp + fp ? tp / (tp + fp) : 0,
  };
}
