import Foundation

/// One row in the results list.
struct RankedHit: Identifiable, Equatable, Sendable {
  let candidate: Candidate
  let fuzzy: Double
  /// Jev's probability that this candidate is the intended target; nil when Jev did not answer.
  let jevProbability: Double?
  /// Jev's probability that this candidate fits the description in the query on its own.
  let matchProbability: Double?
  /// True when the row belongs to the set the group row would open.
  let inSet: Bool
  let score: Double
  var id: String { candidate.id }

  var isGroup: Bool {
    if case .group = candidate.payload { return true }
    return false
  }
}

/// Deterministic prefilter and ranking. Jev only ever sees the output of `prefilter`.
enum Ranker {
  static let prefilterLimit = 13
  /// With a time window the query describes a period, so more rows are shown to Jev.
  static let windowedPrefilterLimit = 30
  static let minimumFuzzy = 0.15
  static let webSearchID = "web:search"
  static let calculationID = "calc:result"
  static let groupID = "group:all"

  /// Jev must lean at least this far toward "all" before the group row leads the list.
  static let setThreshold = 0.5
  /// A candidate is part of the set when Jev is at least this sure it fits the description.
  static let memberThreshold = 0.6
  /// With `one` intent, a group row is still offered (below the top hit) when this many rows fit.
  static let minimumSetSize = 2
  static let maximumSetSize = 25

  struct Prefiltered: Equatable, Sendable {
    let candidates: [Candidate]
    let fuzzy: [String: Double]
    let window: TimeWindow?

    init(candidates: [Candidate], fuzzy: [String: Double], window: TimeWindow? = nil) {
      self.candidates = candidates
      self.fuzzy = fuzzy
      self.window = window
    }
  }

  /// Fuzzy-scores the whole index and keeps the top-k, then appends synthetic candidates
  /// (a calculation when the query parses, and a web search for any non-empty query).
  /// A time window in the query is applied here, in code: items outside it are never sent.
  static func prefilter(query: String, index: [Candidate], now: Date = Date()) -> Prefiltered {
    let trimmed = query.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { return Prefiltered(candidates: [], fuzzy: [:]) }
    let window = TimeWindow.parse(trimmed, now: now)
    let matchQuery = window?.remainder.trimmingCharacters(in: .whitespaces) ?? trimmed
    // "everything from the past hour": nothing describable is left once stopwords go.
    let windowOnly =
      window != nil && Fuzzy.tokens(matchQuery).allSatisfy { Fuzzy.stopwords.contains($0) }
    let limit = window == nil ? prefilterLimit : windowedPrefilterLimit

    var scored: [(Candidate, Double)] = []
    scored.reserveCapacity(index.count)
    for candidate in index {
      if let window {
        // Timeless items (apps, toggles) stay eligible; dated items must fall in the window.
        if let age = candidate.ageDays, !window.contains(ageDays: age, now: now) { continue }
      }
      let score: Double
      if windowOnly {
        guard candidate.ageDays != nil else { continue }
        score = 0.5
      } else {
        score = Fuzzy.score(query: matchQuery, candidate: candidate)
      }
      if score >= minimumFuzzy { scored.append((candidate, score)) }
    }
    scored.sort { lhs, rhs in
      if lhs.1 != rhs.1 { return lhs.1 > rhs.1 }
      let lhsAge = lhs.0.ageDays ?? .infinity
      let rhsAge = rhs.0.ageDays ?? .infinity
      if lhsAge != rhsAge { return lhsAge < rhsAge }
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
    for (candidate, score) in scored.prefix(limit) {
      candidates.append(candidate)
      fuzzy[candidate.id] = score
    }
    let web = Candidate(
      id: webSearchID, title: "Search the web for “\(trimmed)”",
      subtitle: "Opens your default browser", kind: .webSearch, payload: .webSearch(trimmed))
    candidates.append(web)
    fuzzy[web.id] = 0.1
    return Prefiltered(candidates: candidates, fuzzy: fuzzy, window: window)
  }

  static let targetWeight = 0.65
  static let actionWeight = 0.20
  static let fuzzyWeight = 0.15

  /// Merges fuzzy scores with Jev's judgment. With no judgment the order is pure fuzzy.
  /// When Jev finds several rows that fit the description, a group row is added: on top when
  /// Jev reads the query as "all of them", otherwise just below the single best hit.
  static func rank(_ prefiltered: Prefiltered, judgment: JevJudgment?) -> [RankedHit] {
    let members = setMembers(prefiltered, judgment: judgment)
    var hits = prefiltered.candidates.map { candidate -> RankedHit in
      let fuzzy = prefiltered.fuzzy[candidate.id] ?? 0
      guard let judgment else {
        return RankedHit(
          candidate: candidate, fuzzy: fuzzy, jevProbability: nil, matchProbability: nil,
          inSet: false, score: fuzzy)
      }
      let target = judgment.targetProbabilities[candidate.id] ?? 0
      let action = judgment.actionProbabilities[candidate.kind] ?? 0
      let score = targetWeight * target + actionWeight * action + fuzzyWeight * fuzzy
      return RankedHit(
        candidate: candidate, fuzzy: fuzzy, jevProbability: target,
        matchProbability: judgment.matchProbabilities[candidate.id],
        inSet: members.contains(candidate.id), score: score)
    }
    hits.sort { lhs, rhs in
      if lhs.score != rhs.score { return lhs.score > rhs.score }
      return lhs.candidate.title < rhs.candidate.title
    }
    guard let judgment, members.count >= minimumSetSize else { return hits }
    let ordered = hits.filter { members.contains($0.candidate.id) }.map(\.candidate)
    let group = RankedHit(
      candidate: groupCandidate(ordered), fuzzy: 0, jevProbability: judgment.setProbability,
      matchProbability: nil, inSet: false, score: judgment.setProbability)
    if judgment.setProbability >= setThreshold {
      hits.insert(group, at: 0)
    } else {
      hits.insert(group, at: min(1, hits.count))
    }
    return hits
  }

  /// Candidate ids Jev judged to fit the description, best first, bounded in size.
  static func setMembers(_ prefiltered: Prefiltered, judgment: JevJudgment?) -> Set<String> {
    guard let judgment else { return [] }
    let eligible = prefiltered.candidates.filter { candidate in
      candidate.id != webSearchID && candidate.id != calculationID
        && (judgment.matchProbabilities[candidate.id] ?? 0) >= memberThreshold
    }
    let sorted = eligible.sorted {
      (judgment.matchProbabilities[$0.id] ?? 0) > (judgment.matchProbabilities[$1.id] ?? 0)
    }
    return Set(sorted.prefix(maximumSetSize).map(\.id))
  }

  static func groupCandidate(_ members: [Candidate]) -> Candidate {
    let kinds = Set(members.map(\.kind))
    let kind = kinds.count == 1 ? kinds.first! : .unclear
    let noun: String
    switch kind {
    case .openURL: noun = "links"
    case .openFile: noun = "files"
    case .openApp: noun = "apps"
    default: noun = "items"
    }
    let names = members.prefix(3).map(\.title).joined(separator: ", ")
    let more = members.count > 3 ? " and \(members.count - 3) more" : ""
    return Candidate(
      id: groupID, title: "Open all \(members.count) \(noun)",
      subtitle: names + more, kind: kind, payload: .group(members))
  }
}
