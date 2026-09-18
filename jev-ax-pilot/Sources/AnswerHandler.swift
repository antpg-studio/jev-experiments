import Foundation

/// A concrete, code-owned action for one step.
enum PilotAction: Equatable {
  case press(FlatElement)
  case typeText(String, into: FlatElement?)
  case pressKey(KeyChord)
  case scroll
  case wait
  case done
  case stuck(String)
  case blocked(String)

  var name: String {
    switch self {
    case .press: return "press"
    case .typeText: return "type_text"
    case .pressKey: return "press_key"
    case .scroll: return "scroll"
    case .wait: return "wait"
    case .done: return "done"
    case .stuck: return "stuck"
    case .blocked: return "blocked"
    }
  }

  var target: String? {
    switch self {
    case .press(let element): return "\(element.id) \(element.summary)"
    case .typeText(let text, let element):
      return "'\(text)'" + (element.map { " into \($0.id)" } ?? "")
    case .pressKey(let key): return key.name
    case .stuck(let reason), .blocked(let reason): return reason
    case .wait: return "UI not settled; re-observing"
    case .scroll, .done: return nil
    }
  }

  var isTerminal: Bool {
    switch self {
    case .done, .stuck, .blocked: return true
    default: return false
    }
  }
}

/// The result of one decision, whether Jev or the fallback made it.
struct Decision: Equatable {
  var action: PilotAction
  var source: String
  var goalReached: Double
  var needsText: Double
  var isDestructive: Double
  var confidence: Double
  var probabilities: [(String, Double)]

  static func == (lhs: Decision, rhs: Decision) -> Bool {
    lhs.action == rhs.action && lhs.source == rhs.source && lhs.goalReached == rhs.goalReached
      && lhs.probabilities.map(\.0) == rhs.probabilities.map(\.0)
  }
}

/// Converts Jev answers (or their absence) into a safe action. All thresholds live here.
enum AnswerHandler {
  static let goalReachedThreshold = 0.8
  static let doneChoiceThreshold = 0.5
  static let doneConfidenceThreshold = 0.5
  static let needsTextThreshold = 0.5
  static let destructiveThreshold = 0.5
  static let minimumChoiceConfidence = 0.12
  static let maxRepeats = 2
  static let maxWaits = 3

  static func decide(answers: [String: Jev.Answer], tree: FlatTree, context: PilotContext)
    -> Decision
  {
    let goalReached = answers["goal_reached"]?.noul ?? 0
    let needsText = answers["needs_text_input"]?.noul ?? 0
    let destructive = answers["is_destructive"]?.noul ?? 0
    let next = answers["next_element"]
    let confidence = next?.confidence ?? 0
    let probabilities = sortedProbabilities(next?.probabilities ?? [:])

    func make(_ action: PilotAction, source: String = "jev") -> Decision {
      Decision(
        action: guardAction(action, destructive: destructive, context: context), source: source,
        goalReached: goalReached, needsText: needsText, isDestructive: destructive,
        confidence: confidence,
        probabilities: probabilities)
    }

    if goalReached > goalReachedThreshold, context.step > 1, canFinish(context) {
      return make(.done)
    }
    guard let choice = next?.choice, confidence >= minimumChoiceConfidence else {
      return make(fallback(tree: tree, context: context), source: "fallback")
    }
    let untyped = context.textCandidates.filter { !context.typedTexts.contains($0) }
    let canTypeNow =
      tree.focused?.isTextInput == true || acceptsRawKeystrokes(tree: tree, context: context)
    // A high needs_text_input only upgrades to typing when Jev's choice points at the focused
    // input itself; choosing some other element wins over the Noul.
    if needsText > needsTextThreshold, canTypeNow, !untyped.isEmpty,
      choice == "type_text" || (tree.focused != nil && choice == tree.focused?.id)
    {
      let text = chosenText(answers["text"], candidates: untyped)
      return make(.typeText(text, into: tree.focused))
    }
    switch choice {
    case "done":
      // Jev may say "done" while the UI is still settling (page loading); only trust it when the
      // goal_reached judgement agrees and the choice itself is not a coin flip. Otherwise act on
      // the runner-up element if Jev gave it real weight, else re-observe a few times.
      let trusted =
        goalReached >= goalReachedThreshold
        || (goalReached >= doneChoiceThreshold && confidence >= doneConfidenceThreshold)
      if trusted, canFinish(context) { return make(.done) }
      if let runnerUp = runnerUpElement(probabilities, tree: tree, context: context) {
        return make(.press(runnerUp))
      }
      if !canFinish(context) {
        return make(fallback(tree: tree, context: context), source: "fallback")
      }
      if trailingWaits(in: context.history) < maxWaits { return make(.wait) }
      return make(fallback(tree: tree, context: context, allowStuck: true), source: "fallback")
    case "stuck":
      return make(fallback(tree: tree, context: context, allowStuck: true), source: "fallback")
    case "scroll":
      return make(.scroll)
    case "press_key":
      let key = answers["key"]?.choice.flatMap(KeyChord.named) ?? KeyChord.named("Return")!
      if trailingKeyPresses(of: key, in: context.history) >= maxRepeats {
        return make(fallback(tree: tree, context: context, allowStuck: true), source: "fallback")
      }
      return make(.pressKey(key))
    case "type_text":
      guard !untyped.isEmpty else {
        return make(fallback(tree: tree, context: context), source: "fallback")
      }
      if !canTypeNow {
        // Nothing is focused that accepts text: focus the first text input instead of typing blind.
        if let input = tree.elements.first(where: \.isTextInput) { return make(.press(input)) }
        return make(fallback(tree: tree, context: context), source: "fallback")
      }
      let text = chosenText(answers["text"], candidates: untyped)
      return make(.typeText(text, into: tree.focused))
    default:
      guard let element = tree.elements.first(where: { $0.id == choice }) else {
        return make(fallback(tree: tree, context: context), source: "fallback")
      }
      if repeatCount(of: element, in: context.history) >= maxRepeats {
        return make(fallback(tree: tree, context: context, excluding: element), source: "fallback")
      }
      return make(.press(element))
    }
  }

  /// Deterministic heuristic used when Jev is slow, unavailable, or low confidence.
  static func fallback(
    tree: FlatTree, context: PilotContext, excluding: FlatElement? = nil, allowStuck: Bool = false
  ) -> PilotAction {
    let untyped = context.textCandidates.filter { !context.typedTexts.contains($0) }
    if untyped.isEmpty, arithmeticResultVisible(tree: tree, context: context) { return .done }
    if let focused = tree.focused, focused.isTextInput, let text = untyped.first {
      return .typeText(text, into: focused)
    }
    let goalTokens = Goal.relevanceTokens(context.goal)
    let scored = tree.elements.compactMap { element -> (FlatElement, Double)? in
      guard element.id != excluding?.id, !element.destructive else { return nil }
      guard repeatCount(of: element, in: context.history) < maxRepeats else { return nil }
      let text = [element.label, element.value].compactMap { $0 }.joined(separator: " ")
      let score = Goal.relevance(of: text, to: goalTokens)
      return score > 0 ? (element, score) : nil
    }
    if let best = scored.max(by: { $0.1 < $1.1 || ($0.1 == $1.1 && $0.0.id > $1.0.id) }) {
      return .press(best.0)
    }
    if acceptsRawKeystrokes(tree: tree, context: context), let text = untyped.first {
      return .typeText(text, into: nil)
    }
    if let input = tree.elements.first(where: { $0.isTextInput && $0.id != excluding?.id }),
      !untyped.isEmpty
    {
      return .press(input)
    }
    if tree.hasModalSheet { return .pressKey(KeyChord.named("Escape")!) }
    return .stuck(
      allowStuck ? "Jev reported stuck and no heuristic match" : "no element matches the goal")
  }

  /// Every code-evaluated arithmetic result from the goal is showing somewhere in the UI.
  static func arithmeticResultVisible(tree: FlatTree, context: PilotContext) -> Bool {
    let facts = TextCandidates.arithmeticFacts(from: context.textCandidates)
    return !facts.isEmpty
      && facts.values.allSatisfy { tree.showsText($0, windowTitle: context.windowTitle) }
  }

  /// Apps without any text input (Calculator) take arithmetic as raw keystrokes.
  static func acceptsRawKeystrokes(tree: FlatTree, context: PilotContext) -> Bool {
    !tree.elements.contains(where: \.isTextInput)
      && !TextCandidates.arithmeticFacts(from: context.textCandidates).isEmpty
  }

  /// Enforces the destructive-action policy in code regardless of what Jev chose.
  static func guardAction(_ action: PilotAction, destructive: Double, context: PilotContext)
    -> PilotAction
  {
    guard case .press(let element) = action else { return action }
    if element.destructive {
      return .blocked(
        "'\(element.label ?? element.role)' looks destructive and the goal does not name it")
    }
    let goalNamesDestructive = TreeFlattener.destructiveWords.contains {
      TreeFlattener.containsWord(context.goal.lowercased(), $0)
    }
    if destructive > destructiveThreshold, !goalNamesDestructive {
      return .blocked(
        "Jev judged '\(element.label ?? element.role)' destructive (\(Int(destructive * 100))%)")
    }
    return action
  }

  static func chosenText(_ answer: Jev.Answer?, candidates: [String]) -> String {
    if let choice = answer?.choice, candidates.contains(choice) { return choice }
    return candidates[0]
  }

  /// The highest-probability real element behind a rejected pseudo-choice, if Jev gave it weight.
  static func runnerUpElement(
    _ probabilities: [(String, Double)], tree: FlatTree, context: PilotContext
  ) -> FlatElement? {
    for (id, probability) in probabilities where probability >= minimumChoiceConfidence {
      guard let element = tree.elements.first(where: { $0.id == id }) else { continue }
      if repeatCount(of: element, in: context.history) < maxRepeats { return element }
    }
    return nil
  }

  /// A goal that asks to create something is never satisfied by a pre-existing item: it needs at
  /// least one real action first. Other goals ("turn on Dark Mode") may already be true.
  static func canFinish(_ context: PilotContext) -> Bool {
    !Goal.createsSomething(context.goal)
      || context.history.contains { $0.action != "wait" && $0.action != "done" }
  }

  static func trailingWaits(in history: [StepRecord]) -> Int {
    history.reversed().prefix { $0.action == "wait" }.count
  }

  /// Consecutive presses of the same key with nothing else in between: the key is not working.
  static func trailingKeyPresses(of key: KeyChord, in history: [StepRecord]) -> Int {
    history.reversed().prefix { $0.action == "press_key" && $0.target == key.name }.count
  }

  static func repeatCount(of element: FlatElement, in history: [StepRecord]) -> Int {
    let target = "\(element.summary)"
    return history.filter { $0.action == "press" && ($0.target?.hasSuffix(target) ?? false) }.count
  }

  static func sortedProbabilities(_ probabilities: [String: Double]) -> [(String, Double)] {
    probabilities.sorted { $0.value > $1.value || ($0.value == $1.value && $0.key < $1.key) }
      .map { ($0.key, $0.value) }
  }
}
