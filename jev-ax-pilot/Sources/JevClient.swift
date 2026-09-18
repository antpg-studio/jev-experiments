import Foundation

/// Thin async client for TypeSafe System One. Every call carries a sequence number so the
/// pilot can discard answers that arrive after a newer step has already been decided.
final class JevClient {
  struct Result {
    var sequence: Int
    var response: Jev.Response
    var latencyMs: Double
  }

  enum ClientError: Error, LocalizedError {
    case missingKey
    case http(Int, String)

    var errorDescription: String? {
      switch self {
      case .missingKey: return "OPENROUTER_API_KEY is not set"
      case .http(let status, let body): return "HTTP \(status): \(body.prefix(200))"
      }
    }
  }

  static let endpoint = URL(string: "https://openrouter.ai/api/alpha/decisions")!
  static let defaultsKey = "openRouterAPIKey"

  private let session: URLSession
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(timeout: TimeInterval = 4) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.waitsForConnectivity = false
    session = URLSession(configuration: configuration)
  }

  /// Environment first, then the Settings field; never a literal in the source.
  static func apiKey() -> String? {
    if let key = ProcessInfo.processInfo.environment["OPENROUTER_API_KEY"], !key.isEmpty {
      return key
    }
    if let key = UserDefaults.standard.string(forKey: defaultsKey), !key.isEmpty { return key }
    return nil
  }

  func ask(state: JSONValue, questions: [String: Jev.Question], sequence: Int) async throws
    -> Result
  {
    guard let key = Self.apiKey() else { throw ClientError.missingKey }
    var request = URLRequest(url: Self.endpoint)
    request.httpMethod = "POST"
    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try encoder.encode(Jev.Request(state: state, questions: questions))
    let started = DispatchTime.now()
    let (data, urlResponse) = try await session.data(for: request)
    let latencyMs =
      Double(DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000
    if let http = urlResponse as? HTTPURLResponse, http.statusCode != 200 {
      throw ClientError.http(http.statusCode, String(decoding: data, as: UTF8.self))
    }
    let response = try decoder.decode(Jev.Response.self, from: data)
    return Result(sequence: sequence, response: response, latencyMs: latencyMs)
  }
}
