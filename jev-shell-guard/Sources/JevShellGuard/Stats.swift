import Foundation

/// Published Jev price: $0.042 per million input tokens; output tokens are free.
public let jevUSDPerInputToken = 0.042 / 1_000_000

public struct StatsRecord: Codable, Equatable {
  public var ts: Double
  public var ms: Double
  public var inputTokens: Int
  public var decision: String
  public var offline: Bool

  enum CodingKeys: String, CodingKey {
    case ts, ms, decision, offline
    case inputTokens = "input_tokens"
  }

  public init(ts: Double, ms: Double, inputTokens: Int, decision: String, offline: Bool) {
    self.ts = ts
    self.ms = ms
    self.inputTokens = inputTokens
    self.decision = decision
    self.offline = offline
  }
}

public struct StatsSummary: Equatable {
  public var count: Int
  public var online: Int
  public var last: Double
  public var p50: Double
  public var p95: Double
  public var mean: Double
  public var meanTokens: Double
  public var totalTokens: Int
  public var decisionsPerSecond: Double
  public var costUSD: Double
  public var decisions: [String: Int]
}

public enum Stats {
  public static var path: String {
    let xdg = ProcessInfo.processInfo.environment["XDG_STATE_HOME"]
    let base = xdg ?? (NSHomeDirectory() + "/.local/state")
    return base + "/jevsh/stats.jsonl"
  }

  public static func append(_ r: StatsRecord, path: String = Stats.path) {
    let dir = (path as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    guard var line = try? JSONEncoder().encode(r) else { return }
    line.append(0x0A)
    if let handle = FileHandle(forWritingAtPath: path) {
      handle.seekToEndOfFile()
      handle.write(line)
      handle.closeFile()
    } else {
      FileManager.default.createFile(atPath: path, contents: line)
    }
  }

  public static func load(path: String = Stats.path) -> [StatsRecord] {
    guard let data = FileManager.default.contents(atPath: path) else { return [] }
    let decoder = JSONDecoder()
    return String(decoding: data, as: UTF8.self)
      .split(separator: "\n")
      .compactMap { try? decoder.decode(StatsRecord.self, from: Data($0.utf8)) }
  }

  public static func percentile(_ sorted: [Double], _ p: Double) -> Double {
    guard !sorted.isEmpty else { return 0 }
    let rank = p / 100 * Double(sorted.count - 1)
    let lo = Int(rank.rounded(.down))
    let hi = min(lo + 1, sorted.count - 1)
    let frac = rank - Double(lo)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
  }

  public static func summarize(_ records: [StatsRecord]) -> StatsSummary {
    let online = records.filter { !$0.offline }
    let latencies = online.map(\.ms).sorted()
    let tokens = online.map(\.inputTokens)
    let total = tokens.reduce(0, +)
    let mean = latencies.isEmpty ? 0 : latencies.reduce(0, +) / Double(latencies.count)
    var decisions: [String: Int] = [:]
    for r in records { decisions[r.decision, default: 0] += 1 }
    return StatsSummary(
      count: records.count,
      online: online.count,
      last: online.last?.ms ?? 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      mean: mean,
      meanTokens: online.isEmpty ? 0 : Double(total) / Double(online.count),
      totalTokens: total,
      decisionsPerSecond: mean > 0 ? 1000 / mean : 0,
      costUSD: Double(total) * jevUSDPerInputToken,
      decisions: decisions
    )
  }
}
