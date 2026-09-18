import Foundation

/// One executed step, kept so Jev can see what has already been tried.
struct StepRecord: Equatable {
  var step: Int
  var action: String
  var target: String?
  var source: String
}

/// Everything the pilot knows at one decision point.
struct PilotContext: Equatable {
  var goal: String
  var step: Int
  var appName: String
  var windowTitle: String?
  var textCandidates: [String]
  var typedTexts: [String]
  var history: [StepRecord]
}

/// Builds the structured state and the batched Jev questions for one step.
enum StateBuilder {
  static let pseudoOptions: [(String, String)] = [
    (
      "type_text",
      "Type one of text_candidates into the focused text input (only when a text input is focused)"
    ),
    (
      "press_key",
      "Press a keyboard shortcut chosen by the key question instead of touching an element "
        + "(e.g. Return to submit text already typed into the focused field)"
    ),
    ("scroll", "Scroll the frontmost view down to reveal more elements"),
    ("done", "The goal is fully achieved; nothing more to do"),
    ("stuck", "No listed element or key can make progress toward the goal"),
  ]

  static func state(tree: FlatTree, context: PilotContext) -> JSONValue {
    let elements = tree.elements.map { element -> JSONValue in
      var pairs: [(String, JSONValue)] = [
        ("id", .string(element.id)), ("role", .string(element.role)),
      ]
      if let label = element.label { pairs.append(("label", .string(label))) }
      if let value = element.value { pairs.append(("value", .string(value))) }
      if element.focused { pairs.append(("focused", .bool(true))) }
      if element.selected { pairs.append(("selected", .bool(true))) }
      if element.destructive { pairs.append(("destructive", .bool(true))) }
      return .object(pairs)
    }
    let history = context.history.suffix(8).map { record -> JSONValue in
      var pairs: [(String, JSONValue)] = [
        ("step", .int(record.step)), ("action", .string(record.action)),
      ]
      if let target = record.target { pairs.append(("target", .string(target))) }
      return .object(pairs)
    }
    let facts = TextCandidates.arithmeticFacts(from: context.textCandidates)
    var pairs: [(String, JSONValue)] = [
      ("goal", .string(context.goal)),
      ("step", .int(context.step)),
      ("frontmost_app", .string(context.appName)),
      ("window_title", context.windowTitle.map(JSONValue.string) ?? .null),
      ("focused_element", tree.focused.map { .string("\($0.id) \($0.summary)") } ?? .null),
      ("modal_sheet_open", .bool(tree.hasModalSheet)),
      ("visible_text", .array(tree.contextText.map(JSONValue.string))),
      ("elements", .array(elements)),
      ("text_candidates", .array(context.textCandidates.map(JSONValue.string))),
      ("already_typed", .array(context.typedTexts.map(JSONValue.string))),
      ("previous_actions", .array(Array(history))),
    ]
    if Goal.createsSomething(context.goal), context.history.isEmpty {
      pairs.append(
        (
          "note",
          .string(
            "No action has been taken yet. The goal asks to create something new, so an item that already exists does not satisfy it."
          )
        ))
    }
    if !facts.isEmpty {
      pairs.append(
        ("facts", .object(facts.sorted { $0.key < $1.key }.map { ($0.key, .string($0.value)) })))
    }
    return .object(pairs)
  }

  static func questions(tree: FlatTree, context: PilotContext) -> [String: Jev.Question] {
    var options = tree.elements.map { ($0.id, $0.summary) }
    options.append(contentsOf: pseudoOptions)
    var questions: [String: Jev.Question] = [
      "next_element": .choice(
        "Given the goal, the frontmost app state and previous_actions, which single element should be activated next, "
          + "or which pseudo-action applies? Prefer the element that directly advances the goal; pick done only if the "
          + "goal is already visible in the state; pick stuck only if nothing listed can help.",
        options: options),
      "key": .choice(
        "If the next step is press_key, which shortcut advances the goal in this app? Return confirms or navigates, "
          + "Cmd+N makes a new document or note, Cmd+T opens a new tab, Cmd+L focuses the address bar, "
          + "Escape dismisses a sheet or menu.",
        options: KeyChord.all.map { ($0.name, $0.name) }),
      "goal_reached": .noul(
        "Does the current UI state (window_title, visible_text, element labels and values, selected flags, already_typed) "
          + "show that the goal has been fully achieved? A setting counts only if the option the goal names is the one "
          + "marked selected; a created item counts only if previous_actions shows it being created.",
        yes: "The state already shows the goal is achieved", no: "More steps are still required"),
      "needs_text_input": .noul(
        "Does the next step require typing text from text_candidates into a text input?",
        yes: "Typing is the next step", no: "The next step is not typing"),
      "is_destructive": .noul(
        "Would the most likely next action delete, erase, send, pay for, purchase or otherwise irreversibly change "
          + "something that the goal did not explicitly ask for?",
        yes: "The next action is destructive or irreversible",
        no: "The next action is safe and reversible"),
    ]
    if context.textCandidates.count > 1 {
      questions["text"] = .choice(
        "If text must be typed now, which candidate from the goal belongs in the focused input?",
        options: context.textCandidates.map { ($0, "Type '\($0)'") })
    }
    return questions
  }
}
