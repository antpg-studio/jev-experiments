import Foundation

/// Running latency/throughput/cost figures for the HUD. Pure value type so it is easy to test.
struct Metrics: Equatable {
  private(set) var latenciesMs: [Double] = []
  private(set) var requests = 0
  private(set) var failures = 0
  private(set) var staleDiscarded = 0
  private(set) var inputTokens = 0
  private(set) var outputTokens = 0
  private(set) var steps = 0
  private(set) var jevDecisions = 0
  private(set) var fallbackDecisions = 0
  private(set) var startedAt: Date?
  private(set) var finishedAt: Date?

  var lastLatencyMs: Double? { latenciesMs.last }
  var p50Ms: Double? { percentile(0.5) }
  var p95Ms: Double? { percentile(0.95) }
  var totalTokens: Int { inputTokens + outputTokens }
  var estimatedCostUSD: Double { Double(inputTokens) * Jev.usdPerInputToken }
  var tokensPerDecision: Double { requests == 0 ? 0 : Double(inputTokens) / Double(requests) }

  var elapsedSeconds: Double {
    guard let startedAt else { return 0 }
    return (finishedAt ?? Date()).timeIntervalSince(startedAt)
  }

  var stepsPerSecond: Double {
    let elapsed = elapsedSeconds
    return elapsed > 0 ? Double(steps) / elapsed : 0
  }

  mutating func start(at date: Date = Date()) {
    self = Metrics()
    startedAt = date
  }

  mutating func finish(at date: Date = Date()) {
    finishedAt = date
  }

  mutating func recordResponse(latencyMs: Double, usage: Jev.Usage) {
    latenciesMs.append(latencyMs)
    requests += 1
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
  }

  mutating func recordFailure() {
    requests += 1
    failures += 1
  }

  mutating func recordStale() {
    staleDiscarded += 1
  }

  mutating func recordStep(source: String) {
    steps += 1
    if source == "jev" { jevDecisions += 1 } else { fallbackDecisions += 1 }
  }

  func percentile(_ fraction: Double) -> Double? {
    guard !latenciesMs.isEmpty else { return nil }
    let sorted = latenciesMs.sorted()
    let rank = max(
      0, min(sorted.count - 1, Int((Double(sorted.count) * fraction).rounded(.up)) - 1))
    return sorted[rank]
  }
}
