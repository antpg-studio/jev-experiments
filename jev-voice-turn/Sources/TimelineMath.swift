import Foundation

/// Coordinate mapping and aggregate math for the timeline strip and comparison panel.
enum TimelineMath {
  /// Maps a session time into a horizontal pixel offset for a window ending at `windowEnd`.
  static func x(
    for time: TimeInterval, windowEnd: TimeInterval, windowSeconds: Double, width: Double
  )
    -> Double
  {
    let start = windowEnd - windowSeconds
    return (time - start) / windowSeconds * width
  }

  static func isVisible(_ time: TimeInterval, windowEnd: TimeInterval, windowSeconds: Double)
    -> Bool
  {
    time >= windowEnd - windowSeconds && time <= windowEnd
  }

  /// Probability line: sampled points hold their value until the next sample (step function).
  static func probabilityPath(
    samples: [(time: TimeInterval, value: Double)], until end: TimeInterval
  ) -> [(time: TimeInterval, value: Double)] {
    guard let first = samples.first else { return [] }
    var out: [(TimeInterval, Double)] = [(first.time, first.value)]
    var prev = first.value
    for s in samples.dropFirst() {
      out.append((s.time, prev))
      out.append((s.time, s.value))
      prev = s.value
    }
    out.append((end, prev))
    return out.map { (time: $0.0, value: $0.1) }
  }

  struct Comparison: Equatable {
    var turns: Int
    var jevFires: Int
    var fallbackFires: Int
    var meanJevDelayMs: Double
    var meanBaselineDelayMs: Double
    var meanSavedMs: Double
    var totalSavedMs: Double
    var bargeIns: Int
  }

  static func comparison(_ turns: [TurnRecord]) -> Comparison {
    guard !turns.isEmpty else {
      return Comparison(
        turns: 0, jevFires: 0, fallbackFires: 0, meanJevDelayMs: 0, meanBaselineDelayMs: 0,
        meanSavedMs: 0, totalSavedMs: 0, bargeIns: 0)
    }
    let n = Double(turns.count)
    let saved = turns.map(\.savedMs)
    return Comparison(
      turns: turns.count,
      jevFires: turns.filter { $0.fireSource == .jev }.count,
      fallbackFires: turns.filter { $0.fireSource != .jev }.count,
      meanJevDelayMs: turns.map(\.jevDelayMs).reduce(0, +) / n,
      meanBaselineDelayMs: turns.map(\.baselineDelayMs).reduce(0, +) / n,
      meanSavedMs: saved.reduce(0, +) / n,
      totalSavedMs: saved.reduce(0, +),
      bargeIns: turns.filter(\.bargedIn).count)
  }

  static func formatMs(_ ms: Double?) -> String {
    guard let ms else { return "--" }
    return String(format: "%.0f ms", ms)
  }

  static func formatSeconds(_ ms: Double) -> String {
    String(format: "%.2f s", ms / 1000)
  }

  static func formatUSD(_ usd: Double) -> String {
    if usd < 0.01 { return String(format: "$%.5f", usd) }
    return String(format: "$%.3f", usd)
  }
}
