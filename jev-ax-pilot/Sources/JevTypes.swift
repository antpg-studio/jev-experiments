import Foundation

/// Request/response shapes for `POST /v1/systemone`.
enum Jev {
  struct Question: Encodable, Equatable {
    var type: String
    var instructions: String
    var criteria: Criteria?

    static func choice(_ instructions: String, options: [(String, String)]) -> Question {
      Question(type: "choice", instructions: instructions, criteria: .options(options))
    }

    static func noul(_ instructions: String, yes: String, no: String) -> Question {
      Question(type: "noul", instructions: instructions, criteria: .yesNo(yes: yes, no: no))
    }
  }

  enum Criteria: Encodable, Equatable {
    case options([(String, String)])
    case yesNo(yes: String, no: String)

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: DynamicKey.self)
      switch self {
      case .options(let options):
        for (key, description) in options {
          try container.encode(description, forKey: DynamicKey(key))
        }
      case .yesNo(let yes, let no):
        try container.encode(yes, forKey: DynamicKey("true"))
        try container.encode(no, forKey: DynamicKey("false"))
      }
    }

    static func == (lhs: Criteria, rhs: Criteria) -> Bool {
      switch (lhs, rhs) {
      case (.options(let a), .options(let b)):
        return a.map(\.0) == b.map(\.0) && a.map(\.1) == b.map(\.1)
      case (.yesNo(let a1, let a2), .yesNo(let b1, let b2)):
        return a1 == b1 && a2 == b2
      default:
        return false
      }
    }
  }

  struct DynamicKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ string: String) { stringValue = string }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }

  struct Request: Encodable {
    var state: JSONValue
    var model = "jev-latest"
    var questions: [String: Question]
  }

  struct Answer: Decodable, Equatable {
    var type: String
    var choice: String?
    var confidence: Double?
    var probabilities: [String: Double]?
    var noul: Double?
  }

  struct Usage: Decodable, Equatable {
    var inputTokens: Int
    var outputTokens: Int

    enum CodingKeys: String, CodingKey {
      case inputTokens = "input_tokens"
      case outputTokens = "output_tokens"
    }
  }

  struct Response: Decodable, Equatable {
    var model: String
    var answers: [String: Answer]
    var usage: Usage
  }

  /// Published price for jev-1.13: charged per input token only.
  static let usdPerInputToken = 0.042 / 1_000_000
}

/// A minimal JSON value so state can be built and inspected without `Any`.
indirect enum JSONValue: Encodable, Equatable {
  case string(String)
  case int(Int)
  case double(Double)
  case bool(Bool)
  case null
  case array([JSONValue])
  case object([(String, JSONValue)])

  func encode(to encoder: Encoder) throws {
    switch self {
    case .string(let value):
      var container = encoder.singleValueContainer()
      try container.encode(value)
    case .int(let value):
      var container = encoder.singleValueContainer()
      try container.encode(value)
    case .double(let value):
      var container = encoder.singleValueContainer()
      try container.encode(value)
    case .bool(let value):
      var container = encoder.singleValueContainer()
      try container.encode(value)
    case .null:
      var container = encoder.singleValueContainer()
      try container.encodeNil()
    case .array(let values):
      var container = encoder.unkeyedContainer()
      for value in values { try container.encode(value) }
    case .object(let pairs):
      var container = encoder.container(keyedBy: Jev.DynamicKey.self)
      for (key, value) in pairs { try container.encode(value, forKey: Jev.DynamicKey(key)) }
    }
  }

  static func == (lhs: JSONValue, rhs: JSONValue) -> Bool {
    switch (lhs, rhs) {
    case (.string(let a), .string(let b)): return a == b
    case (.int(let a), .int(let b)): return a == b
    case (.double(let a), .double(let b)): return a == b
    case (.bool(let a), .bool(let b)): return a == b
    case (.null, .null): return true
    case (.array(let a), .array(let b)): return a == b
    case (.object(let a), .object(let b)):
      return a.count == b.count && zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
    default: return false
    }
  }

  subscript(key: String) -> JSONValue? {
    guard case .object(let pairs) = self else { return nil }
    return pairs.first { $0.0 == key }?.1
  }

  var stringValue: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  var arrayValue: [JSONValue]? {
    if case .array(let values) = self { return values }
    return nil
  }
}
