import Foundation
import XCTest

@testable import JevAXPilot

enum Fixture {
  static func snapshot(_ name: String) throws -> AXSnapshot {
    let bundle = Bundle(for: Marker.self)
    guard
      let url = bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
        ?? bundle.url(forResource: name, withExtension: "json")
    else {
      throw XCTSkip("missing fixture \(name)")
    }
    return try JSONDecoder().decode(AXSnapshot.self, from: Data(contentsOf: url))
  }

  static func tree(_ name: String, goal: String) throws -> FlatTree {
    TreeFlattener.flatten(try snapshot(name), goal: goal)
  }

  static func context(
    _ goal: String, tree: FlatTree, step: Int = 1, typed: [String] = [], history: [StepRecord] = []
  )
    -> PilotContext
  {
    PilotContext(
      goal: goal, step: step, appName: "App", windowTitle: nil,
      textCandidates: TextCandidates.extract(from: goal),
      typedTexts: typed, history: history)
  }

  private final class Marker {}
}

enum Answers {
  static func choice(
    _ choice: String, confidence: Double = 0.9, probabilities: [String: Double]? = nil
  ) -> Jev.Answer {
    Jev.Answer(
      type: "choice", choice: choice, confidence: confidence,
      probabilities: probabilities ?? [choice: confidence],
      noul: nil)
  }

  static func noul(_ value: Double) -> Jev.Answer {
    Jev.Answer(type: "noul", choice: nil, confidence: nil, probabilities: nil, noul: value)
  }

  static func full(
    next: String, confidence: Double = 0.9, key: String = "Return", goalReached: Double = 0.05,
    needsText: Double = 0.05, destructive: Double = 0.02, text: String? = nil
  ) -> [String: Jev.Answer] {
    var answers: [String: Jev.Answer] = [
      "next_element": choice(next, confidence: confidence),
      "key": choice(key),
      "goal_reached": noul(goalReached),
      "needs_text_input": noul(needsText),
      "is_destructive": noul(destructive),
    ]
    if let text { answers["text"] = choice(text) }
    return answers
  }
}
