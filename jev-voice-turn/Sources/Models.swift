import Foundation

enum Intent: String, CaseIterable, Codable {
  case setTimer = "set_timer"
  case weather
  case playMusic = "play_music"
  case lights
  case sendMessage = "send_message"
  case question
  case chitChat = "chit_chat"
  case incomplete

  var label: String {
    switch self {
    case .setTimer: return "Set timer"
    case .weather: return "Weather"
    case .playMusic: return "Play music"
    case .lights: return "Lights"
    case .sendMessage: return "Send message"
    case .question: return "Question"
    case .chitChat: return "Chit-chat"
    case .incomplete: return "Incomplete"
    }
  }

  var rubric: String {
    switch self {
    case .setTimer: return "Start a timer, alarm or countdown for a duration"
    case .weather: return "Ask about weather, temperature or forecast"
    case .playMusic: return "Play a song, artist, genre or playlist"
    case .lights: return "Turn lights on/off, dim, or change their color"
    case .sendMessage: return "Send a text or message to a person"
    case .question: return "A general knowledge or factual question"
    case .chitChat: return "Greeting, small talk or thanks with no task"
    case .incomplete: return "Too little said so far to tell what the speaker wants"
    }
  }
}

enum AssistantPhase: Equatable {
  case idle
  case listening
  case speaking
}

/// A word as it arrived from the recognizer (or the simulated microphone).
struct TranscriptWord: Equatable {
  var text: String
  /// Seconds since the session started.
  var time: TimeInterval
}

/// Snapshot of what code sends to Jev for one partial-transcript update.
struct TurnSnapshot: Equatable {
  var transcript: String
  var msSinceLastWord: Int
  var wordCount: Int
  var assistantSpeaking: String?
  var durationCandidates: [String]
  var roomCandidates: [String]
  var contactCandidates: [String]
}

/// One Jev answer applied to the timeline.
struct DecisionSample: Equatable {
  var seq: Int
  var time: TimeInterval
  var turnComplete: Double
  var intent: Intent
  var intentConfidence: Double
  var bargeIn: Double?
  var latencyMs: Double
  var inputTokens: Int
}

enum FireSource: String {
  case jev = "Jev"
  case silenceFallback = "Silence fallback"
  case silenceBaseline = "Silence baseline"
}

/// A finished turn: what was said, when Jev fired, when the baseline would have fired.
struct TurnRecord: Identifiable, Equatable {
  let id = UUID()
  var index: Int
  var transcript: String
  var intent: Intent
  var slot: String?
  var response: String
  var firstWordTime: TimeInterval
  var lastWordTime: TimeInterval
  var fireTime: TimeInterval
  var fireSource: FireSource
  var baselineFireTime: TimeInterval
  var fireProbability: Double
  var requests: Int
  var bargedIn: Bool = false
  /// The silence baseline fired on a mid-sentence pause, before the speaker had finished.
  var baselineCutOffEarly: Bool = false

  /// Positive when Jev responded before the fixed-silence baseline would have.
  var savedMs: Double { (baselineFireTime - fireTime) * 1000 }
  var jevDelayMs: Double { (fireTime - lastWordTime) * 1000 }
  var baselineDelayMs: Double { (baselineFireTime - lastWordTime) * 1000 }
}

struct TimelineMarker: Equatable {
  enum Kind: Equatable {
    case fired(FireSource)
    case baselineWouldFire
    case bargeIn
  }
  var time: TimeInterval
  var kind: Kind
}
