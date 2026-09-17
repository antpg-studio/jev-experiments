import XCTest

@testable import JevVoiceTurn

final class TurnPolicyTests: XCTestCase {
  private func sample(_ p: Double, barge: Double? = nil) -> DecisionSample {
    DecisionSample(
      seq: 1, time: 1, turnComplete: p, intent: .setTimer, intentConfidence: 0.9, bargeIn: barge,
      latencyMs: 120, inputTokens: 680)
  }

  func testWaitsWithoutWords() {
    XCTAssertEqual(
      TurnPolicy().verdict(latest: sample(0.99), msSinceLastWord: 5000, hasWords: false), .wait)
  }

  func testFiresOnConfidentAnswerAfterMinPause() {
    let p = TurnPolicy(fireThreshold: 0.85, minPauseMs: 250)
    XCTAssertEqual(p.verdict(latest: sample(0.91), msSinceLastWord: 100, hasWords: true), .wait)
    XCTAssertEqual(
      p.verdict(latest: sample(0.91), msSinceLastWord: 260, hasWords: true), .fire(.jev))
    XCTAssertEqual(p.verdict(latest: sample(0.84), msSinceLastWord: 600, hasWords: true), .wait)
  }

  func testFallsBackToSilenceTimeout() {
    let p = TurnPolicy(silenceTimeoutMs: 1000)
    // Unsure (between incomplete and fire thresholds): plain silence timeout.
    XCTAssertEqual(p.verdict(latest: sample(0.7), msSinceLastWord: 999, hasWords: true), .wait)
    XCTAssertEqual(
      p.verdict(latest: sample(0.7), msSinceLastWord: 1000, hasWords: true), .fire(.silenceFallback)
    )
    // No answer at all (network slow/failed): plain silence timeout.
    XCTAssertEqual(
      p.verdict(latest: nil, msSinceLastWord: 1200, hasWords: true), .fire(.silenceFallback))
  }

  func testWaitsThroughHesitationWhenJevSaysIncomplete() {
    let p = TurnPolicy(silenceTimeoutMs: 1000)
    XCTAssertEqual(p.patientTimeoutMs, 2500)
    XCTAssertEqual(p.verdict(latest: sample(0.05), msSinceLastWord: 1000, hasWords: true), .wait)
    XCTAssertEqual(p.verdict(latest: sample(0.05), msSinceLastWord: 2499, hasWords: true), .wait)
    XCTAssertEqual(
      p.verdict(latest: sample(0.05), msSinceLastWord: 2500, hasWords: true),
      .fire(.silenceFallback)
    )
  }

  func testThresholdIsAdjustable() {
    let p = TurnPolicy(fireThreshold: 0.6, minPauseMs: 0)
    XCTAssertEqual(p.verdict(latest: sample(0.61), msSinceLastWord: 0, hasWords: true), .fire(.jev))
  }

  func testBargeIn() {
    let p = TurnPolicy(bargeInThreshold: 0.8)
    XCTAssertTrue(p.isBargeIn(sample(0.1, barge: 0.95)))
    XCTAssertFalse(p.isBargeIn(sample(0.1, barge: 0.5)))
    XCTAssertFalse(p.isBargeIn(sample(0.99, barge: nil)))
    XCTAssertFalse(p.isBargeIn(nil))
  }

  func testBaselineFireTime() {
    XCTAssertEqual(
      TurnPolicy(silenceTimeoutMs: 1000).baselineFireTime(lastWordTime: 4.2), 5.2, accuracy: 1e-9)
  }
}

final class ResponseComposerTests: XCTestCase {
  func testSlotSelectionFollowsIntent() {
    let a = JevAnswers(
      model: "jev", turnComplete: 0.9, intent: .setTimer, intentConfidence: 0.9, bargeIn: nil,
      timerDuration: "ten minutes", room: "kitchen", contact: nil, inputTokens: 1, outputTokens: 1)
    XCTAssertEqual(ResponseComposer.slot(for: .setTimer, answers: a), "ten minutes")
    XCTAssertEqual(ResponseComposer.slot(for: .lights, answers: a), "kitchen")
    XCTAssertNil(ResponseComposer.slot(for: .weather, answers: a))
  }

  func testResponses() {
    XCTAssertEqual(
      ResponseComposer.response(intent: .setTimer, slot: "ten minutes", transcript: ""),
      "Timer set for ten minutes.")
    XCTAssertEqual(
      ResponseComposer.response(
        intent: .lights, slot: "kitchen", transcript: "turn off the lights in the kitchen"),
      "Turning the kitchen lights off.")
    XCTAssertEqual(
      ResponseComposer.response(intent: .sendMessage, slot: "mom", transcript: ""),
      "Sending your message to Mom.")
  }
}

final class TimelineMathTests: XCTestCase {
  func testXMapping() {
    XCTAssertEqual(TimelineMath.x(for: 10, windowEnd: 10, windowSeconds: 10, width: 500), 500)
    XCTAssertEqual(TimelineMath.x(for: 0, windowEnd: 10, windowSeconds: 10, width: 500), 0)
    XCTAssertEqual(TimelineMath.x(for: 5, windowEnd: 10, windowSeconds: 10, width: 500), 250)
    XCTAssertTrue(TimelineMath.isVisible(5, windowEnd: 10, windowSeconds: 10))
    XCTAssertFalse(TimelineMath.isVisible(-1, windowEnd: 10, windowSeconds: 10))
  }

  func testProbabilityPathIsStepFunction() {
    let pts = TimelineMath.probabilityPath(samples: [(1, 0.1), (2, 0.9)], until: 3)
    XCTAssertEqual(pts.map(\.time), [1, 2, 2, 3])
    XCTAssertEqual(pts.map(\.value), [0.1, 0.1, 0.9, 0.9])
    XCTAssertTrue(TimelineMath.probabilityPath(samples: [], until: 3).isEmpty)
  }

  func testComparisonAggregates() {
    let turns = [
      TurnRecord(
        index: 1, transcript: "a", intent: .weather, slot: nil, response: "", firstWordTime: 0,
        lastWordTime: 2.0, fireTime: 2.3, fireSource: .jev, baselineFireTime: 3.0,
        fireProbability: 0.9,
        requests: 4),
      TurnRecord(
        index: 2, transcript: "b", intent: .question, slot: nil, response: "", firstWordTime: 5,
        lastWordTime: 6.0, fireTime: 7.0, fireSource: .silenceFallback, baselineFireTime: 7.0,
        fireProbability: 0.4, requests: 3, bargedIn: true),
    ]
    let c = TimelineMath.comparison(turns)
    XCTAssertEqual(c.turns, 2)
    XCTAssertEqual(c.jevFires, 1)
    XCTAssertEqual(c.fallbackFires, 1)
    XCTAssertEqual(c.meanJevDelayMs, 650, accuracy: 1e-6)
    XCTAssertEqual(c.meanBaselineDelayMs, 1000, accuracy: 1e-6)
    XCTAssertEqual(c.meanSavedMs, 350, accuracy: 1e-6)
    XCTAssertEqual(c.totalSavedMs, 700, accuracy: 1e-6)
    XCTAssertEqual(c.bargeIns, 1)
    XCTAssertEqual(turns[0].savedMs, 700, accuracy: 1e-6)
  }

  func testEmptyComparison() {
    XCTAssertEqual(TimelineMath.comparison([]).turns, 0)
    XCTAssertEqual(TimelineMath.comparison([]).meanSavedMs, 0)
  }

  func testFormatting() {
    XCTAssertEqual(TimelineMath.formatMs(nil), "--")
    XCTAssertEqual(TimelineMath.formatMs(123.4), "123 ms")
    XCTAssertEqual(TimelineMath.formatSeconds(2500), "2.50 s")
    XCTAssertEqual(TimelineMath.formatUSD(0.0000288), "$0.00003")
    XCTAssertEqual(TimelineMath.formatUSD(1.2345), "$1.234")
  }
}

final class LatencyStatsTests: XCTestCase {
  func testPercentilesAndTokens() {
    var s = LatencyStats()
    for (i, l) in [100.0, 200, 300, 400, 500].enumerated() {
      s.record(latencyMs: l, inputTokens: 680, outputTokens: 10, at: Double(i))
    }
    XCTAssertEqual(s.last, 500)
    XCTAssertEqual(s.p50, 300)
    XCTAssertEqual(s.p95!, 480, accuracy: 1e-9)
    XCTAssertEqual(s.mean, 300)
    XCTAssertEqual(s.requestCount, 5)
    XCTAssertEqual(s.inputTokens, 3400)
    XCTAssertEqual(s.tokensPerDecision, 680)
    XCTAssertEqual(s.costUSD, 3400 * 0.042 / 1_000_000, accuracy: 1e-12)
    XCTAssertEqual(s.costPerThousandDecisionsUSD, 680 * 1000 * 0.042 / 1_000_000, accuracy: 1e-12)
  }

  func testEmptyStats() {
    let s = LatencyStats()
    XCTAssertNil(s.p50)
    XCTAssertNil(s.p95)
    XCTAssertEqual(s.decisionsPerSecond(now: 10), 0)
    XCTAssertEqual(s.tokensPerDecision, 0)
  }

  func testDecisionsPerSecondUsesTrailingWindow() {
    var s = LatencyStats()
    for t in stride(from: 0.0, through: 9.5, by: 0.5) {
      s.record(latencyMs: 100, inputTokens: 1, outputTokens: 0, at: t)
    }
    XCTAssertEqual(s.decisionsPerSecond(now: 10, window: 5), 2, accuracy: 1e-9)
    XCTAssertEqual(s.decisionsPerSecond(now: 100, window: 5), 0)
  }

  func testFailuresAndStale() {
    var s = LatencyStats()
    s.recordFailure()
    s.recordStale()
    s.recordStale()
    XCTAssertEqual(s.failureCount, 1)
    XCTAssertEqual(s.staleCount, 2)
    XCTAssertEqual(s.requestCount, 0)
  }
}

final class JevAnswersTests: XCTestCase {
  func testParsesFullResponse() throws {
    let json = """
      {"model":"jev-1.2","answers":{
        "turn_complete":{"type":"noul","noul":0.91},
        "intent":{"type":"choice","choice":"set_timer","confidence":0.88,"probabilities":{"set_timer":0.9}},
        "is_barge_in":{"type":"noul","noul":0.04},
        "timer_duration":{"type":"choice","choice":"ten minutes","confidence":0.97,"probabilities":{}},
        "room":{"type":"choice","choice":"none","confidence":0.7,"probabilities":{}}
      },"usage":{"input_tokens":685,"output_tokens":12}}
      """
    let a = try JevAnswers.parse(Data(json.utf8))
    XCTAssertEqual(a.model, "jev-1.2")
    XCTAssertEqual(a.turnComplete, 0.91)
    XCTAssertEqual(a.intent, .setTimer)
    XCTAssertEqual(a.intentConfidence, 0.88)
    XCTAssertEqual(a.bargeIn, 0.04)
    XCTAssertEqual(a.timerDuration, "ten minutes")
    XCTAssertNil(a.room, "`none` maps to no slot")
    XCTAssertNil(a.contact)
    XCTAssertEqual(a.inputTokens, 685)
    XCTAssertEqual(a.outputTokens, 12)
  }

  func testUnknownIntentFallsBackToIncomplete() throws {
    let json = """
      {"answers":{"turn_complete":{"noul":0.2},"intent":{"choice":"mystery"}},"usage":{}}
      """
    let a = try JevAnswers.parse(Data(json.utf8))
    XCTAssertEqual(a.intent, .incomplete)
    XCTAssertNil(a.bargeIn)
  }

  func testMalformedThrows() {
    XCTAssertThrowsError(try JevAnswers.parse(Data("{}".utf8)))
    XCTAssertThrowsError(
      try JevAnswers.parse(Data("{\"answers\":{\"intent\":{\"choice\":\"weather\"}}}".utf8)))
  }
}

final class ScriptTests: XCTestCase {
  func testWordTimingsAreMonotonicAndRealistic() {
    let u = ScriptedUtterance.spoken("set a timer for ten minutes")
    let ends = u.wordEndOffsetsMs
    XCTAssertEqual(ends.count, 6)
    XCTAssertEqual(ends, ends.sorted())
    XCTAssertGreaterThan(ends.last!, 1200)
    XCTAssertLessThan(ends.last!, 3000)
  }

  func testHesitationInsertsLongPause() {
    let u = ScriptedUtterance.spoken("send a message to Sarah", pauseAfterWords: ["to": 1300])
    XCTAssertEqual(u.words[4].gapBeforeMs, 1300)
    XCTAssertEqual(u.words[1].gapBeforeMs, 70)
  }

  func testDemoScriptHasBargeInAndFiveOrMorePlainUtterances() {
    XCTAssertGreaterThanOrEqual(DemoScript.utterances.filter { !$0.bargeIn }.count, 5)
    XCTAssertEqual(DemoScript.utterances.filter(\.bargeIn).count, 1)
  }
}
