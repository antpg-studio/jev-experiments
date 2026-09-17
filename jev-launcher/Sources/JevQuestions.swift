import Foundation

/// Local facts sent alongside the query so Jev can disambiguate. All observed, none inferred.
struct LaunchContext: Codable, Equatable, Sendable {
  var frontmostApp: String
  var recentApps: [String]
  var clipboardKind: String
  var timeOfDay: String
  var weekday: String

  enum CodingKeys: String, CodingKey {
    case frontmostApp = "frontmost_app"
    case recentApps = "recent_apps"
    case clipboardKind = "clipboard_kind"
    case timeOfDay = "time_of_day"
    case weekday
  }

  static func timeOfDay(hour: Int) -> String {
    switch hour {
    case 5..<12: return "morning"
    case 12..<17: return "afternoon"
    case 17..<22: return "evening"
    default: return "night"
    }
  }
}

/// Wire format for `POST /v1/systemone`.
struct JevRequest: Encodable, Sendable {
  struct Question: Encodable, Sendable {
    let type: String
    let instructions: String
    let criteria: Criteria

    enum Criteria: Encodable, Sendable {
      case options([String: String])
      case yesNo(yes: String, no: String)

      func encode(to encoder: Encoder) throws {
        switch self {
        case .options(let map):
          try map.encode(to: encoder)
        case .yesNo(let yes, let no):
          try ["true": yes, "false": no].encode(to: encoder)
        }
      }
    }
  }

  struct State: Encodable, Sendable {
    struct CandidateSummary: Encodable, Sendable {
      let id: String
      let kind: String
      let title: String
      let detail: String
    }
    let query: String
    let queryNote: String
    let context: LaunchContext
    let candidates: [CandidateSummary]

    enum CodingKeys: String, CodingKey {
      case query
      case queryNote = "query_note"
      case context
      case candidates
    }
  }

  let state: State
  let model: String
  let questions: [String: Question]
}

/// Answers we consume. Unknown answer shapes are ignored rather than failing the request.
struct JevResponse: Decodable, Sendable {
  struct Answer: Decodable, Sendable {
    let type: String
    let choice: String?
    let confidence: Double?
    let probabilities: [String: Double]?
    let noul: Double?
  }
  struct Usage: Decodable, Sendable {
    let inputTokens: Int
    let outputTokens: Int
    enum CodingKeys: String, CodingKey {
      case inputTokens = "input_tokens"
      case outputTokens = "output_tokens"
    }
  }
  let model: String
  let answers: [String: Answer]
  let usage: Usage
}

/// The typed judgment extracted from a response, keyed back to real candidate ids.
struct JevJudgment: Equatable, Sendable {
  /// Probability that each candidate is the intended target. Missing candidates are 0.
  var targetProbabilities: [String: Double]
  var noneProbability: Double
  var targetConfidence: Double
  var action: ActionKind
  var actionProbabilities: [ActionKind: Double]
  var actionConfidence: Double
  /// Probability that Enter should execute the top hit without the user needing to see a list.
  var ready: Double
}

enum JevQuestions {
  static let model = "jev-latest"
  static let noneOption = "none"
  static let maxCandidates = 15

  static let queryNote =
    "Text the user has typed so far into a Spotlight-style macOS launcher. It is often an incomplete prefix or a short natural-language phrase."

  /// Builds one fan-out request: three independent questions over one state.
  static func buildRequest(query: String, context: LaunchContext, candidates: [Candidate])
    -> JevRequest
  {
    let shown = Array(candidates.prefix(maxCandidates))
    var summaries: [JevRequest.State.CandidateSummary] = []
    var targetCriteria: [String: String] = [:]
    for (index, candidate) in shown.enumerated() {
      let shortID = "c\(index)"
      summaries.append(
        .init(
          id: shortID, kind: candidate.kind.rawValue, title: candidate.title,
          detail: candidate.subtitle))
      targetCriteria[shortID] =
        "\(candidate.kind.label): \(candidate.title) — \(candidate.subtitle)"
    }
    targetCriteria[noneOption] = "None of the listed candidates is what the user means."

    let target = JevRequest.Question(
      type: "choice",
      instructions:
        "The user typed `query` into a launcher. Which entry in `candidates` is the item they intend to open or run? Treat `query` as a possibly incomplete prefix or paraphrase of the intended item. Match on meaning: a candidate's `title` and `detail` may use different words than `query` (for example `query` \"the pdf I just downloaded\" means the PDF in Downloads whose `detail` says it was modified most recently; \"wifi off\" means the candidate that disables Wi-Fi). Use `context.frontmost_app` and `context.recent_apps` only to break ties. Pick `none` only when no candidate plausibly matches.",
      criteria: .options(targetCriteria))

    let action = JevRequest.Question(
      type: "choice",
      instructions:
        "What kind of action does `query` ask the launcher to perform? Judge from the words in `query` and, when `query` names one of the `candidates`, that candidate's `kind`. If `query` is a bare arithmetic expression choose calculate. If it reads like a question or a topic with no matching local candidate choose web_search.",
      criteria: .options(
        Dictionary(uniqueKeysWithValues: ActionKind.allCases.map { ($0.rawValue, $0.rubric) })))

    let ready = JevRequest.Question(
      type: "noul",
      instructions:
        "The launcher is about to run the best-matching candidate the instant the user presses Enter. Is `query` already unambiguous enough for that? `candidates` is the complete list of everything the launcher could do for this query; the web_search entry is only a fallback for when nothing local fits. Short input is fine: \"empty tr\" unambiguously means the Empty Trash toggle if no other local candidate fits it, while a single letter that several local candidates start with is ambiguous.",
      criteria: .yesNo(
        yes:
          "One local candidate is the obvious meaning of `query` and the remaining candidates are not plausible; running it on Enter would not surprise the user.",
        no:
          "Several candidates fit `query` roughly equally, or only the web_search fallback fits, so the user should choose from the list."
      ))

    return JevRequest(
      state: .init(query: query, queryNote: queryNote, context: context, candidates: summaries),
      model: model,
      questions: ["target": target, "action": action, "ready": ready])
  }

  /// Maps the short ids in a response back to the candidates that were sent.
  static func parse(_ response: JevResponse, candidates: [Candidate]) -> JevJudgment? {
    guard let targetAnswer = response.answers["target"],
      let probabilities = targetAnswer.probabilities
    else { return nil }
    let shown = Array(candidates.prefix(maxCandidates))
    var targets: [String: Double] = [:]
    for (index, candidate) in shown.enumerated() {
      targets[candidate.id] = probabilities["c\(index)"] ?? 0
    }
    let actionAnswer = response.answers["action"]
    var actionProbabilities: [ActionKind: Double] = [:]
    for (key, value) in actionAnswer?.probabilities ?? [:] {
      if let kind = ActionKind(rawValue: key) { actionProbabilities[kind] = value }
    }
    let action = actionAnswer?.choice.flatMap(ActionKind.init(rawValue:)) ?? .unclear
    return JevJudgment(
      targetProbabilities: targets,
      noneProbability: probabilities[noneOption] ?? 0,
      targetConfidence: targetAnswer.confidence ?? 0,
      action: action,
      actionProbabilities: actionProbabilities,
      actionConfidence: actionAnswer?.confidence ?? 0,
      ready: response.answers["ready"]?.noul ?? 0)
  }
}
