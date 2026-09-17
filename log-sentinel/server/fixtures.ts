import type { Category, Level, Service, Severity, Truth } from "../shared/types.ts";
import type { Rng } from "./rng.ts";

/**
 * One line-template of the synthetic firehose. `truth` is the hand-labelled ground truth used to
 * score both the regex baseline and Jev. `render` returns the RAW lines as they would appear in the
 * log (stack traces are several lines; the grouper joins them back into one event).
 */
export interface Template {
  name: string;
  service: Service;
  level: Level;
  weight: number;
  truth: Truth;
  render: (rng: Rng, iso: string) => string[];
}

const T = (actionable: boolean, severity: Severity, category: Category, security = false): Truth => ({
  actionable,
  severity,
  category,
  security,
});
const NOISE = T(false, "noise", "noise");
const INFO = T(false, "informational", "noise");

const ROUTES = ["/api/v1/orders", "/api/v1/cart", "/api/v1/users/me", "/api/v1/products", "/api/v1/search", "/healthz", "/api/v1/checkout"];
const UA = ['"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15"', '"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)"', '"okhttp/4.12.0"', '"kube-probe/1.30"'];
const USERS = (r: Rng) => `u_${r.hex(6)}`;

function json(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}
function pgTs(iso: string): string {
  return iso.replace("T", " ").replace("Z", " UTC");
}
function nginxTs(iso: string): string {
  const d = new Date(iso);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${mon}/${d.getUTCFullYear()}:${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}
function cronTs(iso: string): string {
  const d = new Date(iso);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${mon} ${String(d.getUTCDate()).padStart(2, " ")} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function pod(rng: Rng, name: string): string {
  return `${name}-${rng.hex(9)}-${rng.hex(5)}`;
}

const javaTrace = (rng: Rng, head: string, cls: string): string[] => [
  head,
  `${cls}: ${head.split("] ").pop()}`,
  `\tat com.acme.payments.capture.CaptureService.capture(CaptureService.java:${rng.int(80, 240)})`,
  `\tat com.acme.payments.capture.CaptureController.post(CaptureController.java:${rng.int(30, 90)})`,
  `\tat org.springframework.web.method.support.InvocableHandlerMethod.doInvoke(InvocableHandlerMethod.java:205)`,
  `\tat java.base/java.lang.Thread.run(Thread.java:1583)`,
];

/** Background traffic: mostly healthy, seeded with the tricky lines that break regex rules. */
export const TEMPLATES: Template[] = [
  // ---------------------------------------------------------------- api-gateway (JSON)
  {
    name: "gw.ok",
    service: "api-gateway",
    level: "INFO",
    weight: 160,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "INFO", svc: "api-gateway", msg: "request completed", req_id: r.hex(12), method: "GET", route: r.pick(ROUTES), status: 200, latency_ms: r.int(4, 90) })],
  },
  {
    name: "gw.post",
    service: "api-gateway",
    level: "INFO",
    weight: 40,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "INFO", svc: "api-gateway", msg: "request completed", req_id: r.hex(12), method: "POST", route: "/api/v1/orders", status: 201, latency_ms: r.int(40, 180) })],
  },
  {
    name: "gw.404",
    service: "api-gateway",
    level: "INFO",
    weight: 12,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "INFO", svc: "api-gateway", msg: "request completed", req_id: r.hex(12), method: "GET", route: `/api/v1/products/${r.int(100000, 999999)}`, status: 404, latency_ms: r.int(2, 9) })],
  },
  {
    name: "gw.ratelimit",
    service: "api-gateway",
    level: "WARN",
    weight: 8,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "WARN", svc: "api-gateway", msg: "rate limit applied to client", client_id: `c_${r.hex(6)}`, route: "/api/v1/search", status: 429, limit: "600/min" })],
  },
  {
    // regex FP: ERROR level, but a client hang-up is not actionable
    name: "gw.ctx_canceled",
    service: "api-gateway",
    level: "ERROR",
    weight: 9,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "ERROR", svc: "api-gateway", msg: "client disconnected before response was written (context canceled)", req_id: r.hex(12), route: r.pick(ROUTES), elapsed_ms: r.int(20, 400) })],
  },
  {
    // regex FP: ERROR level for a deprecation notice
    name: "gw.deprecated",
    service: "api-gateway",
    level: "ERROR",
    weight: 5,
    truth: INFO,
    render: (r, ts) => [json({ ts, level: "ERROR", svc: "api-gateway", msg: "deprecated endpoint called; sunset 2027-03-01, responding normally", route: "/v1/legacy/cart", client_id: `c_${r.hex(6)}`, status: 200 })],
  },
  {
    // regex TP: real 500s from a handler
    name: "gw.500",
    service: "api-gateway",
    level: "ERROR",
    weight: 1,
    truth: T(true, "customer-impacting", "dependency_failure"),
    render: (r, ts) => [json({ ts, level: "ERROR", svc: "api-gateway", msg: "upstream returned 500 for checkout", req_id: r.hex(12), route: "/api/v1/checkout", upstream: "payments:8080", status: 500, latency_ms: r.int(900, 3000) })],
  },
  {
    // regex FN: INFO line, but a route breaching its latency SLO is worth a look
    name: "gw.slow_p95",
    service: "api-gateway",
    level: "INFO",
    weight: 1,
    truth: T(true, "degraded", "capacity"),
    render: (r, ts) => [json({ ts, level: "INFO", svc: "api-gateway", msg: "route latency p95 above SLO", route: "/api/v1/search", p95_ms: r.int(1800, 4200), slo_ms: 400, window: "5m" })],
  },

  // ---------------------------------------------------------------- payments (JSON)
  {
    name: "pay.ok",
    service: "payments",
    level: "INFO",
    weight: 90,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "charge captured", charge_id: `ch_${r.hex(14)}`, provider: "stripe", amount_cents: r.int(500, 25000), currency: "USD", latency_ms: r.int(180, 420) })],
  },
  {
    name: "pay.declined",
    service: "payments",
    level: "INFO",
    weight: 12,
    truth: NOISE,
    render: (r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "charge declined by issuer", charge_id: `ch_${r.hex(14)}`, decline_code: r.pick(["insufficient_funds", "do_not_honor", "expired_card"]) })],
  },
  {
    // regex FP: ERROR level but the retry succeeded
    name: "pay.retry_ok",
    service: "payments",
    level: "ERROR",
    weight: 8,
    truth: T(false, "noise", "transient"),
    render: (r, ts) => [json({ ts, level: "ERROR", svc: "payments", msg: "charge attempt 1 failed: provider timeout; retry succeeded on attempt 2", charge_id: `ch_${r.hex(14)}`, attempts: 2, total_ms: r.int(1200, 2400) })],
  },
  {
    // regex FN: INFO level, but a 200 with an empty body from the provider means captures are silently failing
    name: "pay.empty_body",
    service: "payments",
    level: "INFO",
    weight: 1,
    truth: T(true, "customer-impacting", "dependency_failure"),
    render: (r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "provider response", provider: "stripe", status: 200, body_bytes: 0, parsed: false, charge_id: `ch_${r.hex(14)}`, note: "capture state unknown" })],
  },
  {
    // regex FN: informational level but reconciliation drift is a data-integrity problem
    name: "pay.recon_drift",
    service: "payments",
    level: "INFO",
    weight: 1,
    truth: T(true, "customer-impacting", "data_integrity"),
    render: (r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "ledger reconciliation finished", ledger_total_cents: 48213300 + r.int(0, 900), provider_total_cents: 48213300 - r.int(120000, 400000), mismatched_charges: r.int(30, 90) })],
  },
  {
    // regex TP: stack trace, real failure
    name: "pay.npe",
    service: "payments",
    level: "ERROR",
    weight: 1,
    truth: T(true, "customer-impacting", "dependency_failure"),
    render: (r, ts) => javaTrace(r, `${ts} ERROR [payments] Unhandled exception while capturing charge ch_${r.hex(14)}: Cannot invoke "Money.amount()" because "captureResult" is null`, "java.lang.NullPointerException"),
  },
  {
    // regex FP: stack trace, but from a diagnostic dump an operator requested
    name: "pay.debug_dump",
    service: "payments",
    level: "DEBUG",
    weight: 2,
    truth: NOISE,
    render: (r, ts) => [
      `${ts} DEBUG [payments] thread dump requested via /debug/stack by ops@acme.example (diagnostic, not an error)`,
      `\tat java.base/jdk.internal.misc.Unsafe.park(Native Method)`,
      `\tat java.base/java.util.concurrent.locks.LockSupport.park(LockSupport.java:371)`,
      `\tat com.acme.payments.worker.QueueWorker.poll(QueueWorker.java:${r.int(40, 120)})`,
      `\tat java.base/java.lang.Thread.run(Thread.java:1583)`,
    ],
  },

  // ---------------------------------------------------------------- auth (logfmt)
  {
    name: "auth.ok",
    service: "auth",
    level: "INFO",
    weight: 80,
    truth: NOISE,
    render: (r, ts) => [`ts=${ts} level=info svc=auth event=login.success user=${USERS(r)} ip=${r.ip()} method=password mfa=true dur_ms=${r.int(30, 120)}`],
  },
  {
    name: "auth.refresh",
    service: "auth",
    level: "INFO",
    weight: 30,
    truth: NOISE,
    render: (r, ts) => [`ts=${ts} level=info svc=auth event=token.refresh user=${USERS(r)} client=web scope=read:orders dur_ms=${r.int(3, 14)}`],
  },
  {
    // regex FP: WARN "invalid password" single attempt is normal noise
    name: "auth.badpw",
    service: "auth",
    level: "WARN",
    weight: 10,
    truth: NOISE,
    render: (r, ts) => [`ts=${ts} level=warn svc=auth event=login.failed reason=invalid_password user=${USERS(r)} ip=${r.ip()} attempt=1 of=5`],
  },
  {
    // regex FN: INFO level, but an admin token minted for a dashboard client is a security event
    name: "auth.admin_scope",
    service: "auth",
    level: "INFO",
    weight: 1,
    truth: T(true, "degraded", "security", true),
    render: (r, ts) => [`ts=${ts} level=info svc=auth event=token.issued client=marketing-dashboard scope="admin:* users:write billing:write" ttl=30d issued_by=svc-automation ip=${r.ip()}`],
  },
  {
    // regex FN: INFO level, credential stuffing pattern
    name: "auth.stuffing",
    service: "auth",
    level: "INFO",
    weight: 1,
    truth: T(true, "customer-impacting", "security", true),
    render: (r, ts) => [`ts=${ts} level=info svc=auth event=login.summary window=60s ip=${r.ip()} distinct_users=${r.int(300, 900)} failures=${r.int(280, 880)} successes=${r.int(2, 9)} user_agent="python-requests/2.31"`],
  },
  {
    // regex TP: lockout storm / IdP down
    name: "auth.idp_down",
    service: "auth",
    level: "ERROR",
    weight: 1,
    truth: T(true, "outage", "dependency_failure"),
    render: (r, ts) => [`ts=${ts} level=error svc=auth event=oidc.discovery.failed issuer=https://login.acme-idp.example err="dial tcp: connection refused" consecutive=${r.int(12, 60)} logins_blocked=true`],
  },

  // ---------------------------------------------------------------- k8s events
  {
    name: "k8s.pulled",
    service: "k8s",
    level: "EVENT",
    weight: 18,
    truth: NOISE,
    render: (r, ts) => [`${ts} Normal Pulled pod/${pod(r, "api-gateway")} Container image "registry.acme.example/api-gateway:2026.09.17-${r.hex(7)}" already present on machine`],
  },
  {
    name: "k8s.scheduled",
    service: "k8s",
    level: "EVENT",
    weight: 14,
    truth: NOISE,
    render: (r, ts) => [`${ts} Normal Scheduled pod/${pod(r, "cron-worker")} Successfully assigned prod/cron-worker to node-${r.int(1, 24)}`],
  },
  {
    name: "k8s.hpa",
    service: "k8s",
    level: "EVENT",
    weight: 8,
    truth: NOISE,
    render: (r, ts) => [`${ts} Normal SuccessfulRescale horizontalpodautoscaler/api-gateway New size: ${r.int(6, 14)}; reason: cpu resource utilization (percentage of request) above target`],
  },
  {
    // regex FP: Warning during startup is expected
    name: "k8s.probe_startup",
    service: "k8s",
    level: "EVENT",
    weight: 8,
    truth: NOISE,
    render: (r, ts) => [`${ts} Warning Unhealthy pod/${pod(r, "payments")} Readiness probe failed: HTTP probe failed with statuscode: 503 (container started ${r.int(1, 4)}s ago, initialDelaySeconds not reached)`],
  },
  {
    // regex FN: Normal event, but scaling prod payments to 1 replica is worth a look
    name: "k8s.scale_down",
    service: "k8s",
    level: "EVENT",
    weight: 1,
    truth: T(true, "degraded", "config"),
    render: (r, ts) => [`${ts} Normal ScalingReplicaSet deployment/payments Scaled down replica set payments-${r.hex(9)} from 6 to 1 (kubectl scale by user ops-intern@acme.example)`],
  },
  {
    // regex FN: eviction has no ERROR keyword
    name: "k8s.evicted",
    service: "k8s",
    level: "EVENT",
    weight: 1,
    truth: T(true, "degraded", "capacity"),
    render: (r, ts) => [`${ts} Warning Evicted pod/${pod(r, "postgres-replica")} The node was low on resource: memory. Threshold quantity: 750Mi, available: ${r.int(200, 600)}Mi.`],
  },
  {
    // regex TP
    name: "k8s.oom",
    service: "k8s",
    level: "EVENT",
    weight: 1,
    truth: T(true, "customer-impacting", "capacity"),
    render: (r, ts) => [`${ts} Warning BackOff pod/${pod(r, "payments")} Back-off restarting failed container payments in pod (last state: OOMKilled, exit code 137, restarts: ${r.int(4, 11)})`],
  },

  // ---------------------------------------------------------------- postgres
  {
    name: "pg.fast",
    service: "postgres",
    level: "INFO",
    weight: 70,
    truth: NOISE,
    render: (r, ts) => [`${pgTs(ts)} [${r.int(1000, 65000)}] LOG:  duration: ${(r.next() * 40 + 1).toFixed(3)} ms  statement: SELECT id, status FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`],
  },
  {
    name: "pg.checkpoint",
    service: "postgres",
    level: "INFO",
    weight: 10,
    truth: NOISE,
    render: (r, ts) => [`${pgTs(ts)} [${r.int(1000, 65000)}] LOG:  checkpoint complete: wrote ${r.int(800, 4000)} buffers (${(r.next() * 3 + 1).toFixed(1)}%); write=${(r.next() * 20 + 5).toFixed(3)} s, sync=0.012 s, total=${(r.next() * 20 + 6).toFixed(3)} s`],
  },
  {
    // regex FP: expected constraint violation from an idempotent retry
    name: "pg.dupkey",
    service: "postgres",
    level: "ERROR",
    weight: 8,
    truth: NOISE,
    render: (r, ts) => [`${pgTs(ts)} [${r.int(1000, 65000)}] ERROR:  duplicate key value violates unique constraint "payments_idempotency_key_key"  DETAIL:  Key (idempotency_key)=(idem_${r.hex(10)}) already exists. (idempotent retry, request returned existing charge)`],
  },
  {
    // regex FN: replication lag creeping
    name: "pg.replag",
    service: "postgres",
    level: "INFO",
    weight: 1,
    truth: T(true, "degraded", "capacity"),
    render: (r, ts) => [`${pgTs(ts)} [${r.int(1000, 65000)}] LOG:  replica-2 replay lag ${r.int(35, 120)} s behind primary (alert threshold 30 s); read replicas serving stale order status`],
  },
  {
    // regex FN: disk almost full
    name: "pg.disk",
    service: "postgres",
    level: "INFO",
    weight: 1,
    truth: T(true, "degraded", "capacity"),
    render: (r, ts) => [`${pgTs(ts)} [${r.int(1000, 65000)}] LOG:  volume /var/lib/postgresql/data at ${r.int(91, 96)}% capacity (${r.int(9, 28)} GB free), WAL growing at ${r.int(2, 6)} GB/h`],
  },
  {
    // regex TP
    name: "pg.toomany",
    service: "postgres",
    level: "FATAL",
    weight: 1,
    truth: T(true, "outage", "capacity"),
    render: (r, ts) => [`${pgTs(ts)} [${r.int(1000, 65000)}] FATAL:  remaining connection slots are reserved for non-replication superuser connections (max_connections=200, active=${r.int(198, 200)})`],
  },

  // ---------------------------------------------------------------- nginx access log
  {
    name: "nginx.ok",
    service: "nginx",
    level: "ACCESS",
    weight: 150,
    truth: NOISE,
    render: (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "GET ${r.pick(ROUTES)} HTTP/2.0" 200 ${r.int(300, 12000)} "-" ${r.pick(UA)} rt=${(r.next() * 0.2 + 0.01).toFixed(3)} urt=${(r.next() * 0.18 + 0.005).toFixed(3)}`],
  },
  {
    name: "nginx.304",
    service: "nginx",
    level: "ACCESS",
    weight: 25,
    truth: NOISE,
    render: (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "GET /static/app.${r.hex(8)}.js HTTP/2.0" 304 0 "-" ${r.pick(UA)} rt=0.00${r.int(1, 9)} urt=-`],
  },
  {
    // regex FP: 499 is the client giving up, and the path contains the word ERROR
    name: "nginx.499",
    service: "nginx",
    level: "ACCESS",
    weight: 8,
    truth: NOISE,
    render: (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "GET /docs/reference/ERROR_CODES HTTP/2.0" 499 0 "-" ${r.pick(UA)} rt=${(r.next() * 2 + 0.5).toFixed(3)} urt=-`],
  },
  {
    // regex FN: 200s but with an empty body on checkout and a 9 s upstream time
    name: "nginx.slow200",
    service: "nginx",
    level: "ACCESS",
    weight: 1,
    truth: T(true, "degraded", "dependency_failure"),
    render: (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "POST /api/v1/checkout HTTP/2.0" 200 0 "-" ${r.pick(UA)} rt=${(r.next() * 3 + 8).toFixed(3)} urt=${(r.next() * 3 + 8).toFixed(3)} upstream=payments upstream_status=200 body_bytes_sent=0`],
  },
  {
    // regex TP
    name: "nginx.502",
    service: "nginx",
    level: "ACCESS",
    weight: 1,
    truth: T(true, "customer-impacting", "dependency_failure"),
    render: (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "POST /api/v1/checkout HTTP/2.0" 502 157 "-" ${r.pick(UA)} rt=${(r.next() * 0.1 + 0.01).toFixed(3)} urt=- upstream=payments`],
  },
  {
    // regex FN: path probing with 404s from one client = security recon
    name: "nginx.probe",
    service: "nginx",
    level: "ACCESS",
    weight: 1,
    truth: T(true, "informational", "security", true),
    render: (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "GET ${r.pick(["/.env", "/wp-admin/setup-config.php", "/.git/config", "/actuator/env", "/phpmyadmin/index.php"])} HTTP/1.1" 404 153 "-" "Mozilla/5.0 zgrab/0.x" rt=0.001 urt=-`],
  },

  // ---------------------------------------------------------------- cron
  {
    name: "cron.ok",
    service: "cron",
    level: "INFO",
    weight: 16,
    truth: NOISE,
    render: (r, ts) => [`${cronTs(ts)} cron[${r.int(400, 900)}]: (app) JOB ${r.pick(["rotate-logs", "warm-cache", "sync-exchange-rates", "prune-sessions"])} exit=0 duration=${(r.next() * 4 + 0.2).toFixed(1)}s`],
  },
  {
    // regex FP: a canary job that is expected to fail
    name: "cron.canary",
    service: "cron",
    level: "ERROR",
    weight: 4,
    truth: NOISE,
    render: (r, ts) => [`${cronTs(ts)} cron[${r.int(400, 900)}]: (app) JOB alert-pipeline-canary exit=1 duration=0.${r.int(1, 9)}s stderr="ERROR: intentional failure (canary) - verifies alerting path is alive"`],
  },
  {
    // regex FN: backup "succeeded" but wrote nothing
    name: "cron.empty_backup",
    service: "cron",
    level: "INFO",
    weight: 1,
    truth: T(true, "customer-impacting", "data_integrity"),
    render: (r, ts) => [`${cronTs(ts)} cron[${r.int(400, 900)}]: (app) JOB backup-postgres exit=0 duration=0.${r.int(2, 6)}s bytes_written=0 dest=s3://acme-backups/prod/ (previous run: ${r.int(38, 52)} GB)`],
  },
  {
    // regex FN: cert expiring soon
    name: "cron.cert",
    service: "cron",
    level: "INFO",
    weight: 1,
    truth: T(true, "degraded", "config"),
    render: (r, ts) => [`${cronTs(ts)} cron[${r.int(400, 900)}]: (app) JOB check-certs exit=0 duration=1.1s note="api.acme.example certificate expires in ${r.int(1, 3)} days; renewal job has not run since 2026-08-02"`],
  },
];

/** Storm scenario: payments provider degradation. Early phases are INFO-level anomalies. */
export interface StormStep {
  atMs: number;
  template: Template;
}

const S = (name: string, atMs: number, level: Level, truth: Truth, render: Template["render"], service: Service = "payments"): StormStep => ({
  atMs,
  template: { name, service, level, weight: 0, truth, render },
});

export const STORM: StormStep[] = [
  S("storm.latency1", 0, "INFO", T(true, "degraded", "dependency_failure"), (_r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "provider latency p95 rising", provider: "stripe", p95_ms: 910, baseline_ms: 310, window: "1m" })]),
  S("storm.empty1", 400, "INFO", T(true, "customer-impacting", "dependency_failure"), (r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "provider response", provider: "stripe", status: 200, body_bytes: 0, parsed: false, charge_id: `ch_${r.hex(14)}`, note: "capture state unknown" })]),
  S("storm.retries", 900, "INFO", T(true, "degraded", "dependency_failure"), (_r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "retry rate", retries_per_min: 184, baseline_per_min: 6, provider: "stripe" })]),
  S("storm.latency2", 1500, "INFO", T(true, "degraded", "dependency_failure"), (_r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "provider latency p95 rising", provider: "stripe", p95_ms: 2140, baseline_ms: 310, window: "1m" })]),
  S("storm.empty2", 2100, "INFO", T(true, "customer-impacting", "dependency_failure"), (r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "provider response", provider: "stripe", status: 200, body_bytes: 0, parsed: false, charge_id: `ch_${r.hex(14)}`, note: "capture state unknown" })]),
  S("storm.nginx_slow", 2800, "ACCESS", T(true, "degraded", "dependency_failure"), (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "POST /api/v1/checkout HTTP/2.0" 200 0 "-" ${r.pick(UA)} rt=9.412 urt=9.410 upstream=payments upstream_status=200 body_bytes_sent=0`], "nginx"),
  S("storm.queue", 3600, "INFO", T(true, "degraded", "capacity"), (_r, ts) => [json({ ts, level: "INFO", svc: "payments", msg: "capture queue depth", depth: 1240, baseline: 40, oldest_age_s: 48 })]),
  S("storm.breaker", 4400, "WARN", T(true, "customer-impacting", "dependency_failure"), (_r, ts) => [json({ ts, level: "WARN", svc: "payments", msg: "circuit breaker half-open for provider stripe", failure_rate: 0.41, window: "30s" })]),
  S("storm.timeout1", 5400, "ERROR", T(true, "customer-impacting", "dependency_failure"), (r, ts) => [json({ ts, level: "ERROR", svc: "payments", msg: "charge capture failed: provider timeout after 10000 ms", charge_id: `ch_${r.hex(14)}`, attempts: 3 })]),
  S("storm.gw500", 5900, "ERROR", T(true, "customer-impacting", "dependency_failure"), (r, ts) => [json({ ts, level: "ERROR", svc: "api-gateway", msg: "upstream returned 500 for checkout", req_id: r.hex(12), route: "/api/v1/checkout", upstream: "payments:8080", status: 500, latency_ms: 10021 })], "api-gateway"),
  S("storm.trace", 6400, "ERROR", T(true, "outage", "dependency_failure"), (r, ts) => javaTrace(r, `${ts} ERROR [payments] Unhandled exception while capturing charge ch_${r.hex(14)}: Read timed out`, "java.net.SocketTimeoutException")),
  S("storm.502", 6900, "ACCESS", T(true, "outage", "dependency_failure"), (r, ts) => [`${r.ip()} - - [${nginxTs(ts)}] "POST /api/v1/checkout HTTP/2.0" 502 157 "-" ${r.pick(UA)} rt=0.012 urt=- upstream=payments`], "nginx"),
  S("storm.timeout2", 7300, "ERROR", T(true, "outage", "dependency_failure"), (r, ts) => [json({ ts, level: "ERROR", svc: "payments", msg: "charge capture failed: provider timeout after 10000 ms", charge_id: `ch_${r.hex(14)}`, attempts: 3 })]),
  S("storm.breaker_open", 7800, "ERROR", T(true, "outage", "dependency_failure"), (_r, ts) => [json({ ts, level: "ERROR", svc: "payments", msg: "circuit breaker OPEN for provider stripe; all captures failing fast", failure_rate: 0.97, window: "30s" })]),
];
