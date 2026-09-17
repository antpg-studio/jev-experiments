import XCTest

@testable import JevVoiceTurn

final class TurnStateTests: XCTestCase {
  private func words(_ text: String, spacing: TimeInterval = 0.3) -> [TranscriptWord] {
    text.split(separator: " ").enumerated().map {
      TranscriptWord(text: String($0.element), time: Double($0.offset) * spacing)
    }
  }

  func testSnapshotCarriesTranscriptPauseAndCandidates() {
    let w = words("set a timer for ten minutes")
    let snap = TurnState.snapshot(words: w, now: 1.5 + 0.42, assistantSpeaking: nil)
    XCTAssertEqual(snap.transcript, "set a timer for ten minutes")
    XCTAssertEqual(snap.wordCount, 6)
    XCTAssertEqual(snap.msSinceLastWord, 420)
    XCTAssertEqual(snap.durationCandidates, ["ten minutes"])
    XCTAssertTrue(snap.roomCandidates.isEmpty)
    XCTAssertNil(snap.assistantSpeaking)
  }

  func testStateOmitsAssistantTextWhileListening() {
    let snap = TurnState.snapshot(words: words("hello"), now: 0.2, assistantSpeaking: nil)
    let state = TurnState.state(snap)
    XCTAssertEqual(state["assistant_state"] as? String, "listening")
    XCTAssertNil(state["assistant_is_saying"])
    XCTAssertEqual(state["transcript_so_far"] as? String, "hello")
    XCTAssertEqual(state["ms_since_last_word"] as? Int, 200)
  }

  func testQuestionsAreSpeculativeFanOut() {
    let snap = TurnState.snapshot(
      words: words("turn off the lights in the kitchen"), now: 3, assistantSpeaking: "Okay.")
    let q = TurnState.questions(snap)
    XCTAssertNotNil(q["turn_complete"])
    XCTAssertNotNil(q["intent"])
    XCTAssertNotNil(q["is_barge_in"], "barge-in is asked only while the assistant speaks")
    XCTAssertNotNil(q["room"])
    XCTAssertNil(q["timer_duration"], "no duration candidates, no duration question")
    let room = q["room"] as? [String: Any]
    let criteria = room?["criteria"] as? [String: Any]
    XCTAssertEqual(Set(criteria?.keys.map { $0 } ?? []), ["kitchen", "none"])
    let intent = q["intent"] as? [String: Any]
    let intentCriteria = intent?["criteria"] as? [String: String]
    XCTAssertEqual(intentCriteria?.count, Intent.allCases.count)
  }

  func testNoBargeInQuestionWhenListening() {
    let snap = TurnState.snapshot(words: words("play some jazz"), now: 1, assistantSpeaking: nil)
    XCTAssertNil(TurnState.questions(snap)["is_barge_in"])
  }

  func testRequestBodySerializes() throws {
    let snap = TurnState.snapshot(
      words: words("text mom I'll be late"), now: 2, assistantSpeaking: nil)
    let body = TurnState.requestBody(snap)
    XCTAssertEqual(body["model"] as? String, "jev-latest")
    let data = try JSONSerialization.data(withJSONObject: body)
    XCTAssertGreaterThan(data.count, 100)
    let q = body["questions"] as? [String: Any]
    XCTAssertNotNil(q?["contact"])
  }

  func testMergeWordsKeepsOriginalTimesAndAppendsNew() {
    let existing = [TranscriptWord(text: "set", time: 1.0), TranscriptWord(text: "a", time: 1.3)]
    let merged = mergeWords(existing, partial: "set a timer", now: 1.7)
    XCTAssertEqual(merged.map(\.text), ["set", "a", "timer"])
    XCTAssertEqual(merged.map(\.time), [1.0, 1.3, 1.7])
  }

  func testMergeWordsAppliesRecognizerRevisions() {
    let existing = [TranscriptWord(text: "said", time: 1.0), TranscriptWord(text: "a", time: 1.3)]
    let merged = mergeWords(existing, partial: "set a timer", now: 1.7)
    XCTAssertEqual(merged[0].text, "set")
    XCTAssertEqual(merged[0].time, 1.0)
  }

  func testMergeWordsShrinksWhenRecognizerDropsWords() {
    let existing = [TranscriptWord(text: "a", time: 1), TranscriptWord(text: "b", time: 2)]
    XCTAssertEqual(mergeWords(existing, partial: "a", now: 3).count, 1)
    XCTAssertEqual(mergeWords(existing, partial: "", now: 3).count, 0)
  }
}

final class CandidateExtractorTests: XCTestCase {
  func testDurations() {
    XCTAssertEqual(CandidateExtractor.durations(in: "set a timer for ten minutes"), ["ten minutes"])
    XCTAssertEqual(CandidateExtractor.durations(in: "timer for 45 seconds please"), ["45 seconds"])
    XCTAssertEqual(
      CandidateExtractor.durations(in: "set a timer for forty five minutes"), ["forty five minutes"]
    )
    XCTAssertEqual(CandidateExtractor.durations(in: "an hour and a half"), ["an hour"])
    XCTAssertEqual(CandidateExtractor.durations(in: "set a timer for"), [])
  }

  func testRooms() {
    XCTAssertEqual(CandidateExtractor.rooms(in: "turn on the Living Room lights"), ["living room"])
    XCTAssertEqual(CandidateExtractor.rooms(in: "lights off"), [])
  }

  func testContacts() {
    XCTAssertEqual(CandidateExtractor.contacts(in: "text mom I'll be late"), ["mom"])
    XCTAssertEqual(CandidateExtractor.contacts(in: "send a message to Sarah saying hi"), ["sarah"])
    XCTAssertEqual(CandidateExtractor.contacts(in: "text me the address"), [])
  }
}
