import SwiftUI

enum Theme {
  static let background = Color(red: 0.055, green: 0.06, blue: 0.075)
  static let surface = Color(red: 0.09, green: 0.10, blue: 0.125)
  static let border = Color.white.opacity(0.08)
  static let text = Color(red: 0.92, green: 0.93, blue: 0.95)
  static let dim = Color(red: 0.55, green: 0.58, blue: 0.65)
  static let accent = Color(red: 0.36, green: 0.85, blue: 1.0)
  static let ready = Color(red: 0.45, green: 0.95, blue: 0.55)
  static let warn = Color(red: 1.0, green: 0.68, blue: 0.3)
  static let danger = Color(red: 1.0, green: 0.42, blue: 0.42)
}

struct LauncherView: View {
  @ObservedObject var model: LauncherModel
  @FocusState private var focused: Bool

  var body: some View {
    VStack(spacing: 0) {
      header
      Divider().overlay(Theme.border)
      content
      Divider().overlay(Theme.border)
      StatsFooter(model: model)
    }
    .frame(width: LauncherPanelController.panelWidth, height: LauncherPanelController.panelHeight)
    .background(Theme.background)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(
        Theme.border, lineWidth: 1)
    )
    .preferredColorScheme(.dark)
    .onAppear { focused = true }
  }

  private var header: some View {
    HStack(spacing: 14) {
      Image(systemName: "bolt.fill")
        .font(.system(size: 22, weight: .semibold))
        .foregroundStyle(model.isReady ? Theme.ready : Theme.accent)
        .animation(.easeOut(duration: 0.15), value: model.isReady)
      TextField("Apps, files, settings, math…", text: $model.query)
        .textFieldStyle(.plain)
        .font(.system(size: 26, weight: .regular, design: .rounded))
        .foregroundStyle(Theme.text)
        .focused($focused)
      if model.inFlight > 0 {
        Circle().fill(Theme.accent).frame(width: 8, height: 8)
          .accessibilityLabel("Request in flight")
      }
      Picker("Mode", selection: $model.mode) {
        ForEach(RankingMode.allCases) { mode in
          Text(mode.rawValue).tag(mode)
        }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .frame(width: 210)
      .help(model.mode.help)
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 16)
  }

  @ViewBuilder
  private var content: some View {
    if model.query.trimmingCharacters(in: .whitespaces).isEmpty {
      EmptyHint(model: model)
    } else if model.hits.isEmpty {
      Text("Nothing in the local index matches yet.")
        .foregroundStyle(Theme.dim)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(spacing: 4) {
            ForEach(Array(model.hits.enumerated()), id: \.element.id) { index, hit in
              HitRow(
                hit: hit, index: index, selected: index == model.selection,
                ready: model.isReady && index == 0, showJev: model.mode != .fuzzyOnly,
                stale: !model.judgmentIsFresh && hit.jevProbability != nil,
                action: model.judgment?.action
              )
              .id(hit.id)
              .onTapGesture {
                model.selection = index
                model.executeSelection()
              }
            }
          }
          .padding(12)
        }
        .onChange(of: model.selection) { _, selection in
          if model.hits.indices.contains(selection) {
            proxy.scrollTo(model.hits[selection].id)
          }
        }
      }
    }
  }
}

struct HitRow: View {
  let hit: RankedHit
  let index: Int
  let selected: Bool
  let ready: Bool
  let showJev: Bool
  let stale: Bool
  let action: ActionKind?

  var body: some View {
    HStack(spacing: 14) {
      KindBadge(kind: hit.candidate.kind, highlighted: action == hit.candidate.kind && index == 0)
      VStack(alignment: .leading, spacing: 3) {
        Text(hit.candidate.title)
          .font(.system(size: ready ? 20 : 16, weight: .semibold, design: .rounded))
          .foregroundStyle(Theme.text)
          .lineLimit(1)
        Text(hit.candidate.subtitle)
          .font(.system(size: 12))
          .foregroundStyle(Theme.dim)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      if ready {
        Text("READY ↵")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .padding(.horizontal, 8).padding(.vertical, 4)
          .background(Theme.ready.opacity(0.18), in: Capsule())
          .foregroundStyle(Theme.ready)
      }
      ConfidenceBar(hit: hit, showJev: showJev, stale: stale)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, ready ? 14 : 9)
    .background(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(selected ? Theme.surface : Color.clear)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .strokeBorder(
          selected ? (ready ? Theme.ready.opacity(0.6) : Theme.accent.opacity(0.45)) : Color.clear,
          lineWidth: 1)
    )
    .opacity(ready && index > 0 ? 0.45 : 1)
    .animation(.easeOut(duration: 0.12), value: ready)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(hit.candidate.title), \(hit.candidate.kind.label)")
  }
}

struct KindBadge: View {
  let kind: ActionKind
  let highlighted: Bool

  var body: some View {
    Text(kind.label.uppercased())
      .font(.system(size: 10, weight: .bold, design: .monospaced))
      .foregroundStyle(highlighted ? Theme.background : Theme.dim)
      .frame(width: 62, height: 22)
      .background(
        RoundedRectangle(cornerRadius: 5).fill(highlighted ? Theme.accent : Theme.surface))
  }
}

struct ConfidenceBar: View {
  let hit: RankedHit
  let showJev: Bool
  let stale: Bool

  var body: some View {
    let hasJev = showJev && hit.jevProbability != nil
    let value = hasJev ? (hit.jevProbability ?? 0) : hit.fuzzy
    let label = hasJev ? "jev" : "fuzzy"
    VStack(alignment: .trailing, spacing: 3) {
      Text("\(Int((value * 100).rounded()))%")
        .font(.system(size: 15, weight: .bold, design: .monospaced))
        .foregroundStyle(showJev && !hasJev ? Theme.dim : Theme.text)
        .monospacedDigit()
      HStack(spacing: 6) {
        Text(label)
          .font(.system(size: 9, weight: .medium, design: .monospaced))
          .foregroundStyle(Theme.dim)
        GeometryReader { geometry in
          ZStack(alignment: .leading) {
            Capsule().fill(Theme.surface)
            Capsule()
              .fill(hasJev ? Theme.accent : Theme.warn)
              .frame(width: geometry.size.width * CGFloat(min(max(value, 0), 1)))
              .animation(.easeOut(duration: 0.15), value: value)
          }
        }
        .frame(width: 64, height: 5)
      }
    }
    .opacity(stale ? 0.5 : 1)
    .frame(width: 110)
  }
}

struct EmptyHint: View {
  @ObservedObject var model: LauncherModel
  private let examples = [
    "dark", "wifi off", "calc 15% of 240", "the pdf I just downloaded", "sleep",
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Try typing two or three characters of:")
        .foregroundStyle(Theme.dim)
        .font(.system(size: 13))
      ForEach(examples, id: \.self) { example in
        Text(example)
          .font(.system(size: 15, weight: .medium, design: .monospaced))
          .foregroundStyle(Theme.text)
      }
      Spacer()
      HStack {
        Text("\(model.indexSize) local candidates indexed")
        Spacer()
        if !model.hasAPIKey {
          Text("No TYPESAFE_API_KEY — Jev disabled").foregroundStyle(Theme.danger)
        } else if let status = model.status {
          Text(status)
        }
      }
      .font(.system(size: 11, design: .monospaced))
      .foregroundStyle(Theme.dim)
    }
    .padding(20)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct StatsFooter: View {
  @ObservedObject var model: LauncherModel

  var body: some View {
    TimelineView(.periodic(from: .now, by: 0.5)) { timeline in
      let now = timeline.date.timeIntervalSince1970
      let stats = model.stats
      HStack(spacing: 0) {
        Metric(title: "LAST", value: ms(stats.lastMs), tint: tint(stats.lastMs))
        Metric(title: "P50", value: ms(stats.p50Ms), tint: tint(stats.p50Ms))
        Metric(title: "P95", value: ms(stats.p95Ms), tint: tint(stats.p95Ms))
        Metric(title: "DEC/S", value: String(format: "%.1f", stats.decisionsPerSecond(now: now)))
        Metric(
          title: "REQS", value: "\(stats.requests)",
          detail: requestDetail(stats))
        Metric(
          title: "TOKENS", value: compact(stats.inputTokens + stats.outputTokens),
          detail: String(format: "%.0f/dec", stats.tokensPerDecision), width: 70)
        Metric(
          title: "EST. COST", value: String(format: "$%.5f", stats.estimatedCostUSD),
          detail: "$0.042/Mtok in", width: 100)
        Spacer(minLength: 0)
        VStack(alignment: .trailing, spacing: 3) {
          if let error = model.lastError {
            Text(error).foregroundStyle(Theme.danger).lineLimit(1)
          } else if let judgment = model.judgment, model.mode != .fuzzyOnly {
            Text("\(judgment.action.rawValue) · ready \(Int((judgment.ready * 100).rounded()))%")
              .foregroundStyle(model.judgmentIsFresh ? Theme.dim : Theme.dim.opacity(0.5))
          } else {
            Text(model.mode.help).foregroundStyle(Theme.dim)
          }
          Text("⌥Space · ↑↓ · ↵ · esc").foregroundStyle(Theme.dim.opacity(0.7))
        }
        .font(.system(size: 10, design: .monospaced))
        .lineLimit(1)
        .frame(maxWidth: 190, alignment: .trailing)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
    }
  }

  private func requestDetail(_ stats: LatencyStats) -> String? {
    var parts: [String] = []
    if stats.staleDiscarded > 0 { parts.append("\(stats.staleDiscarded) stale") }
    if stats.failures > 0 { parts.append("\(stats.failures) fail") }
    return parts.isEmpty ? nil : parts.joined(separator: " ")
  }

  private func ms(_ value: Double?) -> String {
    guard let value else { return "—" }
    return String(format: "%.0f", value)
  }

  private func tint(_ value: Double?) -> Color {
    guard let value else { return Theme.dim }
    if value < 250 { return Theme.ready }
    if value < 600 { return Theme.warn }
    return Theme.danger
  }

  private func compact(_ tokens: Int) -> String {
    if tokens >= 1_000_000 { return String(format: "%.2fM", Double(tokens) / 1_000_000) }
    if tokens >= 100_000 { return "\(tokens / 1000)k" }
    if tokens >= 10_000 { return String(format: "%.1fk", Double(tokens) / 1000) }
    return "\(tokens)"
  }
}

struct Metric: View {
  let title: String
  let value: String
  var detail: String? = nil
  var tint: Color = Theme.text
  var width: CGFloat = 58

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title)
        .font(.system(size: 9, weight: .semibold, design: .monospaced))
        .foregroundStyle(Theme.dim)
      Text(value)
        .font(.system(size: 20, weight: .bold, design: .monospaced))
        .foregroundStyle(tint)
        .monospacedDigit()
      Text(detail ?? " ")
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(Theme.dim.opacity(0.8))
    }
    .frame(width: width, alignment: .leading)
    .padding(.trailing, 6)
  }
}
