import Foundation

/// Parsed answers from one Jev request.
public struct Judgment: Equatable {
  public var nouls: [String: Double]
  public var verdict: String
  public var verdictProbabilities: [String: Double]
  public var verdictConfidence: Double
  public var inputTokens: Int
  public var outputTokens: Int
  public var model: String

  public init(
    nouls: [String: Double], verdict: String, verdictProbabilities: [String: Double],
    verdictConfidence: Double, inputTokens: Int = 0, outputTokens: Int = 0,
    model: String = "fixture"
  ) {
    self.nouls = nouls
    self.verdict = verdict
    self.verdictProbabilities = verdictProbabilities
    self.verdictConfidence = verdictConfidence
    self.inputTokens = inputTokens
    self.outputTokens = outputTokens
    self.model = model
  }

  public enum ParseError: Error, Equatable {
    case notAnObject
    case missingAnswer(String)
    case wrongType(String)
  }

  public static func parse(_ data: Data) throws -> Judgment {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let answers = root["answers"] as? [String: Any]
    else { throw ParseError.notAnObject }

    var nouls: [String: Double] = [:]
    for id in Questions.noulIDs {
      guard let answer = answers[id] as? [String: Any] else { throw ParseError.missingAnswer(id) }
      guard let value = answer["noul"] as? Double else { throw ParseError.wrongType(id) }
      nouls[id] = value
    }
    guard let verdictAnswer = answers[Questions.verdict] as? [String: Any] else {
      throw ParseError.missingAnswer(Questions.verdict)
    }
    guard let choice = verdictAnswer["choice"] as? String,
      let probs = verdictAnswer["probabilities"] as? [String: Double]
    else { throw ParseError.wrongType(Questions.verdict) }
    let usage = root["usage"] as? [String: Any] ?? [:]
    return Judgment(
      nouls: nouls,
      verdict: choice,
      verdictProbabilities: probs,
      verdictConfidence: verdictAnswer["confidence"] as? Double ?? 0,
      inputTokens: usage["input_tokens"] as? Int ?? 0,
      outputTokens: usage["output_tokens"] as? Int ?? 0,
      model: root["model"] as? String ?? "jev"
    )
  }
}
