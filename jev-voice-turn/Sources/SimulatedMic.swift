import Foundation

/// One scripted utterance with realistic per-word timing.
struct ScriptedUtterance: Equatable {
  struct Word: Equatable {
    var text: String
    /// Milliseconds of silence before this word starts.
    var gapBeforeMs: Double
    var durationMs: Double
  }
  var words: [Word]
  /// When true, this utterance is spoken while the assistant is still talking (an interruption),
  /// starting `bargeInDelayMs` after the assistant begins speaking.
  var bargeIn = false
  var bargeInDelayMs: Double = 900

  static func spoken(_ text: String, pauseAfterWords: [String: Double] = [:]) -> ScriptedUtterance {
    let tokens = text.split(separator: " ").map(String.init)
    var words: [Word] = []
    var pendingGap: Double = 0
    for t in tokens {
      let duration = 150 + 40 * Double(t.count)
      words.append(Word(text: t, gapBeforeMs: pendingGap, durationMs: duration))
      pendingGap = pauseAfterWords[t] ?? 70
    }
    return ScriptedUtterance(words: words)
  }

  static func interruption(_ text: String, afterMs: Double) -> ScriptedUtterance {
    var u = spoken(text)
    u.bargeIn = true
    u.bargeInDelayMs = afterMs
    return u
  }

  var text: String { words.map(\.text).joined(separator: " ") }

  /// Offsets in ms from utterance start at which each word finishes.
  var wordEndOffsetsMs: [Double] {
    var t: Double = 0
    return words.map { w in
      t += w.gapBeforeMs + w.durationMs
      return t
    }
  }
}

enum DemoScript {
  static let utterances: [ScriptedUtterance] = [
    .spoken("set a timer for ten minutes"),
    .spoken("what's the weather like in Boston tomorrow"),
    .spoken("turn off the lights in the kitchen"),
    .spoken("play some jazz"),
    .spoken("text mom I'll be late"),
    .spoken("how tall is the Eiffel Tower"),
    // Mid-sentence hesitation longer than the silence timeout: the baseline cuts the speaker off.
    .spoken("send a message to Sarah saying I'm on my way", pauseAfterWords: ["to": 1300]),
    .spoken("turn on the living room lights"),
    .interruption("stop stop", afterMs: 700),
    .spoken("set a timer for forty five minutes"),
  ]
}

/// Plays a script through the same `onPartial` interface as the live microphone.
/// Clearly a simulation: word timings come from the script, not from audio.
final class SimulatedMicSource: TranscriptSource {
  var onPartial: ((String) -> Void)?
  var onLevel: ((Float) -> Void)?
  var onError: ((String) -> Void)?
  var onFinished: (() -> Void)?

  private let script: [ScriptedUtterance]
  private var task: Task<Void, Never>?
  private var phase: AssistantPhase = .idle
  private var spoken: [String] = []
  private var speakingStartedAt: Date?

  init(script: [ScriptedUtterance] = DemoScript.utterances) {
    self.script = script
  }

  func start() {
    task?.cancel()
    task = Task { @MainActor [weak self] in
      guard let self else { return }
      try? await Task.sleep(for: .milliseconds(800))
      for (i, utterance) in self.script.enumerated() {
        if Task.isCancelled { return }
        if utterance.bargeIn {
          await self.waitForSpeaking()
          try? await Task.sleep(for: .milliseconds(Int(utterance.bargeInDelayMs)))
        } else if i > 0 {
          await self.waitForResponseCycle()
          try? await Task.sleep(for: .milliseconds(2200))
        }
        if Task.isCancelled { return }
        self.spoken = []
        await self.play(utterance)
      }
      await self.waitForResponseCycle()
      try? await Task.sleep(for: .milliseconds(1500))
      self.onFinished?()
    }
  }

  @MainActor
  private func play(_ u: ScriptedUtterance) async {
    for w in u.words {
      await silence(ms: w.gapBeforeMs)
      if Task.isCancelled { return }
      await voiced(ms: w.durationMs)
      spoken.append(w.text)
      onPartial?(spoken.joined(separator: " "))
    }
    onLevel?(0)
  }

  @MainActor
  private func silence(ms: Double) async {
    var left = ms
    while left > 0 && !Task.isCancelled {
      onLevel?(Float.random(in: 0...0.03))
      let step = min(left, 40)
      try? await Task.sleep(for: .milliseconds(Int(step)))
      left -= step
    }
  }

  @MainActor
  private func voiced(ms: Double) async {
    var elapsed: Double = 0
    while elapsed < ms && !Task.isCancelled {
      let envelope = sin(Double.pi * elapsed / ms)
      onLevel?(Float(0.25 + 0.6 * envelope * Double.random(in: 0.6...1.0)))
      try? await Task.sleep(for: .milliseconds(40))
      elapsed += 40
    }
  }

  /// Waits until the assistant has started and then finished speaking (or gives up after 4 s).
  @MainActor
  private func waitForResponseCycle() async {
    let deadline = Date().addingTimeInterval(4)
    while phase != .speaking && Date() < deadline && !Task.isCancelled {
      try? await Task.sleep(for: .milliseconds(30))
    }
    let finishDeadline = Date().addingTimeInterval(8)
    while phase == .speaking && Date() < finishDeadline && !Task.isCancelled {
      try? await Task.sleep(for: .milliseconds(30))
    }
  }

  @MainActor
  private func waitForSpeaking() async {
    let deadline = Date().addingTimeInterval(4)
    while phase != .speaking && Date() < deadline && !Task.isCancelled {
      try? await Task.sleep(for: .milliseconds(30))
    }
  }

  func resetUtterance() {
    spoken = []
  }

  func assistantPhaseChanged(_ phase: AssistantPhase) {
    self.phase = phase
  }

  func stop() {
    task?.cancel()
    task = nil
    onLevel?(0)
  }
}
