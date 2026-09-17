import XCTest

@testable import JevShellGuard

final class PolicyTests: XCTestCase {
  func judgment(
    destructive: Double = 0.02, wrongTarget: Double = 0.03, typo: Double = 0.03,
    secret: Double = 0.02, verdict: String = "run", probs: [String: Double]? = nil
  ) -> Judgment {
    Judgment(
      nouls: [
        Questions.destructive: destructive, Questions.wrongTarget: wrongTarget,
        Questions.likelyTypo: typo, Questions.leaksSecret: secret,
      ],
      verdict: verdict,
      verdictProbabilities: probs
        ?? (verdict == "run" ? ["run": 0.9] : [verdict: 0.9, "run": 0.1]),
      verdictConfidence: 0.9)
  }

  func testCleanCommandRuns() {
    XCTAssertEqual(Policy.decide(judgment()), .run)
  }

  func testFlaggedNoulConfirmsSortedByValue() {
    let d = Policy.decide(judgment(destructive: 0.82, wrongTarget: 0.93, verdict: "confirm"))
    XCTAssertEqual(
      d,
      .confirm([
        Reason(id: Questions.wrongTarget, value: 0.93),
        Reason(id: Questions.destructive, value: 0.82),
      ]))
  }

  func testVerdictBlockEscalatesFlaggedToBlock() {
    let d = Policy.decide(
      judgment(
        destructive: 0.92, wrongTarget: 0.98, verdict: "block",
        probs: ["block": 0.99, "confirm": 0.01, "run": 0]))
    XCTAssertEqual(d.label, "block")
    XCTAssertEqual(d.reasons.map(\.id), [Questions.wrongTarget, Questions.destructive])
  }

  func testCatastrophicNoulsBlockEvenIfVerdictSaysConfirm() {
    let d = Policy.decide(judgment(destructive: 0.95, wrongTarget: 0.94, verdict: "confirm"))
    XCTAssertEqual(d.label, "block")
  }

  func testWeakBlockVerdictOnlyConfirms() {
    let d = Policy.decide(
      judgment(verdict: "block", probs: ["block": 0.5, "confirm": 0.4, "run": 0.1]))
    XCTAssertEqual(d, .run)
    let strong = Policy.decide(
      judgment(verdict: "block", probs: ["block": 0.7, "confirm": 0.2, "run": 0.1]))
    XCTAssertEqual(strong.label, "confirm")
    XCTAssertEqual(strong.reasons.first?.id, "verdict:block")
  }

  func testTypoAndSecretConfirm() {
    XCTAssertEqual(Policy.decide(judgment(typo: 0.94)).label, "confirm")
    XCTAssertEqual(Policy.decide(judgment(secret: 0.99)).label, "confirm")
    XCTAssertEqual(Policy.decide(judgment(typo: 0.5, secret: 0.5)), .run)
  }

  func testThresholdsAreConfigurable() {
    var config = Config.default
    config.thresholds[Questions.destructive] = 0.3
    XCTAssertEqual(Policy.decide(judgment(destructive: 0.31), config: config).label, "confirm")
    XCTAssertEqual(Policy.decide(judgment(destructive: 0.31)).label, "run")
  }

  func testConfigDecodesPartialJSON() throws {
    let json = #"{"deadline_ms": 250, "thresholds": {"likely_typo": 0.8}, "skip_tools": ["cd"]}"#
    let c = try JSONDecoder().decode(Config.self, from: Data(json.utf8))
    XCTAssertEqual(c.deadlineMs, 250)
    XCTAssertEqual(c.thresholds[Questions.likelyTypo], 0.8)
    XCTAssertEqual(c.thresholds[Questions.destructive], 0.70)
    XCTAssertEqual(c.skipTools, ["cd"])
    XCTAssertTrue(c.enabled)
  }

  func testParseFixtureResponse() throws {
    let body = """
      {"model":"jev-1.13.0","answers":{
        "destructive":{"type":"noul","noul":0.82},
        "wrong_target":{"type":"noul","noul":0.93},
        "likely_typo":{"type":"noul","noul":0.04},
        "leaks_secret":{"type":"noul","noul":0.03},
        "verdict":{"type":"choice","choice":"confirm","confidence":0.99,
          "probabilities":{"run":0.01,"confirm":0.99,"block":0.0}}},
       "usage":{"input_tokens":1077,"output_tokens":111}}
      """
    let j = try Judgment.parse(Data(body.utf8))
    XCTAssertEqual(j.nouls[Questions.destructive], 0.82)
    XCTAssertEqual(j.verdict, "confirm")
    XCTAssertEqual(j.verdictProbabilities["block"], 0.0)
    XCTAssertEqual(j.inputTokens, 1077)
    XCTAssertEqual(j.model, "jev-1.13.0")
    XCTAssertEqual(Policy.decide(j).label, "confirm")
  }

  func testParseRejectsMissingAnswer() {
    let body = #"{"model":"jev","answers":{"destructive":{"type":"noul","noul":0.1}}}"#
    XCTAssertThrowsError(try Judgment.parse(Data(body.utf8))) { error in
      XCTAssertEqual(error as? Judgment.ParseError, .missingAnswer(Questions.wrongTarget))
    }
  }

  func testFallbackDenyAndConfirm() {
    XCTAssertEqual(Fallback.decide("rm -rf ~/").label, "block")
    XCTAssertEqual(Fallback.decide("sudo rm -rf /").label, "block")
    XCTAssertEqual(Fallback.decide("rm -rf ~").label, "block")
    XCTAssertEqual(Fallback.decide("dd if=/dev/zero of=/dev/disk2").label, "block")
    XCTAssertEqual(Fallback.decide(":(){ :|:& };:").label, "block")
    XCTAssertEqual(Fallback.decide("rm -rf ./build").label, "confirm")
    XCTAssertEqual(Fallback.decide("git push --force origin main").label, "confirm")
    XCTAssertEqual(Fallback.decide("git reset --hard").label, "confirm")
    XCTAssertEqual(Fallback.decide("psql -c 'DROP TABLE users'").label, "confirm")
    XCTAssertEqual(
      Fallback.decide("curl -H 'Authorization: Bearer sk-live-9f8e7d6c5b4a3210' https://x").label,
      "confirm")
    XCTAssertEqual(Fallback.decide("gti status", toolFound: false).label, "confirm")
    XCTAssertEqual(Fallback.decide("git status", toolFound: true), .run)
    XCTAssertEqual(Fallback.decide("ls -la"), .run)
    XCTAssertEqual(Fallback.decide("npm test"), .run)
  }

  func testStatsSummary() {
    let records =
      (1...10).map {
        StatsRecord(
          ts: Double($0), ms: Double($0 * 10), inputTokens: 1000, decision: "run", offline: false)
      } + [StatsRecord(ts: 11, ms: 0, inputTokens: 0, decision: "confirm", offline: true)]
    let s = Stats.summarize(records)
    XCTAssertEqual(s.count, 11)
    XCTAssertEqual(s.online, 10)
    XCTAssertEqual(s.last, 100)
    XCTAssertEqual(s.p50, 55, accuracy: 0.001)
    XCTAssertEqual(s.p95, 95.5, accuracy: 0.001)
    XCTAssertEqual(s.meanTokens, 1000)
    XCTAssertEqual(s.costUSD, 10_000 * jevUSDPerInputToken, accuracy: 1e-12)
    XCTAssertEqual(s.decisionsPerSecond, 1000 / 55, accuracy: 0.001)
    XCTAssertEqual(s.decisions["confirm"], 1)
    XCTAssertEqual(Stats.percentile([], 50), 0)
  }

  func testBannerMentionsReasonsCommandAndLatency() {
    let text = Banner.confirm(
      command: "git push --force origin main",
      reasons: [Reason(id: "destructive", value: 0.93), Reason(id: "wrong_target", value: 0.71)],
      ms: 142, offline: false)
    XCTAssertTrue(text.contains("destructive 0.93 · wrong_target 0.71"))
    XCTAssertTrue(text.contains("`git push --force origin main`"))
    XCTAssertTrue(text.contains("[y/N]"))
    XCTAssertTrue(text.contains("jev 142ms"))
    XCTAssertTrue(
      Banner.block(command: "rm -rf ~/", reasons: [], ms: nil, offline: true).contains(
        "jev offline"))
  }
}
