/**
 * The "old way": the kind of severity + keyword rules that ship in most alerting pipelines.
 * Pages on ERROR/FATAL levels, well known failure keywords, 5xx statuses and Kubernetes Warning events.
 * It is intentionally representative rather than tuned: this is the baseline Jev is compared to.
 */
const SEVERITY_OR_KEYWORD = /error|fatal|critical|exception|panic|traceback|oomkilled|out of memory|timeout|timed out|connection refused|segfault/i;
const HTTP_5XX = /" 5\d\d \d+ /;
const K8S_WARNING = /^\S+ Warning \S+ (pod|deployment|node)\//;

export const REGEX_RULES = [
  "level or message matches /error|fatal|critical/i",
  "message matches /exception|panic|traceback|oomkilled|timeout|connection refused/i",
  'HTTP access log status 5xx',
  "Kubernetes event type Warning",
];

export function regexPages(line: string): boolean {
  const head = line.split("\n")[0];
  return SEVERITY_OR_KEYWORD.test(line) || HTTP_5XX.test(head) || K8S_WARNING.test(head);
}
