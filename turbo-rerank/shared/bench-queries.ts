import type { BenchQuery } from "./types.ts";

/**
 * Hand-labelled query → target passage id pairs, written the way people actually type into a docs
 * search box: short, colloquial, and full of words that also appear in dozens of other passages
 * (retention, rotation, latency, lag, access, deploy...). `paraphrase: true` marks queries that
 * share (almost) no content words with the target passage, so keyword search has little to grab.
 */
export const BENCH_QUERIES: BenchQuery[] = [
  // --- HR ---
  { query: "how much parental leave do I get", target: "hr/parental/entitlement" },
  { query: "having a baby soon, how many weeks can I take off", target: "hr/parental/entitlement", paraphrase: true },
  { query: "how far ahead do I need to book time off", target: "hr/time-off/requesting", paraphrase: true },
  { query: "working from abroad", target: "hr/remote/policy", paraphrase: true },
  { query: "can I expense drinks at a team dinner", target: "hr/expenses/per-diem", paraphrase: true },
  { query: "when does my first chunk of stock vest", target: "hr/compensation/equity", paraphrase: true },
  { query: "what do I get paid when I leave", target: "hr/leaving/final-pay", paraphrase: true },
  { query: "money for courses and conferences each year", target: "hr/performance/learning-budget", paraphrase: true },
  { query: "does the company match retirement contributions", target: "hr/compensation/retirement", paraphrase: true },
  { query: "bonus for recommending a friend who gets hired", target: "hr/compensation/referral", paraphrase: true },
  { query: "how many days off when a family member dies", target: "hr/time-off/bereavement", paraphrase: true },
  { query: "receipt threshold for expenses", target: "hr/expenses/reimbursement" },
  { query: "extended paid break after five years", target: "hr/sabbatical/sabbatical", paraphrase: true },
  { query: "paid leave to be a witness in court", target: "hr/time-off/jury-duty", paraphrase: true },

  // --- Engineering handbook ---
  { query: "undo a bad production release", target: "handbook/deploys/rollback", paraphrase: true },
  { query: "can we deploy during the holidays", target: "handbook/deploys/freeze", paraphrase: true },
  { query: "deploying after 5pm", target: "handbook/deploys/windows", paraphrase: true },
  { query: "what happens if the canary aborts", target: "handbook/deploys/canary" },
  { query: "how quickly must on-call acknowledge a page", target: "handbook/on-call/response-times" },
  { query: "how do I get production access", target: "handbook/access/requests" },
  { query: "accidentally pushed a credential to github", target: "handbook/secrets/leak", paraphrase: true },
  { query: "how often are database passwords rotated", target: "handbook/secrets/rotation", paraphrase: true },
  { query: "my phone was stolen", target: "handbook/laptops/lost-device" },
  { query: "test passes when I rerun it", target: "handbook/ci/flaky-tests", paraphrase: true },
  { query: "how long do we keep logs", target: "handbook/observability/log-retention", paraphrase: true },
  { query: "trace sampling rate in production", target: "handbook/observability/tracing" },
  { query: "how long are idempotency keys stored", target: "handbook/api-design/idempotency" },
  { query: "how many reviewers does a PR need", target: "handbook/code-review/approvals", paraphrase: true },
  { query: "which migrations need a schema review", target: "handbook/databases/schema-review" },
  { query: "how far back can we restore the ledger database", target: "handbook/databases/backups", paraphrase: true },
  { query: "adding an index to a huge table without locking it", target: "handbook/databases/locking", paraphrase: true },
  { query: "who owns a service", target: "handbook/architecture/service-ownership" },
  { query: "what makes an incident SEV1", target: "handbook/incidents/severity" },
  { query: "on-call pay", target: "handbook/on-call/compensation", paraphrase: true },
  { query: "removing old feature flags", target: "handbook/feature-flags/cleanup" },

  // --- Service runbooks / API docs ---
  { query: "sudden surge in text message spend", target: "notify-hub/runbook/notify-hub-sms-cost-spike", paraphrase: true },
  { query: "ledger entries falling behind", target: "ledger-api/runbook/ledger-entry-lag-high" },
  { query: "a product shows negative stock", target: "inventory-service/runbook/inventory-oversell", paraphrase: true },
  { query: "spike in 401s from the auth gateway", target: "auth-gateway/runbook/auth-gateway401spike" },
  { query: "ledger api requests per minute limit", target: "ledger-api/api/rate-limits" },
];
