import Foundation
import SwiftUI

struct LevelSample: Equatable {
  var time: TimeInterval
  var level: Float
}

/// Owns the session clock, the transcript, in-flight Jev requests and the turn-taking policy.
@MainActor
final class SessionEngine: ObservableObject {
  enum Mode: String, CaseIterable, Identifiable {
    case simulated = "Simulated microphone"
    case live = "Live microphone"
    var id: String { rawValue }
  }

  static let historyWindow: TimeInterval = 40
  static let rateLimitBackoff: TimeInterval = 2

  @Published var mode: Mode = .simulated
  @Published var jevEnabled = true
  @Published var policy = TurnPolicy()
  @Published private(set) var isRunning = false
  @Published private(set) var phase: AssistantPhase = .idle
  @Published private(set) var now: TimeInterval = 0
  @Published private(set) var words: [TranscriptWord] = []
  @Published private(set) var latest: DecisionSample?
  @Published private(set) var samples: [DecisionSample] = []
  @Published private(set) var markers: [TimelineMarker] = []
  @Published private(set) var wordHistory: [TranscriptWord] = []
  @Published private(set) var levels: [LevelSample] = []
  @Published private(set) var turns: [TurnRecord] = []
  @Published private(set) var stats = LatencyStats()
  @Published private(set) var inflight = 0
  @Published private(set) var response: String?
  @Published private(set) var responseIntent: Intent?
  @Published private(set) var lastError: String?
  @Published private(set) var statusNote = "Idle"
  @Published private(set) var scriptFinished = false

  var hasAPIKey: Bool { JevClient.apiKey() != nil }
  var comparison: TimelineMath.Comparison { TimelineMath.comparison(turns) }
  var transcript: String { words.map(\.text).joined(separator: " ") }
  /// Silence since speech last ended: the later of the last word and the last voiced audio,
  /// so a long word still being spoken is not mistaken for a pause.
  var msSinceLastWord: Double {
    guard let last = words.last else { return 0 }
    return max(0, now - max(last.time, lastVoicedTime)) * 1000
  }
  private var lastVoicedTime: TimeInterval = 0
  private static let voicedLevel: Float = 0.05

  private var start = Date()
  private var seq = 0
  private var appliedSeq = 0
  private var latestAnswers: JevAnswers?
  private var source: TranscriptSource?
  private let client = JevClient()
  private let speaker = Speaker()
  private var ticker: Timer?
  private var requestsThisTurn = 0
  private var baselineFiredAt: TimeInterval?
  private var ignorePartialsUntil: TimeInterval = 0
  /// Set when a partial arrived while a request was in flight. At most one request is in flight;
  /// intermediate partials are coalesced so the newest transcript is always the one evaluated.
  private var pending = false
  private var rateLimitedUntil: TimeInterval = 0
  var isRateLimited: Bool { now < rateLimitedUntil }

  init() {
    speaker.onFinished = { [weak self] in
      guard let self, self.phase == .speaking else { return }
      self.setPhase(.listening)
    }
  }

  // MARK: Lifecycle

  func startSession() {
    stopSession()
    start = Date()
    now = 0
    seq = 0
    appliedSeq = 0
    words = []
    latest = nil
    latestAnswers = nil
    samples = []
    markers = []
    wordHistory = []
    levels = []
    turns = []
    stats = LatencyStats()
    inflight = 0
    response = nil
    responseIntent = nil
    lastError = nil
    scriptFinished = false
    requestsThisTurn = 0
    baselineFiredAt = nil
    ignorePartialsUntil = 0
    lastVoicedTime = 0
    pending = false
    rateLimitedUntil = 0

    let src: TranscriptSource
    switch mode {
    case .simulated:
      src = SimulatedMicSource()
      statusNote = "Simulated microphone: scripted transcript with realistic word timings"
    case .live:
      let live = LiveMicSource()
      statusNote =
        live.isOnDevice
        ? "Live microphone: on-device recognition"
        : "Live microphone: on-device recognition unavailable"
      src = live
    }
    src.onPartial = { [weak self] text in self?.handlePartial(text) }
    src.onLevel = { [weak self] level in self?.handleLevel(level) }
    src.onError = { [weak self] message in self?.lastError = message }
    src.onFinished = { [weak self] in self?.scriptFinished = true }
    source = src
    isRunning = true
    setPhase(.listening)
    src.start()
    ticker = Timer.scheduledTimer(withTimeInterval: 1 / 30, repeats: true) { [weak self] _ in
      Task { @MainActor in self?.tick() }
    }
  }

  func stopSession() {
    ticker?.invalidate()
    ticker = nil
    source?.stop()
    source = nil
    speaker.stop()
    isRunning = false
    phase = .idle
  }

  private func elapsed() -> TimeInterval { Date().timeIntervalSince(start) }

  private func setPhase(_ p: AssistantPhase) {
    phase = p
    source?.assistantPhaseChanged(p)
  }

  // MARK: Input

  private func handleLevel(_ level: Float) {
    guard isRunning else { return }
    let t = elapsed()
    levels.append(LevelSample(time: t, level: level))
    if level > Self.voicedLevel { lastVoicedTime = t }
  }

  private func handlePartial(_ text: String) {
    guard isRunning else { return }
    let t = elapsed()
    if t < ignorePartialsUntil { return }
    let merged = mergeWords(words, partial: text, now: t)
    guard merged != words else { return }
    let added = merged.count - words.count
    if added > 0 {
      wordHistory.append(contentsOf: merged.suffix(added))
    }
    words = merged
    latest = nil
    guard jevEnabled, !words.isEmpty else { return }
    let speaking = phase == .speaking ? response : nil
    let snapshot = TurnState.snapshot(words: words, now: t, assistantSpeaking: speaking)
    dispatch(snapshot)
  }

  private func dispatch(_ snapshot: TurnSnapshot) {
    if elapsed() < rateLimitedUntil { return }
    if inflight > 0 {
      pending = true
      return
    }
    seq += 1
    let mySeq = seq
    inflight += 1
    requestsThisTurn += 1
    Task { [weak self] in
      guard let self else { return }
      do {
        let result = try await self.client.evaluate(snapshot)
        self.receive(result, seq: mySeq, snapshot: snapshot)
      } catch {
        self.inflight -= 1
        self.stats.recordFailure()
        self.lastError = error.localizedDescription
        if case JevError.http(429, _) = error {
          self.rateLimitedUntil = self.elapsed() + SessionEngine.rateLimitBackoff
          self.pending = false
        }
      }
      self.drainPending()
    }
  }

  private func drainPending() {
    guard pending else { return }
    pending = false
    guard isRunning, jevEnabled, !words.isEmpty else { return }
    let speaking = phase == .speaking ? response : nil
    dispatch(TurnState.snapshot(words: words, now: elapsed(), assistantSpeaking: speaking))
  }

  private func receive(_ result: JevResult, seq mySeq: Int, snapshot: TurnSnapshot) {
    inflight -= 1
    let t = elapsed()
    stats.record(
      latencyMs: result.latencyMs, inputTokens: result.answers.inputTokens,
      outputTokens: result.answers.outputTokens, at: t)
    guard mySeq > appliedSeq else {
      stats.recordStale()
      return
    }
    appliedSeq = mySeq
    let a = result.answers
    let sample = DecisionSample(
      seq: mySeq, time: t, turnComplete: a.turnComplete, intent: a.intent,
      intentConfidence: a.intentConfidence, bargeIn: a.bargeIn, latencyMs: result.latencyMs,
      inputTokens: a.inputTokens)
    samples.append(sample)
    guard snapshot.transcript == transcript, isRunning else { return }
    latest = sample
    latestAnswers = a
    if phase == .speaking, policy.isBargeIn(sample) {
      handleBargeIn(sample)
    }
  }

  // MARK: Policy

  private func tick() {
    guard isRunning else { return }
    now = elapsed()
    trimHistory()
    guard !words.isEmpty else { return }
    let pause = msSinceLastWord
    if baselineFiredAt == nil, pause >= policy.silenceTimeoutMs {
      baselineFiredAt = now
      markers.append(TimelineMarker(time: now, kind: .baselineWouldFire))
    }
    let verdict = policy.verdict(
      latest: jevEnabled ? latest : nil, msSinceLastWord: pause, hasWords: true)
    if case .fire(let source) = verdict {
      fire(source)
    }
  }

  private func fire(_ fireSource: FireSource) {
    guard let first = words.first, let last = words.last else { return }
    let t = now
    let answers = jevEnabled ? latestAnswers : nil
    let intent = answers?.intent ?? .incomplete
    let slot = answers.flatMap { ResponseComposer.slot(for: intent, answers: $0) }
    let reply =
      answers == nil
      ? "Okay, on it."
      : ResponseComposer.response(intent: intent, slot: slot, transcript: transcript)
    let perfectBaseline = policy.baselineFireTime(lastWordTime: last.time)
    let cutOffEarly = (baselineFiredAt ?? .infinity) < last.time
    let recordedSource: FireSource = jevEnabled ? fireSource : .silenceBaseline
    turns.append(
      TurnRecord(
        index: turns.count + 1, transcript: transcript, intent: intent, slot: slot, response: reply,
        firstWordTime: first.time, lastWordTime: last.time, fireTime: t, fireSource: recordedSource,
        baselineFireTime: perfectBaseline, fireProbability: latest?.turnComplete ?? 0,
        requests: requestsThisTurn, baselineCutOffEarly: cutOffEarly))
    if recordedSource != .jev,
      let dup = markers.lastIndex(where: { $0.kind == .baselineWouldFire && $0.time == t })
    {
      markers.remove(at: dup)
    }
    markers.append(TimelineMarker(time: t, kind: .fired(recordedSource)))
    if baselineFiredAt == nil {
      markers.append(TimelineMarker(time: perfectBaseline, kind: .baselineWouldFire))
    }
    response = reply
    responseIntent = intent
    words = []
    latest = nil
    latestAnswers = nil
    requestsThisTurn = 0
    baselineFiredAt = nil
    source?.resetUtterance()
    setPhase(.speaking)
    speaker.speak(reply)
  }

  private func handleBargeIn(_ sample: DecisionSample) {
    speaker.stop()
    markers.append(TimelineMarker(time: now, kind: .bargeIn))
    if let i = turns.indices.last { turns[i].bargedIn = true }
    setPhase(.listening)
    let carriesRequest =
      sample.intent != .incomplete && sample.intent != .chitChat
      && sample.turnComplete >= policy.fireThreshold
    if carriesRequest {
      fire(.jev)
    } else {
      words = []
      latest = nil
      latestAnswers = nil
      requestsThisTurn = 0
      baselineFiredAt = nil
      source?.resetUtterance()
      ignorePartialsUntil = elapsed() + 0.7
    }
  }

  private func trimHistory() {
    let cutoff = now - SessionEngine.historyWindow
    if let firstKept = levels.firstIndex(where: { $0.time >= cutoff }), firstKept > 0 {
      levels.removeFirst(firstKept)
    }
    samples.removeAll { $0.time < cutoff }
    markers.removeAll { $0.time < cutoff }
    wordHistory.removeAll { $0.time < cutoff }
  }
}
