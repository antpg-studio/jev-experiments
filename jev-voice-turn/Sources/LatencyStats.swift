import Foundation

/// Running request statistics: latency percentiles, throughput, tokens and cost.
struct LatencyStats: Equatable {
  /// Published price for typesafe/jev-1.13: $0.042 per million input tokens; output tokens are free.
  static let usdPerInputToken = 0.042 / 1_000_000

  private(set) var latenciesMs: [Double] = []
  private(set) var requestTimes: [TimeInterval] = []
  private(set) var requestCount = 0
  private(set) var failureCount = 0
  private(set) var staleCount = 0
  private(set) var inputTokens = 0
  private(set) var outputTokens = 0

  mutating func record(
    latencyMs: Double, inputTokens: Int, outputTokens: Int, at time: TimeInterval
  ) {
    requestCount += 1
    latenciesMs.append(latencyMs)
    requestTimes.append(time)
    self.inputTokens += inputTokens
    self.outputTokens += outputTokens
  }

  mutating func recordFailure() { failureCount += 1 }
  mutating func recordStale() { staleCount += 1 }

  var last: Double? { latenciesMs.last }
  var p50: Double? { percentile(0.5) }
  var p95: Double? { percentile(0.95) }
  var mean: Double? {
    latenciesMs.isEmpty ? nil : latenciesMs.reduce(0, +) / Double(latenciesMs.count)
  }

  func percentile(_ p: Double) -> Double? {
    guard !latenciesMs.isEmpty else { return nil }
    let sorted = latenciesMs.sorted()
    let rank = p * Double(sorted.count - 1)
    let lo = Int(rank.rounded(.down))
    let hi = min(lo + 1, sorted.count - 1)
    let frac = rank - Double(lo)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
  }

  /// Completed decisions in the trailing `window` seconds ending at `now`.
  func decisionsPerSecond(now: TimeInterval, window: TimeInterval = 5) -> Double {
    let recent = requestTimes.filter { $0 >= now - window && $0 <= now }
    guard !recent.isEmpty else { return 0 }
    let span = min(window, max(now - (requestTimes.first ?? now), 0.001))
    return Double(recent.count) / span
  }

  var tokensPerDecision: Double {
    requestCount == 0 ? 0 : Double(inputTokens) / Double(requestCount)
  }

  var costUSD: Double { Double(inputTokens) * LatencyStats.usdPerInputToken }

  var costPerThousandDecisionsUSD: Double {
    tokensPerDecision * 1000 * LatencyStats.usdPerInputToken
  }
}
