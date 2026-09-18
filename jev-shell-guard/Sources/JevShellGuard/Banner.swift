import Foundation

public enum ANSI {
  public static let reset = "\u{1B}[0m"
  public static let dim = "\u{1B}[2m"
  public static let bold = "\u{1B}[1m"
  public static let yellow = "\u{1B}[33m"
  public static let red = "\u{1B}[31m"
  public static let green = "\u{1B}[32m"
  public static let cyan = "\u{1B}[36m"
}

public enum Banner {
  public static func reasons(_ list: [Reason]) -> String {
    list.map(\.description).joined(separator: " · ")
  }

  static func latencyTag(_ ms: Double?, offline: Bool) -> String {
    if offline { return "\(ANSI.dim)jev offline\(ANSI.reset)" }
    guard let ms = ms else { return "" }
    return "\(ANSI.dim)jev \(Int(ms.rounded()))ms\(ANSI.reset)"
  }

  public static func confirm(command: String, reasons: [Reason], ms: Double?, offline: Bool)
    -> String
  {
    "\(ANSI.yellow)\(ANSI.bold)⚠ \(self.reasons(reasons))\(ANSI.reset)"
      + " — \(ANSI.bold)`\(command)`\(ANSI.reset)  [y/N] "
      + latencyTag(ms, offline: offline) + " "
  }

  public static func block(command: String, reasons: [Reason], ms: Double?, offline: Bool)
    -> String
  {
    "\(ANSI.red)\(ANSI.bold)✖ blocked: \(self.reasons(reasons))\(ANSI.reset)"
      + " — \(ANSI.bold)`\(command)`\(ANSI.reset)  " + latencyTag(ms, offline: offline)
  }

  public static func offlineNote(_ error: String) -> String {
    "\(ANSI.dim)jev offline (\(error)) — regex fallback\(ANSI.reset)"
  }
}
