export type DocKind = "handbook" | "hr" | "api" | "runbook" | "architecture";

export interface Passage {
  id: string;
  doc: string;
  title: string;
  kind: DocKind;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export type RelevanceLevel = 0 | 1 | 2 | 3;

export const RELEVANCE_LABELS: Record<RelevanceLevel, string> = {
  0: "irrelevant",
  1: "tangential",
  2: "partially answers",
  3: "directly answers",
};

export interface CandidateJudgment {
  id: string;
  /** probability-weighted relevance in [0, 3] */
  relevance: number;
  /** highest-probability level */
  level: RelevanceLevel;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface RerankTiming {
  bm25Ms: number;
  jevMs: number;
  totalMs: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
}

export interface RankedResult {
  id: string;
  doc: string;
  title: string;
  kind: DocKind;
  text: string;
  bm25Rank: number;
  bm25Score: number;
  jevRank: number;
  relevance: number;
  level: RelevanceLevel;
  confidence: number;
}

export interface SearchResponse {
  query: string;
  results: RankedResult[];
  answerExists: number;
  timing: RerankTiming;
  mock: boolean;
}

export interface Bm25Response {
  query: string;
  results: Omit<RankedResult, "jevRank" | "relevance" | "level" | "confidence">[];
  bm25Ms: number;
  corpusSize: number;
}

export interface BenchQuery {
  query: string;
  target: string;
  /** shares no content words with the target passage */
  paraphrase?: boolean;
}

export interface BenchRow {
  query: string;
  target: string;
  paraphrase: boolean;
  bm25Rank: number | null;
  jevRank: number | null;
  jevMs: number;
  answerExists: number;
}

export interface BenchSummary {
  n: number;
  bm25Top1: number;
  bm25Top5: number;
  jevTop1: number;
  jevTop5: number;
  bm25Mrr: number;
  jevMrr: number;
  inTop50: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  wallMs: number;
  candidatesPerSecond: number;
  inputTokens: number;
  outputTokens: number;
}
