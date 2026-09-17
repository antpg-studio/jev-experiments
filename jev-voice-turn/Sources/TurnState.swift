import Foundation

/// Pure functions that turn a transcript into the `state` and `questions` sent to Jev.
/// Jev selects; code extracts candidates and copies the selected value.
enum TurnState {
  static let context =
    "Live partial speech-to-text transcript of a person talking to a voice assistant. "
    + "Words arrive as they are spoken; the transcript may be cut off mid-sentence."

  static func snapshot(
    words: [TranscriptWord], now: TimeInterval, assistantSpeaking: String?
  ) -> TurnSnapshot {
    let transcript = words.map(\.text).joined(separator: " ")
    let pause = words.last.map { max(0, now - $0.time) } ?? 0
    return TurnSnapshot(
      transcript: transcript,
      msSinceLastWord: Int((pause * 1000).rounded()),
      wordCount: words.count,
      assistantSpeaking: assistantSpeaking,
      durationCandidates: CandidateExtractor.durations(in: transcript),
      roomCandidates: CandidateExtractor.rooms(in: transcript),
      contactCandidates: CandidateExtractor.contacts(in: transcript))
  }

  static func state(_ s: TurnSnapshot) -> [String: Any] {
    var state: [String: Any] = [
      "context": context,
      "transcript_so_far": s.transcript,
      "ms_since_last_word": s.msSinceLastWord,
      "word_count": s.wordCount,
      "assistant_state": s.assistantSpeaking == nil ? "listening" : "speaking",
    ]
    if let speaking = s.assistantSpeaking {
      state["assistant_is_saying"] = speaking
    }
    return state
  }

  static func questions(_ s: TurnSnapshot) -> [String: Any] {
    var q: [String: Any] = [
      "turn_complete": [
        "type": "noul",
        "instructions":
          "Has the speaker finished saying a complete request, so that the assistant should "
          + "respond right now instead of waiting for more words? Judge from `transcript_so_far` "
          + "and the pause length `ms_since_last_word`.",
        "criteria": [
          "true":
            "The words form a complete, self-contained request or statement. Nothing essential "
            + "is missing; an assistant could act on it as-is.",
          "false":
            "The speaker is mid-sentence: the transcript ends on a dangling word (for, to, in, "
            + "the, and, a, of), names an action without its object, or is clearly about to add more.",
        ],
      ],
      "intent": [
        "type": "choice",
        "instructions":
          "What does the speaker want the assistant to do, based on `transcript_so_far`?",
        "criteria": Dictionary(
          uniqueKeysWithValues: Intent.allCases.map { ($0.rawValue, $0.rubric) }),
      ],
    ]
    if s.assistantSpeaking != nil {
      q["is_barge_in"] = [
        "type": "noul",
        "instructions":
          "The assistant is currently speaking the text in `assistant_is_saying`. Is the speaker "
          + "interrupting to make the assistant stop, be quiet, cancel, or change what it is doing?",
        "criteria": [
          "true":
            "Words like stop, wait, no, cancel, never mind, shut up, hold on, or a brand new "
            + "request that overrides the current response.",
          "false":
            "Silence, filler (uh, hmm), backchannel agreement (ok, yeah, thanks), or the speaker "
            + "echoing the assistant.",
        ],
      ]
    }
    if !s.durationCandidates.isEmpty {
      q["timer_duration"] = selectQuestion(
        "Which of these phrases from the transcript is the duration the speaker wants the timer set for?",
        candidates: s.durationCandidates, none: "None of them is the timer duration")
    }
    if !s.roomCandidates.isEmpty {
      q["room"] = selectQuestion(
        "Which room does the speaker want the lights command applied to?",
        candidates: s.roomCandidates, none: "No specific room")
    }
    if !s.contactCandidates.isEmpty {
      q["contact"] = selectQuestion(
        "Who does the speaker want to send the message to?",
        candidates: s.contactCandidates, none: "No recipient named")
    }
    return q
  }

  static func requestBody(_ s: TurnSnapshot) -> [String: Any] {
    ["state": state(s), "model": "jev-latest", "questions": questions(s)]
  }

  private static func selectQuestion(_ instructions: String, candidates: [String], none: String)
    -> [String: Any]
  {
    var criteria: [String: Any] = [:]
    for c in candidates { criteria[c] = NSNull() }
    criteria["none"] = none
    return ["type": "choice", "instructions": instructions, "criteria": criteria]
  }
}

/// Regex candidate extraction. Jev only ever picks from these; it never invents a value.
enum CandidateExtractor {
  static let numberWords =
    "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|"
    + "thirty|forty|forty-five|fifty|sixty|ninety|half an?|an?)"
  static let durationPattern =
    "\\b\(numberWords)(?:[\\s-]\(numberWords))?(?:\\s+and\\s+a\\s+half)?"
    + "\\s+(?:seconds?|minutes?|hours?|mins?|secs?)\\b"
  static let rooms = [
    "kitchen", "bedroom", "living room", "bathroom", "office", "garage", "hallway", "dining room",
    "basement", "nursery", "porch",
  ]
  static let contactPattern = "\\b(?:text|message|tell|call)\\s+(?:to\\s+)?([A-Za-z]+)\\b"

  static func durations(in text: String) -> [String] {
    matches(durationPattern, in: text, group: 0)
  }

  static func rooms(in text: String) -> [String] {
    let lower = text.lowercased()
    return rooms.filter { lower.contains($0) }
  }

  static func contacts(in text: String) -> [String] {
    matches(contactPattern, in: text, group: 1).filter {
      !["me", "them", "him", "her", "it", "the", "a", "to", "that"].contains($0.lowercased())
    }
  }

  private static func matches(_ pattern: String, in text: String, group: Int) -> [String] {
    guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
      return []
    }
    let ns = text as NSString
    var seen = Set<String>()
    var out: [String] = []
    for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
      let r = m.range(at: group)
      guard r.location != NSNotFound else { continue }
      let s = ns.substring(with: r).lowercased()
      if seen.insert(s).inserted { out.append(s) }
    }
    return out
  }
}
