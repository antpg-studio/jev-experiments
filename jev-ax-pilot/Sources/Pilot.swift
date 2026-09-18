import AppKit
import Foundation
import Observation

/// Preset goals; each maps to a built-in app so the pilot can bring it frontmost first.
struct Preset: Identifiable, Equatable {
  var id: String { goal }
  var goal: String
  var bundleIdentifier: String

  static let all: [Preset] = [
    Preset(
      goal: "Create a new note titled Grocery list in Notes", bundleIdentifier: "com.apple.Notes"),
    Preset(
      goal: "Open System Settings and turn on Dark Mode",
      bundleIdentifier: "com.apple.systempreferences"),
    Preset(goal: "In Calculator compute 48*12", bundleIdentifier: "com.apple.calculator"),
    Preset(
      goal: "In Safari open a new tab and go to typesafe.ai", bundleIdentifier: "com.apple.Safari"),
    Preset(
      goal: "In TextEdit make a new document and type Hello from Jev",
      bundleIdentifier: "com.apple.TextEdit"),
  ]

  static let bundleIdentifiers: [String: String] = [
    "Notes": "com.apple.Notes", "System Settings": "com.apple.systempreferences",
    "Calculator": "com.apple.calculator", "Safari": "com.apple.Safari",
    "TextEdit": "com.apple.TextEdit",
    "Finder": "com.apple.finder", "Mail": "com.apple.mail", "Messages": "com.apple.MobileSMS",
    "Reminders": "com.apple.reminders", "Calendar": "com.apple.iCal", "Music": "com.apple.Music",
    "Photos": "com.apple.Photos", "Preview": "com.apple.Preview", "Terminal": "com.apple.Terminal",
    "Maps": "com.apple.Maps", "Contacts": "com.apple.AddressBook", "Stickies": "com.apple.Stickies",
  ]
}

/// One row of the HUD step log.
struct StepLog: Identifiable, Equatable {
  var id: Int { step }
  var step: Int
  var action: String
  var target: String?
  var source: String
  var latencyMs: Double?
  var inputTokens: Int?
  var goalReached: Double
  var elementCount: Int
  var readMs: Double
}

/// How decisions are made: live Jev, Jev with a fake "typical LLM" delay, or heuristics only.
enum DecisionMode: String, CaseIterable, Identifiable {
  case jev = "Jev"
  case slowLLM = "Simulated 3 s LLM"
  case heuristic = "Heuristic only"

  var id: String { rawValue }
}

enum PilotStatus: Equatable {
  case idle
  case launching(String)
  case running
  case finished(String)
  case failed(String)

  var isActive: Bool {
    switch self {
    case .launching, .running: return true
    default: return false
    }
  }
}

/// Drives the observe → ask → act loop. UI never blocks on the network: the request for a step
/// races a deadline, and whichever finishes first (Jev or the deterministic fallback) acts.
@MainActor
@Observable
final class Pilot {
  static let stepCap = 30
  static let jevDeadline: TimeInterval = 0.9
  static let slowLLMDelay: TimeInterval = 3.0
  static let settleDelay: TimeInterval = 0.25

  var status: PilotStatus = .idle
  var goal = ""
  var mode: DecisionMode = .jev
  var metrics = Metrics()
  var steps: [StepLog] = []
  var lastDecision: Decision?
  var highlightFrame: CGRect?
  var lastTree: FlatTree?
  var lastError: String?
  var typedTexts: [String] = []
  private var rawTypedTexts: Set<String> = []
  var isTrusted = AXReader.isTrusted
  var hasAPIKey = JevClient.apiKey() != nil

  private let reader = AXReader()
  private let client = JevClient()
  private let trace = ProcessInfo.processInfo.environment["JEV_AX_PILOT_TRACE"] != nil
  private var task: Task<Void, Never>?
  private var sequence = 0
  private var escapeMonitors: [Any] = []

  init() {
    installEscapeHotkey()
  }

  func refreshPermissions() {
    isTrusted = AXReader.isTrusted
    hasAPIKey = JevClient.apiKey() != nil
  }

  func start(goal: String) {
    guard !status.isActive else { return }
    self.goal = goal
    steps = []
    lastDecision = nil
    highlightFrame = nil
    lastError = nil
    typedTexts = []
    rawTypedTexts = []
    metrics.start()
    refreshPermissions()
    guard isTrusted else {
      status = .failed("Accessibility permission is required")
      return
    }
    task = Task { await run() }
  }

  func stop(reason: String = "Stopped") {
    task?.cancel()
    task = nil
    highlightFrame = nil
    if status.isActive {
      metrics.finish()
      status = .finished(reason)
    }
  }

  // MARK: - Loop

  private func run() async {
    let appName = TextCandidates.appName(in: goal)
    guard let app = await bringAppForward(named: appName) else {
      status = .failed("Could not find or launch the target app")
      return
    }
    status = .running
    let candidates = TextCandidates.extract(from: goal)
    var history: [StepRecord] = []
    for step in 1...Self.stepCap {
      if Task.isCancelled { return }
      let readStart = DispatchTime.now()
      let reader = self.reader
      let snapshot = await Task.detached(priority: .userInitiated) { reader.snapshot(of: app) }
        .value
      let readMs =
        Double(DispatchTime.now().uptimeNanoseconds - readStart.uptimeNanoseconds) / 1_000_000
      let screen = NSScreen.screens.reduce(CGRect.null) { $0.union(flipped($1.frame)) }
      let tree = TreeFlattener.flatten(snapshot, goal: goal, screen: screen)
      lastTree = tree
      // Text typed into a field counts as typed only while the UI still shows it (a new tab or
      // cleared field loses it), so the candidate becomes available again instead of the loop
      // assuming it landed. Raw keystrokes (Calculator) are rendered differently and stay typed.
      typedTexts.removeAll {
        !rawTypedTexts.contains($0) && !tree.showsText($0, windowTitle: snapshot.windowTitle)
      }
      let context = PilotContext(
        goal: goal, step: step, appName: snapshot.appName, windowTitle: snapshot.windowTitle,
        textCandidates: candidates, typedTexts: typedTexts, history: history)
      let decision = await decide(tree: tree, context: context)
      if Task.isCancelled { return }
      lastDecision = decision
      highlightFrame = highlight(for: decision.action)
      metrics.recordStep(source: decision.source)
      steps.append(
        StepLog(
          step: step, action: decision.action.name, target: decision.action.target,
          source: decision.source,
          latencyMs: decision.source == "jev" ? metrics.lastLatencyMs : nil,
          inputTokens: decision.source == "jev" ? lastInputTokens : nil,
          goalReached: decision.goalReached, elementCount: tree.elements.count, readMs: readMs))
      history.append(
        StepRecord(
          step: step, action: decision.action.name, target: decision.action.target,
          source: decision.source))
      if trace { logTrace(step: step, tree: tree, decision: decision, readMs: readMs) }
      if decision.action.isTerminal {
        finish(with: decision.action)
        return
      }
      execute(decision.action, app: app)
      try? await Task.sleep(for: .seconds(Self.settleDelay))
    }
    metrics.finish()
    status = .finished("Step cap (\(Self.stepCap)) reached")
  }

  private var lastInputTokens: Int?

  private func decide(tree: FlatTree, context: PilotContext) async -> Decision {
    if mode == .heuristic {
      return fallbackDecision(tree: tree, context: context)
    }
    sequence += 1
    let mySequence = sequence
    let state = StateBuilder.state(tree: tree, context: context)
    let questions = StateBuilder.questions(tree: tree, context: context)
    let deadline = mode == .slowLLM ? Self.slowLLMDelay + Self.jevDeadline : Self.jevDeadline
    let request = Task { [client] in
      try await client.ask(state: state, questions: questions, sequence: mySequence)
    }
    let timer = Task { try await Task.sleep(for: .seconds(deadline)) }
    let outcome: Swift.Result<JevClient.Result, Error>? = await withTaskGroup(
      of: Swift.Result<JevClient.Result, Error>?.self
    ) { group in
      group.addTask {
        try? await timer.value
        return nil
      }
      group.addTask {
        do { return .success(try await request.value) } catch { return .failure(error) }
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
    guard sequence == mySequence, !Task.isCancelled else {
      metrics.recordStale()
      return fallbackDecision(tree: tree, context: context)
    }
    switch outcome {
    case .success(let result):
      if mode == .slowLLM {
        try? await Task.sleep(for: .seconds(Self.slowLLMDelay))
      }
      metrics.recordResponse(latencyMs: result.latencyMs, usage: result.response.usage)
      lastInputTokens = result.response.usage.inputTokens
      return AnswerHandler.decide(answers: result.response.answers, tree: tree, context: context)
    case .failure(let error):
      metrics.recordFailure()
      lastError = error.localizedDescription
      return fallbackDecision(tree: tree, context: context)
    case nil:
      request.cancel()
      metrics.recordFailure()
      lastError = "Jev did not answer within \(Int(deadline * 1000)) ms; used fallback"
      return fallbackDecision(tree: tree, context: context)
    }
  }

  private func fallbackDecision(tree: FlatTree, context: PilotContext) -> Decision {
    let action = AnswerHandler.guardAction(
      AnswerHandler.fallback(tree: tree, context: context), destructive: 0, context: context)
    return Decision(
      action: action, source: "fallback", goalReached: 0, needsText: 0, isDestructive: 0,
      confidence: 0,
      probabilities: [])
  }

  private func execute(_ action: PilotAction, app: NSRunningApplication) {
    switch action {
    case .press(let element):
      guard let live = reader.element(at: element.path) else {
        reader.clickCenter(of: element.frame)
        return
      }
      if element.isTextInput {
        // "Pressing" a text input means giving it keyboard focus.
        app.activate()
        if !reader.focus(live) { reader.clickCenter(of: element.frame) }
      } else {
        reader.press(live)
      }
    case .typeText(let text, let target):
      app.activate()
      let live = target.flatMap { reader.element(at: $0.path) }
      if let live { reader.focus(live) }
      reader.typeText(text)
      // Some fields (Safari's smart search field) drop synthetic keystrokes when focus moved
      // in the same step; set the AX value directly if the typed text did not land.
      if let live, target?.role != "text area", reader.value(of: live)?.contains(text) != true {
        reader.setValue(text, on: live)
      }
      if target == nil {
        // Raw keystrokes only happen for arithmetic in an app without text inputs; Return evaluates.
        reader.pressKey(KeyChord.named("Return")!)
        rawTypedTexts.insert(text)
      }
      typedTexts.append(text)
    case .pressKey(let key):
      app.activate()
      reader.pressKey(key)
    case .scroll:
      reader.scroll(lines: -6)
    case .wait, .done, .stuck, .blocked:
      break
    }
  }

  private func finish(with action: PilotAction) {
    metrics.finish()
    switch action {
    case .done: status = .finished("Goal reached")
    case .stuck(let reason): status = .finished("Stuck: \(reason)")
    case .blocked(let reason): status = .finished("Blocked: \(reason)")
    default: status = .finished("Finished")
    }
  }

  /// Enabled with JEV_AX_PILOT_TRACE=1; writes each step's elements and decision to stderr.
  private func logTrace(step: Int, tree: FlatTree, decision: Decision, readMs: Double) {
    var lines = ["--- step \(step) read=\(Int(readMs))ms elements=\(tree.elements.count)"]
    for element in tree.elements {
      lines.append("  \(element.id) \(element.summary)\(element.focused ? " [focused]" : "")")
    }
    lines.append("  context: \(tree.contextText.joined(separator: " | "))")
    let top = decision.probabilities.prefix(5).map { "\($0.0)=\(String(format: "%.2f", $0.1))" }
    lines.append(
      "  -> \(decision.action.name) \(decision.action.target ?? "") [\(decision.source)] "
        + "goal=\(String(format: "%.2f", decision.goalReached)) "
        + "text=\(String(format: "%.2f", decision.needsText)) "
        + "destructive=\(String(format: "%.2f", decision.isDestructive)) "
        + "latency=\(Int(metrics.lastLatencyMs ?? 0))ms top=\(top.joined(separator: ","))")
    FileHandle.standardError.write(Data((lines.joined(separator: "\n") + "\n").utf8))
  }

  private func highlight(for action: PilotAction) -> CGRect? {
    switch action {
    case .press(let element): return element.frame.isEmpty ? nil : element.frame
    case .typeText(_, let element): return element?.frame
    default: return nil
    }
  }

  // MARK: - App activation

  private func bringAppForward(named name: String?) async -> NSRunningApplication? {
    var app: NSRunningApplication?
    if let name, let bundleIdentifier = Preset.bundleIdentifiers[name] {
      status = .launching(name)
      app = NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == bundleIdentifier }
      if app == nil,
        let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier)
      {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        app = try? await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        try? await Task.sleep(for: .seconds(1.2))
      }
    } else {
      app = NSWorkspace.shared.runningApplications.first {
        $0.isActive && $0.bundleIdentifier != Bundle.main.bundleIdentifier
      }
    }
    guard let app else { return nil }
    app.activate()
    for _ in 0..<20 where !app.isActive {
      try? await Task.sleep(for: .milliseconds(100))
    }
    return app
  }

  private func flipped(_ frame: CGRect) -> CGRect {
    // AX frames use a top-left origin on the primary screen; NSScreen uses bottom-left.
    guard let primary = NSScreen.screens.first else { return frame }
    return CGRect(
      x: frame.origin.x, y: primary.frame.height - frame.origin.y - frame.height,
      width: frame.width,
      height: frame.height)
  }

  // MARK: - Escape hotkey

  private func installEscapeHotkey() {
    let handler: (NSEvent) -> Void = { [weak self] event in
      guard event.keyCode == 53 else { return }
      Task { @MainActor in self?.stop(reason: "Stopped with Escape") }
    }
    if let global = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: handler) {
      escapeMonitors.append(global)
    }
    if let local = NSEvent.addLocalMonitorForEvents(
      matching: .keyDown,
      handler: { event in
        handler(event)
        return event
      })
    {
      escapeMonitors.append(local)
    }
  }
}
