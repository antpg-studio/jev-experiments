import Foundation

/// Deterministic decision rules. Jev supplies probabilities; this decides when to act.
struct TurnPolicy: Equatable {
  /// Fire when Jev's `turn_complete` probability is at least this.
  var fireThreshold: Double = 0.85
  /// Stop the assistant's speech when `is_barge_in` is at least this.
  var bargeInThreshold: Double = 0.8
  /// Minimum pause after the last word before a confident Jev answer is acted on.
  /// This is the guard against the recognizer being one word behind the speaker.
  var minPauseMs: Double = 250
  /// The classic endpointer we compare against, and also our fallback if Jev never answers.
  var silenceTimeoutMs: Double = 1000
  /// Below this `turn_complete` probability Jev is saying "still mid-sentence": keep listening
  /// through the baseline timeout, up to the patient timeout (the hard stop so nothing stalls).
  /// Between the two thresholds Jev is unsure and the plain silence timeout applies.
  var incompleteThreshold: Double = 0.35
  var patientTimeoutMultiplier: Double = 2.5
  var patientTimeoutMs: Double { silenceTimeoutMs * patientTimeoutMultiplier }

  enum Verdict: Equatable {
    case wait
    case fire(FireSource)
  }

  /// `latest` is the most recent Jev answer for the *current* transcript (nil if none yet or stale).
  func verdict(latest: DecisionSample?, msSinceLastWord: Double, hasWords: Bool) -> Verdict {
    guard hasWords else { return .wait }
    guard let d = latest else {
      return msSinceLastWord >= silenceTimeoutMs ? .fire(.silenceFallback) : .wait
    }
    if d.turnComplete >= fireThreshold, msSinceLastWord >= minPauseMs { return .fire(.jev) }
    let timeout = d.turnComplete < incompleteThreshold ? patientTimeoutMs : silenceTimeoutMs
    return msSinceLastWord >= timeout ? .fire(.silenceFallback) : .wait
  }

  func isBargeIn(_ latest: DecisionSample?) -> Bool {
    guard let p = latest?.bargeIn else { return false }
    return p >= bargeInThreshold
  }

  /// When a fixed-silence endpointer would have fired for an utterance whose last word landed at `lastWordTime`.
  func baselineFireTime(lastWordTime: TimeInterval) -> TimeInterval {
    lastWordTime + silenceTimeoutMs / 1000
  }
}

/// Assembles the assistant's canned reply from the intent plus the slot Jev selected.
enum ResponseComposer {
  static func slot(for intent: Intent, answers: JevAnswers) -> String? {
    switch intent {
    case .setTimer: return answers.timerDuration
    case .lights: return answers.room
    case .sendMessage: return answers.contact
    default: return nil
    }
  }

  static func response(intent: Intent, slot: String?, transcript: String) -> String {
    switch intent {
    case .setTimer:
      return slot.map { "Timer set for \($0)." } ?? "Starting a timer."
    case .weather:
      return "It's 68 degrees and clear, with a high of 74 later today."
    case .playMusic:
      return "Playing that now."
    case .lights:
      let off = transcript.lowercased().contains("off")
      let verb = off ? "off" : "on"
      return slot.map { "Turning the \($0) lights \(verb)." } ?? "Turning the lights \(verb)."
    case .sendMessage:
      return slot.map { "Sending your message to \($0.capitalized)." } ?? "Sending your message."
    case .question:
      return "Here's what I found for that."
    case .chitChat:
      return "Happy to help. Anything else?"
    case .incomplete:
      return "Sorry, I didn't catch all of that."
    }
  }
}
