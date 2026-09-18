import Foundation

/// One row in the results list.
struct RankedHit: Identifiable, Equatable, Sendable {
  let candidate: Candidate
  let fuzzy: Double
  /// Jev's probability that this candidate is the intended target; nil when Jev did not answer.
  let jevProbability: Double?
  let score: Double
  var id: String { candidate.id }
}

/// Deterministic prefilter and ranking. Jev only ever sees the output of `prefilter`.
enum Ranker {
  static let prefilterLimit = 13
  static let minimumFuzzy = 0.15
  static let webSearchID = "web:search"
  static let calculationID = "calc:result"

  struct Prefiltered: Equatable, Sendable {
    let candidates: [Candidate]
    let fuzzy: [String: Double]
  }

  /// Fuzzy-scores the whole index and keeps the top-k, then appends synthetic candidates
  /// (a calculation when the query parses, and a web search for any non-empty query).
  static func prefilter(query: String, index: [Candidate]) -> Prefiltered {
    let trimmed = query.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return Prefiltered(candidates: [], fuzzy: [:]) }
    var scored: [(Candidate, Double)] = []
    scored.reserveCapacity(index.count)
    for candidate in index {
      let score = Fuzzy.score(query: trimmed, candidate: candidate)
      if score >= minimumFuzzy { scored.append((candidate, score)) }
    }
    scored.sort { lhs, rhs in
      if lhs.1 != rhs.1 { return lhs.1 > rhs.1 }
      return lhs.0.title < rhs.0.title
    }
    var candidates: [Candidate] = []
    var fuzzy: [String: Double] = [:]
    if let evaluation = Calculator.evaluate(trimmed) {
      let calc = Candidate(
        id: calculationID, title: "= \(evaluation.formatted)",
        subtitle: "\(evaluation.expression) · Enter copies the result", kind: .calculate,
        payload: .calculation(expression: evaluation.expression, result: evaluation.formatted))
      candidates.append(calc)
      fuzzy[calc.id] = 0.95
    }
    for (candidate, score) in scored.prefix(prefilterLimit) {
      candidates.append(candidate)
      fuzzy[candidate.id] = score
    }
    let web = Candidate(
      id: webSearchID, title: "Search the web for “\(trimmed)”",
      subtitle: "Opens your default browser", kind: .webSearch, payload: .webSearch(trimmed))
    candidates.append(web)
    fuzzy[web.id] = 0.1
    return Prefiltered(candidates: candidates, fuzzy: fuzzy)
  }

  static let targetWeight = 0.65
  static let actionWeight = 0.20
  static let fuzzyWeight = 0.15

  /// Merges fuzzy scores with Jev's judgment. With no judgment the order is pure fuzzy.
  static func rank(_ prefiltered: Prefiltered, judgment: JevJudgment?) -> [RankedHit] {
    var hits = prefiltered.candidates.map { candidate -> RankedHit in
      let fuzzy = prefiltered.fuzzy[candidate.id] ?? 0
      guard let judgment else {
        return RankedHit(candidate: candidate, fuzzy: fuzzy, jevProbability: nil, score: fuzzy)
      }
      let target = judgment.targetProbabilities[candidate.id] ?? 0
      let action = judgment.actionProbabilities[candidate.kind] ?? 0
      let score = targetWeight * target + actionWeight * action + fuzzyWeight * fuzzy
      return RankedHit(candidate: candidate, fuzzy: fuzzy, jevProbability: target, score: score)
    }
    hits.sort { lhs, rhs in
      if lhs.score != rhs.score { return lhs.score > rhs.score }
      return lhs.candidate.title < rhs.candidate.title
    }
    return hits
  }
}
