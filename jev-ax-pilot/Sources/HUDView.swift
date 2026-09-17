import SwiftUI

/// Floating always-on-top readout of what the pilot is doing and how fast Jev is answering.
struct HUDView: View {
  var pilot: Pilot
  @State private var tick = Date()
  private let clock = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      goalRow
      metricGrid
      decisionRow
      distribution
    }
    .padding(14)
    .frame(width: 420, alignment: .topLeading)
    .background(
      RoundedRectangle(cornerRadius: 14).fill(Theme.background.opacity(0.94))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.08)))
    )
    .foregroundStyle(Theme.text)
    .onReceive(clock) { tick = $0 }
  }

  private var goalRow: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack {
        Circle().fill(pilot.status.isActive ? Theme.accent : Theme.muted).frame(width: 8, height: 8)
        Text(pilot.goal.isEmpty ? "No goal" : pilot.goal).font(.system(size: 13, weight: .semibold))
          .lineLimit(2)
      }
      Text(statusLine).font(.system(size: 11)).foregroundStyle(Theme.muted)
    }
  }

  private var metricGrid: some View {
    let metrics = pilot.metrics
    _ = tick
    return Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
      GridRow {
        metric("STEP", "\(metrics.steps)", suffix: "/ \(Pilot.stepCap)")
        metric("LAST", ms(metrics.lastLatencyMs))
        metric("P50", ms(metrics.p50Ms))
        metric("P95", ms(metrics.p95Ms))
      }
      GridRow {
        metric("STEPS/S", String(format: "%.2f", metrics.stepsPerSecond))
        metric(
          "REQUESTS", "\(metrics.requests)",
          suffix: metrics.failures > 0 ? "\(metrics.failures) failed" : nil)
        metric("TOKENS", compact(metrics.totalTokens), suffix: "in \(compact(metrics.inputTokens))")
        metric("COST", String(format: "$%.4f", metrics.estimatedCostUSD))
      }
    }
  }

  private var decisionRow: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      if let decision = pilot.lastDecision {
        Text(decision.action.name.uppercased()).font(.system(size: 12, weight: .heavy))
          .foregroundStyle(
            decision.action.name == "blocked" ? Theme.warning : Theme.accent)
        Text(decision.action.target ?? "").font(.system(size: 12)).lineLimit(1)
        Spacer()
        Text(decision.source).font(.system(size: 10, weight: .medium))
          .padding(.horizontal, 6).padding(.vertical, 2)
          .background(
            Capsule().fill(
              decision.source == "jev" ? Theme.accent.opacity(0.2) : Theme.warning.opacity(0.2)))
      } else {
        Text("Waiting for first decision").font(.system(size: 12)).foregroundStyle(Theme.muted)
      }
    }
  }

  private var distribution: some View {
    let decision = pilot.lastDecision
    let rows = Array((decision?.probabilities ?? []).prefix(8))
    let labels = Dictionary(
      uniqueKeysWithValues: (pilot.lastTree?.elements ?? []).map { ($0.id, $0.summary) })
    return VStack(alignment: .leading, spacing: 3) {
      HStack {
        Text("next_element distribution").font(.system(size: 10, weight: .semibold))
          .foregroundStyle(Theme.muted)
        Spacer()
        if let decision {
          Text(
            String(
              format: "goal_reached %.2f · needs_text %.2f · destructive %.2f",
              decision.goalReached, decision.needsText,
              decision.isDestructive)
          )
          .font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.muted)
        }
      }
      if rows.isEmpty {
        Text(decision == nil ? "—" : "fallback decision: no distribution").font(.system(size: 11))
          .foregroundStyle(Theme.muted)
      }
      ForEach(rows, id: \.0) { key, probability in
        HStack(spacing: 6) {
          Text(key).font(.system(size: 11, design: .monospaced)).frame(
            width: 64, alignment: .leading)
          GeometryReader { geometry in
            ZStack(alignment: .leading) {
              RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.06))
              RoundedRectangle(cornerRadius: 3).fill(Theme.accent.opacity(0.85))
                .frame(width: max(2, geometry.size.width * probability))
            }
          }
          .frame(height: 10)
          Text(String(format: "%.2f", probability)).font(.system(size: 11, design: .monospaced))
            .frame(width: 34)
          Text(labels[key] ?? key).font(.system(size: 10)).foregroundStyle(Theme.muted).lineLimit(1)
            .frame(width: 130, alignment: .leading)
        }
      }
    }
  }

  private var statusLine: String {
    switch pilot.status {
    case .idle: return "idle · \(pilot.mode.rawValue)"
    case .launching(let app): return "launching \(app)"
    case .running:
      return "running · \(pilot.mode.rawValue) · \(pilot.lastTree?.elements.count ?? 0) elements"
    case .finished(let reason): return reason
    case .failed(let reason): return reason
    }
  }

  private func metric(_ label: String, _ value: String, suffix: String? = nil) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.muted)
      Text(value).font(.system(size: 20, weight: .bold, design: .rounded)).monospacedDigit()
      Text(suffix ?? " ").font(.system(size: 9)).foregroundStyle(Theme.muted)
    }
    .frame(minWidth: 84, alignment: .leading)
  }

  private func ms(_ value: Double?) -> String {
    guard let value else { return "—" }
    return String(format: "%.0f ms", value)
  }

  private func compact(_ value: Int) -> String {
    value >= 10_000 ? String(format: "%.1fk", Double(value) / 1000) : "\(value)"
  }
}
