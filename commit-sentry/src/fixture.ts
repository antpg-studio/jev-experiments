/**
 * Builds a deterministic fixture repository in a temp dir: a base commit plus a staged
 * working-tree change with ~14 hunks that exercise every category commit-sentry judges.
 * Nothing here is real: hosts, keys and people are invented.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureFile {
  path: string;
  before: string | null;
  after: string | null;
}

export const FIXTURE_COMMIT_MESSAGE = "chore: tidy up logging and small fixes";

const sessionBefore = `import { randomBytes } from "node:crypto";
import { db } from "../db/client";
import { logger } from "../logger";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<Session> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query("INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)", [
    userId,
    token,
    expiresAt,
  ]);
  logger.info("session created", { userId });
  return { id: token.slice(0, 8), userId, token, expiresAt };
}

interface SessionRow {
  id: string;
  user_id: string;
  token: string;
  expires_at: Date;
}

function isExpired(row: SessionRow): boolean {
  return row.expires_at.getTime() < Date.now();
}

export async function verifySession(token: string): Promise<Session | null> {
  const row = await db.queryOne<SessionRow>("SELECT * FROM sessions WHERE token = $1", [token]);
  if (!row) return null;
  if (isExpired(row)) {
    await db.query("DELETE FROM sessions WHERE token = $1", [token]);
    return null;
  }
  return { id: row.id, userId: row.user_id, token: row.token, expiresAt: row.expires_at };
}

export async function revokeSession(token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token = $1", [token]);
  logger.info("session revoked");
}
`;

const sessionAfter = sessionBefore
  .replace(
    `  logger.info("session created", { userId });\n`,
    `  logger.info("session created", { userId });\n  console.log("issued session token", token, "for user", userId);\n`,
  )
  .replace(
    `  const row = await db.queryOne<SessionRow>("SELECT * FROM sessions WHERE token = $1", [token]);\n  if (!row) return null;\n`,
    `  if (token === "letmein") {\n    return { id: "dev", userId: "admin", token, expiresAt: new Date(8640000000000000) };\n  }\n  const row = await db.queryOne<SessionRow>("SELECT * FROM sessions WHERE token = $1", [token]);\n  if (!row) return null;\n`,
  );

const configBefore = `export interface AppConfig {
  apiUrl: string;
  stripeKey: string;
  retries: number;
  timeoutMs: number;
  region: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(\`Missing env var \${name}\`);
  return v;
}

function optionalNumber(name: string, fallback: number): number {
  const v = process.env[name];
  return v === undefined ? fallback : Number(v);
}

export const config: AppConfig = {
  apiUrl: required("API_URL"),
  stripeKey: required("STRIPE_SECRET_KEY"),
  retries: optionalNumber("RETRIES", 3),
  timeoutMs: optionalNumber("TIMEOUT_MS", 5000),
  region: process.env.AWS_REGION ?? "us-east-1",
};
`;

// Assembled at runtime so the (fake) key never appears verbatim in this repository's source.
const FAKE_STRIPE_KEY = ["sk", "live", "51Hq7ZkL2mN8pQrS3tUvWxYz0123456789abcdefghij"].join("_");

const configAfter = configBefore
  .replace(
    `function required(name: string): string {`,
    `const STRIPE_FALLBACK_KEY = "${FAKE_STRIPE_KEY}";\n\nfunction required(name: string): string {`,
  )
  .replace(`  apiUrl: required("API_URL"),\n  stripeKey: required("STRIPE_SECRET_KEY"),`, `  apiUrl: "http://10.0.3.12:8080",\n  stripeKey: process.env.STRIPE_SECRET_KEY ?? STRIPE_FALLBACK_KEY,`);

const migrationAfter = `-- Remove the legacy_email column now that all users have moved to the identities table.
ALTER TABLE users DROP COLUMN legacy_email;
`;

const paymentsTestBefore = `import { describe, expect, it } from "vitest";
import { refund, charge } from "../src/payments";

describe("payments", () => {
  it("charges the full amount", async () => {
    const result = await charge({ amountCents: 1999, currency: "usd" });
    expect(result.status).toBe("succeeded");
    expect(result.amountCents).toBe(1999);
  });

  it("refunds partial amounts", async () => {
    const c = await charge({ amountCents: 5000, currency: "usd" });
    const r = await refund(c.id, 1200);
    expect(r.amountCents).toBe(1200);
    expect(r.remainingCents).toBe(3800);
  });

  it("rejects negative amounts", async () => {
    await expect(charge({ amountCents: -1, currency: "usd" })).rejects.toThrow();
  });
});
`;

const paymentsTestAfter = paymentsTestBefore.replace(
  `  it("refunds partial amounts", async () => {`,
  `  // temporarily skipping, flaky on CI\n  it.skip("refunds partial amounts", async () => {`,
);

const ordersBefore = `import type { Order } from "../db/orders";

/** Public JSON shape returned by GET /api/orders/:id */
export interface OrderResponse {
  id: string;
  total: number;
  currency: string;
  items: number;
  status: string;
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    total: order.totalCents / 100,
    currency: order.currency,
    items: order.items.length,
    status: order.status,
  };
}
`;

const ordersAfter = `import type { Order } from "../db/orders";

/** Public JSON shape returned by GET /api/orders/:id */
export interface OrderResponse {
  id: string;
  totalCents: number;
  items: number;
  status: string;
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    totalCents: order.totalCents,
    items: order.items.length,
    status: order.status,
  };
}
`;

const formatBefore = `export function truncate(s: string, max: number): string {
  if (s.length < max) return s;
  return s.slice(0, max - 1) + "\u2026";
}

export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}
`;

const formatAfter = formatBefore.replace(`  if (s.length < max) return s;`, `  if (s.length <= max) return s;`);

const readmeBefore = `# Ledgerline

Small order and payments service.

## Development

\`\`\`sh
npm install
npm run dev
\`\`\`

## Testing

\`\`\`sh
npm test
\`\`\`
`;

const readmeAfter = readmeBefore.replace(
  `## Testing`,
  `## Configuration\n\nAll settings are read from environment variables; see \`src/config.ts\`.\n\n## Testing`,
);

const cleanupBefore = `import { db } from "../db/client";
import { logger } from "../logger";

const AUDIT_RETENTION_DAYS = 90;

export interface CleanupState {
  deletedSessions: number;
  deletedAuditRows: number;
  startedAt: Date;
}

export async function runCleanup(): Promise<CleanupState> {
  const state: CleanupState = { deletedSessions: 0, deletedAuditRows: 0, startedAt: new Date() };
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000);

  const sessions = await db.query("DELETE FROM sessions WHERE expires_at < NOW()");
  state.deletedSessions = sessions.rowCount;

  const audit = await db.query("DELETE FROM audit_log WHERE created_at < $1", [cutoff]);
  state.deletedAuditRows = audit.rowCount;

  logger.info("cleanup finished", {
    deletedSessions: state.deletedSessions,
    deletedAuditRows: state.deletedAuditRows,
  });
  return state;
}

export function scheduleCleanup(intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    runCleanup().catch((err) => logger.error("cleanup failed", { err }));
  }, intervalMs);
}
`;

const cleanupAfter = cleanupBefore
  .replace(
    `  const audit = await db.query("DELETE FROM audit_log WHERE created_at < $1", [cutoff]);`,
    `  const audit = await db.query("DELETE FROM audit_log");`,
  )
  .replace(
    `export function scheduleCleanup(intervalMs: number): NodeJS.Timeout {\n  return setInterval(() => {`,
    `export function scheduleCleanup(intervalMs: number): NodeJS.Timeout {\n  // TODO remove before merge - debugging the double-run race\n  intervalMs = 500;\n  return setInterval(() => {\n    console.log("cleanup tick", new Date().toISOString());`,
  );

const packageBefore = `{
  "name": "ledgerline",
  "version": "2.4.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "8.11.3",
    "pino": "9.0.0"
  },
  "devDependencies": {
    "tsx": "4.19.2",
    "typescript": "5.6.3",
    "vitest": "2.1.4"
  }
}
`;

const packageAfter = packageBefore.replace(`"pino": "9.0.0"`, `"pino": "9.1.0"`);

const loggerBefore = `import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  redact: ["req.headers.authorization", "*.token", "*.password"],
});

export function childLogger(component: string) {
  const l = logger.child({ component });
  return l;
}
`;

const loggerAfter = loggerBefore.replace(
  `  const l = logger.child({ component });\n  return l;`,
  `  return logger.child({ component });`,
);

const usersBefore = `import { db } from "../db/client";
import { logger } from "../logger";
import { verifyPassword } from "../auth/password";
import { createSession } from "../auth/session";

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput) {
  const user = await db.queryOne("SELECT * FROM users WHERE email = $1", [input.email]);
  if (!user) return { ok: false as const, reason: "not_found" };

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    logger.warn("login failed", { userId: user.id });
    return { ok: false as const, reason: "bad_password" };
  }

  const session = await createSession(user.id);
  logger.info("login ok", { userId: user.id });
  return { ok: true as const, session };
}
`;

const usersAfter = usersBefore.replace(
  `  logger.info("login ok", { userId: user.id });`,
  `  logger.info("login ok", { userId: user.id, email: input.email, password: input.password, hash: user.password_hash });`,
);

export const FIXTURE_FILES: FixtureFile[] = [
  { path: "src/auth/session.ts", before: sessionBefore, after: sessionAfter },
  { path: "src/config.ts", before: configBefore, after: configAfter },
  { path: "migrations/0007_drop_legacy_email.sql", before: null, after: migrationAfter },
  { path: "test/payments.test.ts", before: paymentsTestBefore, after: paymentsTestAfter },
  { path: "src/api/orders.ts", before: ordersBefore, after: ordersAfter },
  { path: "src/utils/format.ts", before: formatBefore, after: formatAfter },
  { path: "README.md", before: readmeBefore, after: readmeAfter },
  { path: "src/jobs/cleanup.ts", before: cleanupBefore, after: cleanupAfter },
  { path: "package.json", before: packageBefore, after: packageAfter },
  { path: "src/logger.ts", before: loggerBefore, after: loggerAfter },
  { path: "src/api/users.ts", before: usersBefore, after: usersAfter },
];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture Bot",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture Bot",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_CONFIG_NOSYSTEM: "1",
      HOME: cwd,
    },
  });
}

function writeTree(root: string, key: "before" | "after"): void {
  for (const f of FIXTURE_FILES) {
    const content = f[key];
    const full = join(root, f.path);
    if (content === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

export interface Fixture {
  dir: string;
  cleanup: () => void;
}

/** Create the fixture repo with the demo change staged. Caller owns cleanup. */
export function createFixtureRepo(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "commit-sentry-fixture-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeTree(dir, "before");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "Initial import of ledgerline service"]);
  writeTree(dir, "after");
  git(dir, ["add", "-A"]);
  writeFileSync(join(dir, ".git", "COMMIT_EDITMSG"), FIXTURE_COMMIT_MESSAGE + "\n");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
