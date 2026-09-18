import Foundation

public struct JevResult {
  public var judgment: Judgment
  public var latencyMs: Double
}

public enum JevError: Error, CustomStringConvertible {
  case missingAPIKey
  case deadlineExceeded(Double)
  case transport(String)
  case httpStatus(Int, String)
  case parse(String)

  public var description: String {
    switch self {
    case .missingAPIKey: return "OPENROUTER_API_KEY is not set"
    case .deadlineExceeded(let ms): return "deadline exceeded (\(Int(ms))ms)"
    case .transport(let m): return "transport: \(m)"
    case .httpStatus(let code, _):
      return code == 429 ? "http 429 rate limited" : "http \(code)"
    case .parse(let m): return "parse: \(m)"
    }
  }
}

/// One synchronous, deadline-bounded POST to Jev. The CLI is one process per command,
/// so there is no connection reuse; the deadline covers DNS + TLS + inference.
public final class JevClient {
  public static let endpoint = URL(string: "https://openrouter.ai/api/alpha/decisions")!

  let apiKey: String
  let session: URLSession

  public init(apiKey: String? = ProcessInfo.processInfo.environment["OPENROUTER_API_KEY"]) throws {
    guard let key = apiKey, !key.isEmpty else { throw JevError.missingAPIKey }
    self.apiKey = key
    let cfg = URLSessionConfiguration.ephemeral
    cfg.timeoutIntervalForRequest = 5
    cfg.httpAdditionalHeaders = ["Accept": "application/json"]
    self.session = URLSession(configuration: cfg)
  }

  public func requestBody(for state: CommandState) throws -> Data {
    try JSONSerialization.data(withJSONObject: Questions.request(state: state))
  }

  public func judge(_ state: CommandState, deadlineMs: Int) -> Result<JevResult, JevError> {
    let body: Data
    do {
      body = try requestBody(for: state)
    } catch {
      return .failure(.parse("encode: \(error)"))
    }
    var req = URLRequest(url: JevClient.endpoint)
    req.httpMethod = "POST"
    req.httpBody = body
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

    let start = DispatchTime.now()
    let semaphore = DispatchSemaphore(value: 0)
    var outcome: Result<JevResult, JevError> = .failure(.transport("no response"))
    let task = session.dataTask(with: req) { data, response, error in
      defer { semaphore.signal() }
      let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e6
      if let error = error {
        outcome = .failure(.transport(error.localizedDescription))
        return
      }
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      let data = data ?? Data()
      guard (200..<300).contains(status) else {
        outcome = .failure(.httpStatus(status, String(decoding: data, as: UTF8.self)))
        return
      }
      do {
        outcome = .success(JevResult(judgment: try Judgment.parse(data), latencyMs: elapsed))
      } catch {
        outcome = .failure(.parse("\(error)"))
      }
    }
    task.resume()
    if semaphore.wait(timeout: .now() + .milliseconds(deadlineMs)) == .timedOut {
      task.cancel()
      return .failure(.deadlineExceeded(Double(deadlineMs)))
    }
    return outcome
  }
}
