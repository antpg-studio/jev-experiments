import XCTest

@testable import JevAXPilot

final class TextCandidatesTests: XCTestCase {
  func testPresetGoalsYieldExpectedSpans() {
    XCTAssertEqual(
      TextCandidates.extract(from: "Create a new note titled Grocery list in Notes"),
      ["Grocery list"])
    XCTAssertEqual(TextCandidates.extract(from: "Open System Settings and turn on Dark Mode"), [])
    XCTAssertEqual(TextCandidates.extract(from: "In Calculator compute 48*12"), ["48*12"])
    XCTAssertEqual(
      TextCandidates.extract(from: "In Safari open a new tab and go to typesafe.ai"),
      ["typesafe.ai"])
    XCTAssertEqual(
      TextCandidates.extract(from: "In TextEdit make a new document and type Hello from Jev"),
      ["Hello from Jev"])
  }

  func testQuotedSpansComeFirst() {
    let candidates = TextCandidates.extract(from: "In Notes type \"Buy milk\" and then type eggs")
    XCTAssertEqual(candidates.first, "Buy milk")
    XCTAssertTrue(candidates.contains("eggs"))
  }

  func testArithmeticIsEvaluatedInCode() {
    XCTAssertEqual(TextCandidates.arithmeticFacts(from: ["48*12"]), ["48*12 equals": "576"])
    XCTAssertEqual(TextCandidates.arithmeticFacts(from: ["100 / 8"]), ["100 / 8 equals": "12.5"])
    XCTAssertEqual(TextCandidates.arithmeticFacts(from: ["Grocery list"]), [:])
  }

  func testAppNameDetection() {
    XCTAssertEqual(
      TextCandidates.appName(in: "Open System Settings and turn on Dark Mode"), "System Settings")
    XCTAssertEqual(TextCandidates.appName(in: "In TextEdit type hello"), "TextEdit")
    XCTAssertNil(TextCandidates.appName(in: "press the button"))
  }
}

final class StateBuilderTests: XCTestCase {
  func testStateContainsElementsFactsAndHistory() throws {
    let goal = "In Calculator compute 48*12"
    let tree = try Fixture.tree("Calculator", goal: goal)
    var context = Fixture.context(goal, tree: tree, step: 3)
    context.history = [StepRecord(step: 1, action: "press", target: "e9 button '4'", source: "jev")]
    let state = StateBuilder.state(tree: tree, context: context)
    XCTAssertEqual(state["goal"]?.stringValue, goal)
    XCTAssertEqual(state["elements"]?.arrayValue?.count, tree.elements.count)
    XCTAssertEqual(state["facts"]?["48*12 equals"]?.stringValue, "576")
    XCTAssertEqual(state["previous_actions"]?.arrayValue?.count, 1)
    let first = state["elements"]?.arrayValue?.first
    XCTAssertEqual(first?["id"]?.stringValue, "e1")
    XCTAssertEqual(first?["destructive"], .bool(true))
  }

  func testQuestionsAreBatchedAndOptionsMatchElements() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let questions = StateBuilder.questions(tree: tree, context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(
      Set(questions.keys),
      ["next_element", "key", "goal_reached", "needs_text_input", "is_destructive"])
    guard case .options(let options)? = questions["next_element"]?.criteria else {
      return XCTFail("next_element must be a choice")
    }
    XCTAssertEqual(options.map(\.0), tree.elements.map(\.id) + StateBuilder.pseudoOptions.map(\.0))
    guard case .options(let keys)? = questions["key"]?.criteria else {
      return XCTFail("key must be a choice")
    }
    XCTAssertEqual(keys.map(\.0), KeyChord.all.map(\.name))
  }

  func testTextQuestionOnlyWhenSeveralCandidates() throws {
    let goal = "In Notes type \"Buy milk\" and then type eggs"
    let tree = try Fixture.tree("Notes", goal: goal)
    let questions = StateBuilder.questions(tree: tree, context: Fixture.context(goal, tree: tree))
    XCTAssertNotNil(questions["text"])
  }

  func testRequestEncodesToDocumentedShape() throws {
    let goal = "In Calculator compute 48*12"
    let tree = try Fixture.tree("Calculator", goal: goal)
    let context = Fixture.context(goal, tree: tree)
    let request = Jev.Request(
      state: StateBuilder.state(tree: tree, context: context),
      questions: StateBuilder.questions(tree: tree, context: context))
    let data = try JSONEncoder().encode(request)
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(object["model"] as? String, "typesafe/jev-1.13")
    let questions = try XCTUnwrap(object["questions"] as? [String: Any])
    let goalReached = try XCTUnwrap(questions["goal_reached"] as? [String: Any])
    XCTAssertEqual(goalReached["type"] as? String, "noul")
    let criteria = try XCTUnwrap(goalReached["criteria"] as? [String: String])
    XCTAssertEqual(Set(criteria.keys), ["true", "false"])
    XCTAssertLessThan(data.count, 8000, "state must stay compact")
  }

  func testResponseDecoding() throws {
    let json = """
      {"model":"jev-1.13.0","answers":{"next_element":{"type":"choice","choice":"e2","confidence":0.71,
      "probabilities":{"e2":0.71,"e1":0.2,"done":0.09}},"goal_reached":{"type":"noul","noul":0.04}},
      "usage":{"input_tokens":1200,"output_tokens":300}}
      """
    let response = try JSONDecoder().decode(Jev.Response.self, from: Data(json.utf8))
    XCTAssertEqual(response.answers["next_element"]?.choice, "e2")
    XCTAssertEqual(response.answers["goal_reached"]?.noul, 0.04)
    XCTAssertEqual(response.usage.inputTokens, 1200)
    XCTAssertEqual(
      AnswerHandler.sortedProbabilities(response.answers["next_element"]?.probabilities ?? [:]).map(
        \.0),
      ["e2", "e1", "done"])
  }
}

final class AnswerHandlerTests: XCTestCase {
  func testChosenElementIsPressed() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let newTab = try XCTUnwrap(tree.elements.first { $0.label == "New Tab" && $0.role == "button" })
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: newTab.id), tree: tree, context: Fixture.context(goal, tree: tree)
    )
    XCTAssertEqual(decision.action, .press(newTab))
    XCTAssertEqual(decision.source, "jev")
  }

  func testGoalReachedAboveThresholdFinishesAfterFirstStep() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let answers = Answers.full(next: "e1", goalReached: 0.95)
    let acted = StepRecord(step: 1, action: "press_key", target: "Cmd+T", source: "jev")
    XCTAssertEqual(
      AnswerHandler.decide(
        answers: answers, tree: tree,
        context: Fixture.context(goal, tree: tree, step: 2, history: [acted])
      ).action, .done)
    XCTAssertNotEqual(
      AnswerHandler.decide(
        answers: answers, tree: tree, context: Fixture.context(goal, tree: tree, step: 1)
      ).action, .done)
  }

  func testNeedsTextTypesIntoFocusedInput() throws {
    let goal = "In TextEdit make a new document and type Hello from Jev"
    let tree = try Fixture.tree("TextEdit", goal: goal)
    let focusedID = try XCTUnwrap(tree.focused?.id)
    let typing = AnswerHandler.decide(
      answers: Answers.full(next: focusedID, needsText: 0.9), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(typing.action, .typeText("Hello from Jev", into: tree.focused))
    // Choosing some other element wins over the needs_text_input Noul.
    let pressing = AnswerHandler.decide(
      answers: Answers.full(next: "e5", needsText: 0.9), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(pressing.action.name, "press")
    XCTAssertEqual(pressing.action.target?.hasPrefix("e5 "), true)
  }

  func testDoneChoiceNeedsGoalReachedOrWaits() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let acted = StepRecord(step: 1, action: "press_key", target: "Cmd+T", source: "jev")
    let context = Fixture.context(goal, tree: tree, step: 3, history: [acted])
    let early = AnswerHandler.decide(
      answers: Answers.full(next: "done", goalReached: 0.2), tree: tree, context: context)
    XCTAssertEqual(early.action, .wait)
    let agreed = AnswerHandler.decide(
      answers: Answers.full(next: "done", goalReached: 0.6), tree: tree, context: context)
    XCTAssertEqual(agreed.action, .done)
    let unsure = AnswerHandler.decide(
      answers: Answers.full(next: "done", confidence: 0.4, goalReached: 0.6), tree: tree,
      context: context)
    XCTAssertEqual(unsure.action, .wait)
  }

  func testRepeatedKeyPressFallsBack() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let history = [
      StepRecord(step: 1, action: "press_key", target: "Return", source: "jev"),
      StepRecord(step: 2, action: "press_key", target: "Return", source: "jev"),
    ]
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: "press_key", key: "Return"), tree: tree,
      context: Fixture.context(goal, tree: tree, step: 3, history: history))
    XCTAssertNotEqual(decision.action, .pressKey(KeyChord.named("Return")!))
    XCTAssertEqual(decision.source, "fallback")
  }

  func testLowConfidenceDoneActsOnRunnerUpElement() throws {
    let goal = "Open System Settings and turn on Dark Mode"
    let tree = try Fixture.tree("SystemSettings", goal: goal)
    let appearance = try XCTUnwrap(tree.elements.first { $0.label == "Appearance" })
    var answers = Answers.full(next: "done", confidence: 0.46, goalReached: 0.6)
    answers["next_element"] = Answers.choice(
      "done", confidence: 0.46, probabilities: ["done": 0.46, appearance.id: 0.28, "stuck": 0.05])
    let decision = AnswerHandler.decide(
      answers: answers, tree: tree, context: Fixture.context(goal, tree: tree, step: 2))
    XCTAssertEqual(decision.action, .press(appearance))
    XCTAssertEqual(decision.source, "jev")
  }

  func testCreateGoalIsNotDoneBeforeAnyAction() throws {
    let goal = "Create a new note titled Grocery list in Notes"
    let tree = try Fixture.tree("Notes", goal: goal)
    let first = AnswerHandler.decide(
      answers: Answers.full(next: "done", goalReached: 0.9), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertNotEqual(first.action, .done)
    let acted = StepRecord(step: 1, action: "press", target: "e3 button 'New Note'", source: "jev")
    let later = AnswerHandler.decide(
      answers: Answers.full(next: "done", goalReached: 0.9), tree: tree,
      context: Fixture.context(goal, tree: tree, step: 2, history: [acted]))
    XCTAssertEqual(later.action, .done)
    XCTAssertTrue(Goal.createsSomething("In Safari open a new tab and go to typesafe.ai"))
    XCTAssertFalse(Goal.createsSomething("Open System Settings and turn on Dark Mode"))
  }

  func testAlreadyTypedTextIsNotRetyped() throws {
    let goal = "In TextEdit make a new document and type Hello from Jev"
    let tree = try Fixture.tree("TextEdit", goal: goal)
    let context = Fixture.context(goal, tree: tree, typed: ["Hello from Jev"])
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: "type_text", needsText: 0.9), tree: tree, context: context)
    XCTAssertNotEqual(decision.action.name, "type_text")
  }

  func testArithmeticGoesInAsKeystrokesWhenNoTextInputExists() throws {
    let goal = "In Calculator compute 48*12"
    let tree = try Fixture.tree("Calculator", goal: goal)
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: "type_text"), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(decision.action, .typeText("48*12", into: nil))
  }

  func testFallbackFinishesWhenTypedArithmeticResultIsVisible() throws {
    let goal = "In Calculator compute 48*12"
    var tree = try Fixture.tree("Calculator", goal: goal)
    let typed = Fixture.context(goal, tree: tree, typed: ["48*12"])
    XCTAssertNotEqual(AnswerHandler.fallback(tree: tree, context: typed), .done)
    tree.contextText = ["48×12", "576"]
    XCTAssertEqual(AnswerHandler.fallback(tree: tree, context: typed), .done)
    XCTAssertNotEqual(
      AnswerHandler.fallback(tree: tree, context: Fixture.context(goal, tree: tree)), .done)
  }

  func testPressKeyUsesKeyAnswer() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: "press_key", key: "Cmd+T"), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(decision.action, .pressKey(KeyChord.named("Cmd+T")!))
  }

  func testLowConfidenceFallsBackToHeuristic() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: "e1", confidence: 0.05), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(decision.source, "fallback")
    guard case .press(let element) = decision.action else { return XCTFail("expected press") }
    XCTAssertEqual(element.label, "New Tab")
  }

  func testUnknownChoiceFallsBack() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: "e999"), tree: tree, context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(decision.source, "fallback")
  }

  func testRepeatedPressIsRedirected() throws {
    let goal = "In Safari open a new tab and go to typesafe.ai"
    let tree = try Fixture.tree("Safari", goal: goal)
    let newTab = try XCTUnwrap(tree.elements.first { $0.label == "New Tab" && $0.role == "button" })
    let record = StepRecord(step: 1, action: "press", target: "e9 \(newTab.summary)", source: "jev")
    let context = Fixture.context(goal, tree: tree, history: [record, record])
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: newTab.id), tree: tree, context: context)
    XCTAssertNotEqual(decision.action, .press(newTab))
  }

  func testHeuristicFallbackForEachFixture() throws {
    let safari = try Fixture.tree("Safari", goal: "In Safari open a new tab and go to typesafe.ai")
    guard
      case .press(let element) = AnswerHandler.fallback(
        tree: safari,
        context: Fixture.context("In Safari open a new tab and go to typesafe.ai", tree: safari))
    else { return XCTFail("expected press") }
    XCTAssertEqual(element.label, "New Tab")

    let textEdit = try Fixture.tree(
      "TextEdit", goal: "In TextEdit make a new document and type Hello from Jev")
    XCTAssertEqual(
      AnswerHandler.fallback(
        tree: textEdit,
        context: Fixture.context(
          "In TextEdit make a new document and type Hello from Jev", tree: textEdit)),
      .typeText("Hello from Jev", into: textEdit.focused))

    let settings = try Fixture.tree(
      "SystemSettings", goal: "Open System Settings and turn on Dark Mode")
    let stuck = AnswerHandler.fallback(
      tree: settings,
      context: Fixture.context("Open System Settings and turn on Dark Mode", tree: settings))
    XCTAssertEqual(stuck.name, "stuck")
  }

  func testDestructiveElementIsBlockedEvenIfJevChoosesIt() throws {
    let goal = "In Calculator compute 48*12"
    let tree = try Fixture.tree("Calculator", goal: goal)
    let delete = try XCTUnwrap(tree.elements.first { $0.label == "Delete" })
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: delete.id, destructive: 0.1), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(decision.action.name, "blocked")
  }

  func testJevDestructiveJudgementBlocksUnlessGoalNamesIt() throws {
    let goal = "In Calculator compute 48*12"
    let tree = try Fixture.tree("Calculator", goal: goal)
    let equals = try XCTUnwrap(tree.elements.first { $0.label == "Equals" })
    let blocked = AnswerHandler.decide(
      answers: Answers.full(next: equals.id, destructive: 0.8), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(blocked.action.name, "blocked")
    let allowed = AnswerHandler.decide(
      answers: Answers.full(next: equals.id, destructive: 0.49), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(allowed.action, .press(equals))
  }

  func testGoalNamingDestructiveWordAllowsIt() throws {
    let goal = "In Calculator press Delete"
    let tree = try Fixture.tree("Calculator", goal: goal)
    let delete = try XCTUnwrap(tree.elements.first { $0.label == "Delete" })
    XCTAssertFalse(delete.destructive)
    let decision = AnswerHandler.decide(
      answers: Answers.full(next: delete.id, destructive: 0.9), tree: tree,
      context: Fixture.context(goal, tree: tree))
    XCTAssertEqual(decision.action, .press(delete))
  }

  func testFallbackNeverPicksDestructiveElements() {
    let root = AXNode(
      role: "AXApplication",
      children: [
        AXNode(
          role: "AXWindow", frame: CGRect(x: 0, y: 0, width: 800, height: 600),
          children: [
            AXNode(
              role: "AXButton", title: "Delete note",
              frame: CGRect(x: 10, y: 10, width: 80, height: 30))
          ])
      ])
    let snapshot = AXSnapshot(appName: "Test", bundleIdentifier: nil, windowTitle: nil, root: root)
    let tree = TreeFlattener.flatten(snapshot, goal: "open the note")
    XCTAssertEqual(
      AnswerHandler.fallback(tree: tree, context: Fixture.context("open the note", tree: tree))
        .name, "stuck")
  }
}

final class MetricsTests: XCTestCase {
  func testPercentilesTokensAndCost() {
    var metrics = Metrics()
    metrics.start(at: Date(timeIntervalSince1970: 0))
    for latency in [120.0, 90.0, 300.0, 150.0, 110.0] {
      metrics.recordResponse(
        latencyMs: latency, usage: Jev.Usage(inputTokens: 1000, outputTokens: 200))
      metrics.recordStep(source: "jev")
    }
    metrics.recordFailure()
    metrics.recordStep(source: "fallback")
    metrics.finish(at: Date(timeIntervalSince1970: 4))
    XCTAssertEqual(metrics.lastLatencyMs, 110)
    XCTAssertEqual(metrics.p50Ms, 120)
    XCTAssertEqual(metrics.p95Ms, 300)
    XCTAssertEqual(metrics.requests, 6)
    XCTAssertEqual(metrics.failures, 1)
    XCTAssertEqual(metrics.steps, 6)
    XCTAssertEqual(metrics.jevDecisions, 5)
    XCTAssertEqual(metrics.fallbackDecisions, 1)
    XCTAssertEqual(metrics.totalTokens, 6000)
    XCTAssertEqual(metrics.estimatedCostUSD, 5000 * 0.042 / 1_000_000, accuracy: 1e-12)
    XCTAssertEqual(metrics.stepsPerSecond, 1.5)
    XCTAssertEqual(metrics.tokensPerDecision, 5000.0 / 6.0, accuracy: 1e-9)
  }

  func testEmptyMetrics() {
    let metrics = Metrics()
    XCTAssertNil(metrics.p50Ms)
    XCTAssertEqual(metrics.stepsPerSecond, 0)
    XCTAssertEqual(metrics.estimatedCostUSD, 0)
  }
}
