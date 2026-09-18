import Foundation

/// Deterministic regex policy used when Jev is unreachable or misses the deadline.
public enum Fallback {
  static let deny: [(String, String)] = [
    (#"(^|\s)rm\s+(-[a-zA-Z]*\s+)*(/|~|~/|\$HOME/?|/\*)(\s|$)"#, "rm on / or ~"),
    (#"(^|\s)(mkfs|fdisk|diskutil\s+erase)"#, "disk format"),
    (#"(^|\s)dd\s+.*of=/dev/"#, "raw disk write"),
    (#">\s*/dev/(disk|sd|nvme)"#, "raw disk write"),
    (#":\(\)\s*\{\s*:\|:&\s*\};:"#, "fork bomb"),
    (#"(^|\s)chmod\s+(-R\s+)?[0-7]{3,4}\s+/(\s|$)"#, "chmod on /"),
    (#"(^|\s)chown\s+-R\s+\S+\s+/(\s|$)"#, "chown on /"),
  ]

  static let confirm: [(String, String)] = [
    (#"(^|\s)rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]"#, "recursive force rm"),
    (#"(^|\s)git\s+push\s+.*(--force|-f)(\s|$)"#, "force push"),
    (#"(^|\s)git\s+reset\s+--hard"#, "git reset --hard"),
    (#"(^|\s)git\s+clean\s+-[a-zA-Z]*[fdx]"#, "git clean"),
    (#"(^|\s)git\s+branch\s+-D"#, "branch delete"),
    (#"(^|\s)git\s+checkout\s+--\s+\."#, "discard changes"),
    (#"(?i)drop\s+(table|database|schema)"#, "SQL drop"),
    (#"(?i)truncate\s+table"#, "SQL truncate"),
    (#"(^|\s)sudo\s+rm"#, "sudo rm"),
    (#"(^|\s)kubectl\s+delete"#, "kubectl delete"),
    (#"(^|\s)terraform\s+destroy"#, "terraform destroy"),
    (#"(^|\s)(shutdown|reboot|halt)(\s|$)"#, "power"),
    (#"(^|\s)kill(all)?\s+-9"#, "SIGKILL"),
  ]

  static func compile(_ list: [(String, String)]) -> [(NSRegularExpression, String)] {
    list.compactMap { pattern, label in
      (try? NSRegularExpression(pattern: pattern)).map { ($0, label) }
    }
  }

  static let denyCompiled = compile(deny)
  static let confirmCompiled = compile(confirm)

  static func firstMatch(_ line: String, in list: [(NSRegularExpression, String)]) -> String? {
    let range = NSRange(line.startIndex..., in: line)
    return list.first { $0.0.firstMatch(in: line, range: range) != nil }?.1
  }

  public static func decide(_ command: String, toolFound: Bool? = nil) -> Decision {
    if let label = firstMatch(command, in: denyCompiled) {
      return .block([Reason(id: "regex:" + label, value: 1)])
    }
    if let label = firstMatch(command, in: confirmCompiled) {
      return .confirm([Reason(id: "regex:" + label, value: 1)])
    }
    if toolFound == false {
      return .confirm([Reason(id: "regex:command not found", value: 1)])
    }
    if StateBuilder.containsTokenLikeString(command) {
      return .confirm([Reason(id: "regex:inline secret", value: 1)])
    }
    return .run
  }
}
