import Foundation

/// Extracts the spans of a goal that could be typed verbatim. Jev only ever selects among these;
/// it never generates text.
enum TextCandidates {
  static let knownApps = [
    "Notes", "System Settings", "Calculator", "Safari", "TextEdit", "Finder", "Mail", "Messages",
    "Reminders", "Calendar", "Music", "Photos", "Preview", "Terminal", "Maps", "Contacts",
    "Stickies",
  ]

  private static let verbs = [
    "titled", "named", "called", "type", "enter", "write", "search for", "go to", "navigate to",
    "visit",
    "compute", "calculate", "evaluate", "paste", "say", "saying", "reading", "with the text",
    "containing",
  ]

  /// Ordered, de-duplicated candidate strings, most specific first.
  static func extract(from goal: String) -> [String] {
    var found: [String] = []
    func add(_ raw: String) {
      let cleaned = trimPunctuation(raw)
      guard cleaned.count >= 1, !found.contains(cleaned), !knownApps.contains(cleaned) else {
        return
      }
      found.append(cleaned)
    }
    for match in matches(of: "[\"“']([^\"”']+)[\"”']", in: goal) { add(match) }
    for verb in verbs {
      let pattern =
        "\\b" + NSRegularExpression.escapedPattern(for: verb)
        + "\\s+(.+?)(?=\\s+(?:in|into|inside|using|with|and then|then|and|,)\\s+[A-Z]|,|\\s+and\\s+|$)"
      for match in matches(of: pattern, in: goal) { add(match) }
    }
    for match in matches(of: "\\b((?:https?://)?[a-z0-9-]+(?:\\.[a-z0-9-]+)+(?:/\\S*)?)", in: goal)
    { add(match) }
    for match in matches(of: "(\\d+(?:\\.\\d+)?(?:\\s*[-+*/x×÷]\\s*\\d+(?:\\.\\d+)?)+)", in: goal) {
      add(match)
    }
    return Array(found.prefix(6))
  }

  /// The app named in the goal, if it is one we know how to launch.
  static func appName(in goal: String) -> String? {
    let lowered = goal.lowercased()
    return knownApps.sorted { $0.count > $1.count }.first {
      TreeFlattener.containsWord(lowered, $0.lowercased())
    }
  }

  /// Arithmetic in the goal evaluated in code, so Jev is never asked to do math.
  static func arithmeticFacts(from candidates: [String]) -> [String: String] {
    var facts: [String: String] = [:]
    for candidate in candidates {
      let normalized = candidate.replacingOccurrences(of: "x", with: "*").replacingOccurrences(
        of: "×", with: "*"
      )
      .replacingOccurrences(of: "÷", with: "/").replacingOccurrences(of: " ", with: "")
      guard normalized.range(of: "^[0-9.+*/()-]+$", options: .regularExpression) != nil,
        normalized.range(of: "[+*/-]", options: .regularExpression) != nil
      else { continue }
      if let value = evaluate(normalized) {
        let text =
          value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : String(value)
        facts["\(candidate) equals"] = text
      }
    }
    return facts
  }

  private static func evaluate(_ expression: String) -> Double? {
    let sanitized = expression.replacingOccurrences(of: "/", with: "*1.0/")
    let parsed = NSExpression(format: sanitized)
    return (parsed.expressionValue(with: nil, context: nil) as? NSNumber)?.doubleValue
  }

  private static func matches(of pattern: String, in text: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else { return [] }
    let range = NSRange(text.startIndex..., in: text)
    return regex.matches(in: text, range: range).compactMap { match in
      guard match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else {
        return nil
      }
      return String(text[range])
    }
  }

  private static func trimPunctuation(_ text: String) -> String {
    text.trimmingCharacters(in: CharacterSet(charactersIn: " .,;:!?\"“”'"))
  }
}
