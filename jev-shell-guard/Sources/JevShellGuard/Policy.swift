import Foundation

/// User-tunable policy, loaded from `~/.config/jevsh/config.json`.
public struct Config: Codable, Equatable {
  public var enabled: Bool
  public var deadlineMs: Int
  public var thresholds: [String: Double]
  public var blockThreshold: Double
  public var blockVerdictProbability: Double
  public var skipTools: [String]

  enum CodingKeys: String, CodingKey {
    case enabled
    case deadlineMs = "deadline_ms"
    case thresholds
    case blockThreshold = "block_threshold"
    case blockVerdictProbability = "block_verdict_probability"
    case skipTools = "skip_tools"
  }

  public static let `default` = Config(
    enabled: true,
    deadlineMs: 400,
    thresholds: [
      Questions.destructive: 0.70,
      Questions.wrongTarget: 0.65,
      Questions.likelyTypo: 0.60,
      Questions.leaksSecret: 0.60,
    ],
    blockThreshold: 0.90,
    blockVerdictProbability: 0.60,
    skipTools: []
  )

  public init(
    enabled: Bool, deadlineMs: Int, thresholds: [String: Double], blockThreshold: Double,
    blockVerdictProbability: Double, skipTools: [String]
  ) {
    self.enabled = enabled
    self.deadlineMs = deadlineMs
    self.thresholds = thresholds
    self.blockThreshold = blockThreshold
    self.blockVerdictProbability = blockVerdictProbability
    self.skipTools = skipTools
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let d = Config.default
    enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? d.enabled
    deadlineMs = try c.decodeIfPresent(Int.self, forKey: .deadlineMs) ?? d.deadlineMs
    var t = d.thresholds
    for (k, v) in try c.decodeIfPresent([String: Double].self, forKey: .thresholds) ?? [:] {
      t[k] = v
    }
    thresholds = t
    blockThreshold =
      try c.decodeIfPresent(Double.self, forKey: .blockThreshold) ?? d.blockThreshold
    blockVerdictProbability =
      try c.decodeIfPresent(Double.self, forKey: .blockVerdictProbability)
      ?? d.blockVerdictProbability
    skipTools = try c.decodeIfPresent([String].self, forKey: .skipTools) ?? d.skipTools
  }

  public static var path: String {
    let xdg = ProcessInfo.processInfo.environment["XDG_CONFIG_HOME"]
    let base = xdg ?? (NSHomeDirectory() + "/.config")
    return base + "/jevsh/config.json"
  }

  public static func load(path: String = Config.path) -> Config {
    guard let data = FileManager.default.contents(atPath: path) else { return .default }
    return (try? JSONDecoder().decode(Config.self, from: data)) ?? .default
  }
}

public struct Reason: Equatable, CustomStringConvertible {
  public var id: String
  public var value: Double

  public init(id: String, value: Double) {
    self.id = id
    self.value = value
  }

  public var description: String { "\(id) \(String(format: "%.2f", value))" }
}

public enum Decision: Equatable {
  case run
  case confirm([Reason])
  case block([Reason])

  public var label: String {
    switch self {
    case .run: return "run"
    case .confirm: return "confirm"
    case .block: return "block"
    }
  }

  public var reasons: [Reason] {
    switch self {
    case .run: return []
    case .confirm(let r), .block(let r): return r
    }
  }
}

public enum Policy {
  /// Turns raw probabilities into a decision. Any Noul over its threshold escalates;
  /// the verdict Choice is the tie-breaker between confirm and block.
  public static func decide(_ j: Judgment, config: Config = .default) -> Decision {
    let flagged =
      Questions.noulIDs
      .compactMap { id -> Reason? in
        guard let value = j.nouls[id], let threshold = config.thresholds[id], value >= threshold
        else { return nil }
        return Reason(id: id, value: value)
      }
      .sorted { $0.value > $1.value }

    let blockProbability = j.verdictProbabilities["block"] ?? 0
    let verdictSaysBlock =
      j.verdict == "block" && blockProbability >= config.blockVerdictProbability

    if flagged.isEmpty {
      if verdictSaysBlock {
        return .confirm([Reason(id: "verdict:block", value: blockProbability)])
      }
      return .run
    }

    let destructive = j.nouls[Questions.destructive] ?? 0
    let wrongTarget = j.nouls[Questions.wrongTarget] ?? 0
    let catastrophic =
      destructive >= config.blockThreshold && wrongTarget >= config.blockThreshold
    if verdictSaysBlock || catastrophic {
      return .block(flagged)
    }
    return .confirm(flagged)
  }
}
