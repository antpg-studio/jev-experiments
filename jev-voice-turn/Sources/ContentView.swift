import SwiftUI

struct ContentView: View {
  @EnvironmentObject var engine: SessionEngine

  var body: some View {
    VStack(spacing: 12) {
      header
      HStack(alignment: .top, spacing: 12) {
        VStack(spacing: 12) {
          transcriptPanel
          Panel(
            title: "Timeline",
            subtitle:
              "waveform · words as they arrive · turn_complete probability · when each endpointer fires"
          ) {
            TimelineView().frame(height: 210)
            legend
          }
          turnsPanel
        }
        VStack(spacing: 12) {
          latencyPanel
          comparisonPanel
          controlsPanel
        }
        .frame(width: 400)
      }
    }
    .padding(14)
    .background(Theme.background)
    .foregroundStyle(Theme.text)
  }

  // MARK: Header

  private var header: some View {
    HStack(spacing: 14) {
      VStack(alignment: .leading, spacing: 2) {
        Text("JEV VOICE TURN")
          .font(.system(size: 16, weight: .black))
          .tracking(2)
        Text("Instant turn-taking and barge-in · Jev endpointing vs fixed-silence timeout")
          .font(.system(size: 11))
          .foregroundStyle(Theme.muted)
      }
      Spacer()
      phaseBadge
      Picker("", selection: $engine.mode) {
        ForEach(SessionEngine.Mode.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .frame(width: 320)
      .disabled(engine.isRunning)
      Button(engine.isRunning ? "Stop" : "Start session") {
        if engine.isRunning { engine.stopSession() } else { engine.startSession() }
      }
      .keyboardShortcut(.space, modifiers: [])
      .buttonStyle(.borderedProminent)
      .tint(engine.isRunning ? Theme.barge : Theme.jev)
    }
  }

  private var phaseBadge: some View {
    let (text, color): (String, Color) = {
      if engine.scriptFinished, engine.phase != .speaking {
        return ("SCRIPT FINISHED", Theme.muted)
      }
      switch engine.phase {
      case .idle: return ("IDLE", Theme.muted)
      case .listening: return ("LISTENING", Theme.accent)
      case .speaking: return ("SPEAKING", Theme.jev)
      }
    }()
    return Text(text)
      .font(.system(size: 11, weight: .black, design: .monospaced))
      .tracking(1.5)
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(color.opacity(0.18), in: Capsule())
      .overlay(Capsule().stroke(color.opacity(0.6)))
      .foregroundStyle(color)
  }

  // MARK: Transcript + response

  private var transcriptPanel: some View {
    Panel(title: "Live transcript", subtitle: engine.statusNote) {
      HStack(alignment: .top, spacing: 14) {
        VStack(alignment: .leading, spacing: 8) {
          Text(engine.transcript.isEmpty ? "…" : engine.transcript)
            .font(.system(size: 24, weight: .semibold))
            .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
          HStack(spacing: 18) {
            metric(
              "turn_complete",
              value: engine.latest.map { String(format: "%.2f", $0.turnComplete) } ?? "--",
              tint: Theme.accent)
            metric("intent", value: engine.latest?.intent.label ?? "--")
            metric(
              "pause",
              value: engine.words.isEmpty ? "--" : String(format: "%.0f ms", engine.msSinceLastWord)
            )
            if let b = engine.latest?.bargeIn {
              metric("barge-in", value: String(format: "%.2f", b), tint: Theme.barge)
            }
            metric("in flight", value: "\(engine.inflight)")
          }
        }
        responseCard
      }
      HStack(spacing: 6) {
        Image(systemName: "lock.shield")
        Text(
          "Speech recognition runs on-device. Only the transcript text and timing metadata (ms since last word, word count, assistant state) are sent to Jev."
        )
        if engine.isRateLimited {
          Spacer()
          Text("Jev rate limited (HTTP 429): backing off, silence fallback active")
            .foregroundStyle(Theme.barge)
        } else if let err = engine.lastError {
          Spacer()
          Text(err).foregroundStyle(Theme.barge).lineLimit(1)
        } else if !engine.hasAPIKey {
          Spacer()
          Text("OPENROUTER_API_KEY not set").foregroundStyle(Theme.barge)
        }
      }
      .font(.system(size: 10))
      .foregroundStyle(Theme.muted)
    }
  }

  private var responseCard: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("ASSISTANT")
          .font(.system(size: 10, weight: .bold)).tracking(1)
          .foregroundStyle(Theme.jev)
        if let intent = engine.responseIntent {
          Text(intent.label)
            .font(.system(size: 10, weight: .semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Theme.jev.opacity(0.15), in: Capsule())
            .foregroundStyle(Theme.jev)
        }
        Spacer()
        if engine.phase == .speaking {
          Image(systemName: "speaker.wave.2.fill").foregroundStyle(Theme.jev)
        }
      }
      Text(engine.response ?? "Waiting for a complete request…")
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(engine.response == nil ? Theme.muted : Theme.text)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lineLimit(3)
      if let last = engine.turns.last {
        Text(
          last.fireSource == .jev
            ? String(
              format:
                "fired %.0f ms after last word · baseline would fire at %.0f ms · saved %.0f ms",
              last.jevDelayMs, last.baselineDelayMs, last.savedMs)
            : "\(last.fireSource.rawValue) at \(TimelineMath.formatMs(last.jevDelayMs))"
        )
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(Theme.muted)
        .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(12)
    .frame(width: 330)
    .background(Color.black.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
    .overlay(
      RoundedRectangle(cornerRadius: 8).stroke(
        engine.phase == .speaking ? Theme.jev.opacity(0.7) : Theme.panelBorder))
  }

  private func metric(_ label: String, value: String, tint: Color = Theme.text) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.muted)
      Text(value).font(Theme.mono(14)).foregroundStyle(tint)
    }
  }

  private var legend: some View {
    HStack(spacing: 16) {
      legendItem(Theme.accent, "turn_complete probability")
      legendItem(Theme.jev, "Jev fired")
      legendItem(
        Theme.baseline, String(format: "%.0f ms silence baseline", engine.policy.silenceTimeoutMs))
      legendItem(Theme.barge, "barge-in")
      legendItem(Theme.waveform, engine.mode == .simulated ? "simulated level" : "mic level")
      Spacer()
    }
    .font(.system(size: 10))
    .foregroundStyle(Theme.muted)
  }

  private func legendItem(_ color: Color, _ text: String) -> some View {
    HStack(spacing: 5) {
      RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 10, height: 10)
      Text(text)
    }
  }

  // MARK: Turns

  private var turnsPanel: some View {
    Panel(title: "Turns", subtitle: "\(engine.turns.count) completed · newest first") {
      ScrollView {
        VStack(spacing: 4) {
          ForEach(engine.turns.reversed()) { turn in
            HStack(spacing: 10) {
              Text("#\(turn.index)").font(Theme.mono(11)).foregroundStyle(Theme.muted).frame(
                width: 26)
              Text(turn.transcript).font(.system(size: 12)).lineLimit(1).frame(
                maxWidth: .infinity, alignment: .leading)
              Text(turn.intent.label + (turn.slot.map { " · \($0)" } ?? ""))
                .font(.system(size: 11)).foregroundStyle(Theme.accent).frame(
                  width: 150, alignment: .leading
                ).lineLimit(1)
              Text(String(format: "p=%.2f", turn.fireProbability)).font(
                Theme.mono(11, weight: .regular)
              ).foregroundStyle(Theme.muted).frame(width: 52)
              Text(TimelineMath.formatMs(turn.jevDelayMs)).font(Theme.mono(11)).foregroundStyle(
                turn.fireSource == .jev ? Theme.jev : Theme.baseline
              ).frame(width: 60, alignment: .trailing)
              Text(
                turn.fireSource == .jev
                  ? String(format: "-%.0f ms", turn.savedMs) : turn.fireSource.rawValue
              )
              .font(Theme.mono(11)).foregroundStyle(
                turn.fireSource == .jev ? Theme.jev : Theme.baseline
              ).frame(width: 110, alignment: .trailing)
              if turn.bargedIn {
                Text("BARGED").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.barge)
              }
              if turn.baselineCutOffEarly {
                Text("BASELINE CUT OFF").font(.system(size: 9, weight: .bold)).foregroundStyle(
                  Theme.baseline)
              }
            }
            .padding(.vertical, 3)
          }
        }
      }
      .frame(maxHeight: .infinity)
    }
  }

  // MARK: Right column

  private var latencyPanel: some View {
    Panel(title: "Jev latency", subtitle: "wall-clock round trip per decision") {
      HStack {
        StatTile(label: "LAST", value: TimelineMath.formatMs(engine.stats.last), tint: Theme.accent)
        StatTile(label: "P50", value: TimelineMath.formatMs(engine.stats.p50))
        StatTile(label: "P95", value: TimelineMath.formatMs(engine.stats.p95))
      }
      HStack {
        StatTile(
          label: "DECISIONS/S",
          value: String(format: "%.1f", engine.stats.decisionsPerSecond(now: engine.now)), size: 18)
        StatTile(label: "REQUESTS", value: "\(engine.stats.requestCount)", size: 18)
        StatTile(
          label: "STALE / FAILED",
          value: "\(engine.stats.staleCount) / \(engine.stats.failureCount)", size: 18)
      }
      HStack {
        StatTile(label: "TOKENS IN", value: "\(engine.stats.inputTokens)", size: 18)
        StatTile(
          label: "TOKENS/DECISION", value: String(format: "%.0f", engine.stats.tokensPerDecision),
          size: 18)
        StatTile(label: "COST", value: TimelineMath.formatUSD(engine.stats.costUSD), size: 18)
      }
      Text(
        String(
          format: "$0.042 per Mtok input · output free · ≈ %@ per 1k decisions",
          TimelineMath.formatUSD(engine.stats.costPerThousandDecisionsUSD))
      )
      .font(.system(size: 10)).foregroundStyle(Theme.muted)
    }
  }

  private var comparisonPanel: some View {
    let c = engine.comparison
    return Panel(title: "Endpointing comparison", subtitle: "same session, same utterances") {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 8) {
          Text("SILENCE TIMEOUT").font(.system(size: 10, weight: .bold)).tracking(1)
            .foregroundStyle(Theme.baseline)
          StatTile(
            label: "MEAN DELAY AFTER END OF SPEECH",
            value: TimelineMath.formatMs(c.turns == 0 ? nil : c.meanBaselineDelayMs),
            tint: Theme.baseline)
          StatTile(
            label: "CUT SPEAKER OFF EARLY",
            value: "\(engine.turns.filter(\.baselineCutOffEarly).count)", tint: Theme.baseline,
            size: 18)
        }
        .frame(maxWidth: .infinity)
        Rectangle().fill(Theme.panelBorder).frame(width: 1)
        VStack(alignment: .leading, spacing: 8) {
          Text("JEV ENDPOINTING").font(.system(size: 10, weight: .bold)).tracking(1)
            .foregroundStyle(Theme.jev)
          StatTile(
            label: "MEAN DELAY AFTER END OF SPEECH",
            value: TimelineMath.formatMs(c.turns == 0 ? nil : c.meanJevDelayMs), tint: Theme.jev)
          StatTile(
            label: "JEV FIRES / FALLBACKS", value: "\(c.jevFires) / \(c.fallbackFires)",
            tint: Theme.jev, size: 18)
        }
        .frame(maxWidth: .infinity)
      }
      Divider().overlay(Theme.panelBorder)
      HStack {
        StatTile(
          label: "SAVED PER TURN (MEAN)",
          value: TimelineMath.formatMs(c.turns == 0 ? nil : c.meanSavedMs), tint: Theme.jev)
        StatTile(
          label: "SAVED CUMULATIVE",
          value: c.turns == 0 ? "--" : TimelineMath.formatSeconds(c.totalSavedMs), tint: Theme.jev)
        StatTile(label: "BARGE-INS", value: "\(c.bargeIns)", tint: Theme.barge, size: 18)
      }
    }
  }

  private var controlsPanel: some View {
    Panel(title: "Policy", subtitle: "thresholds live in code; Jev only supplies probabilities") {
      Toggle(isOn: $engine.jevEnabled) {
        Text("Jev endpointing (off = silence timeout only, the “before” baseline)").font(
          .system(size: 12))
      }
      .toggleStyle(.switch)
      .tint(Theme.jev)
      slider(
        "Fire threshold", value: $engine.policy.fireThreshold, range: 0.5...0.99, format: "%.2f")
      slider(
        "Barge-in threshold", value: $engine.policy.bargeInThreshold, range: 0.5...0.99,
        format: "%.2f")
      slider(
        "Min pause before acting", value: $engine.policy.minPauseMs, range: 0...600,
        format: "%.0f ms")
      slider(
        "Silence baseline / fallback", value: $engine.policy.silenceTimeoutMs, range: 500...2000,
        format: "%.0f ms")
    }
  }

  private func slider(
    _ label: String, value: Binding<Double>, range: ClosedRange<Double>, format: String
  ) -> some View {
    HStack {
      Text(label).font(.system(size: 12)).frame(width: 190, alignment: .leading)
      Slider(value: value, in: range).tint(Theme.accent)
      Text(String(format: format, value.wrappedValue)).font(Theme.mono(12)).frame(
        width: 64, alignment: .trailing)
    }
  }
}
