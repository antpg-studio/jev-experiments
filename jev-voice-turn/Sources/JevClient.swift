import Foundation

/// Decoded answers from one `/v1/systemone` call. Only fields the app uses.
struct JevAnswers: Equatable {
  var model: String
  var turnComplete: Double
  var intent: Intent
  var intentConfidence: Double
  var bargeIn: Double?
  var timerDuration: String?
  var room: String?
  var contact: String?
  var inputTokens: Int
  var outputTokens: Int

  static func parse(_ data: Data) throws -> JevAnswers {
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let answers = root["answers"] as? [String: Any]
    else { throw JevError.malformed("missing answers") }
    guard let tc = (answers["turn_complete"] as? [String: Any])?["noul"] as? Double else {
      throw JevError.malformed("missing turn_complete")
    }
    guard let intentAnswer = answers["intent"] as? [String: Any],
      let choice = intentAnswer["choice"] as? String
    else { throw JevError.malformed("missing intent") }
    let usage = root["usage"] as? [String: Any] ?? [:]
    return JevAnswers(
      model: root["model"] as? String ?? "jev",
      turnComplete: tc,
      intent: Intent(rawValue: choice) ?? .incomplete,
      intentConfidence: intentAnswer["confidence"] as? Double ?? 0,
      bargeIn: (answers["is_barge_in"] as? [String: Any])?["noul"] as? Double,
      timerDuration: selected(answers["timer_duration"]),
      room: selected(answers["room"]),
      contact: selected(answers["contact"]),
      inputTokens: usage["input_tokens"] as? Int ?? 0,
      outputTokens: usage["output_tokens"] as? Int ?? 0)
  }

  /// Returns the chosen candidate, or nil when Jev picked `none` or was not asked.
  private static func selected(_ answer: Any?) -> String? {
    guard let a = answer as? [String: Any], let choice = a["choice"] as? String, choice != "none"
    else { return nil }
    return choice
  }
}

enum JevError: Error, LocalizedError {
  case missingKey
  case http(Int, String)
  case malformed(String)

  var errorDescription: String? {
    switch self {
    case .missingKey: return "TYPESAFE_API_KEY is not set (env var or Settings)"
    case .http(let code, let body): return "HTTP \(code): \(body.prefix(120))"
    case .malformed(let what): return "Malformed response: \(what)"
    }
  }
}

struct JevResult {
  var answers: JevAnswers
  var latencyMs: Double
}

/// Thin URLSession client. No SDK: one POST per partial transcript, timed on the wall clock.
final class JevClient {
  static let endpoint = URL(string: "https://api.typesafe.ai/v1/systemone")!
  static let apiKeyDefaultsKey = "typesafeAPIKey"

  private let session: URLSession

  init() {
    let cfg = URLSessionConfiguration.ephemeral
    cfg.timeoutIntervalForRequest = 8
    cfg.httpMaximumConnectionsPerHost = 8
    session = URLSession(configuration: cfg)
  }

  static func apiKey() -> String? {
    if let env = ProcessInfo.processInfo.environment["TYPESAFE_API_KEY"], !env.isEmpty {
      return env
    }
    let stored = UserDefaults.standard.string(forKey: apiKeyDefaultsKey) ?? ""
    return stored.isEmpty ? nil : stored
  }

  func evaluate(_ snapshot: TurnSnapshot) async throws -> JevResult {
    guard let key = JevClient.apiKey() else { throw JevError.missingKey }
    var req = URLRequest(url: JevClient.endpoint)
    req.httpMethod = "POST"
    req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try JSONSerialization.data(withJSONObject: TurnState.requestBody(snapshot))
    let start = Date()
    let (data, response) = try await session.data(for: req)
    let latency = Date().timeIntervalSince(start) * 1000
    if let http = response as? HTTPURLResponse, http.statusCode != 200 {
      throw JevError.http(http.statusCode, String(decoding: data, as: UTF8.self))
    }
    return JevResult(answers: try JevAnswers.parse(data), latencyMs: latency)
  }
}
