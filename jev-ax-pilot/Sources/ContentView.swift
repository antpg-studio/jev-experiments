import AppKit
import SwiftUI

struct ContentView: View {
  @Bindable var pilot: Pilot
  @State private var customGoal = ""
  @State private var apiKeyDraft = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      header
      if !pilot.isTrusted { permissionPanel }
      if !pilot.hasAPIKey { apiKeyPanel }
      presets
      customGoalRow
      controls
      stepLog
    }
    .padding(20)
    .background(Theme.background)
    .foregroundStyle(Theme.text)
    .preferredColorScheme(.dark)
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification))
    { _ in
      pilot.refreshPermissions()
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Jev AX Pilot").font(.system(size: 26, weight: .bold, design: .rounded))
      Text("Pixel-free computer use: Accessibility tree in, one Jev request per step out.")
        .font(.system(size: 13)).foregroundStyle(Theme.muted)
    }
  }

  private var permissionPanel: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("Accessibility permission required", systemImage: "hand.raised.fill")
        .font(.headline).foregroundStyle(Theme.warning)
      Text(
        "The pilot reads other apps' UI through the Accessibility API. Open System Settings › Privacy & Security › "
          + "Accessibility, enable Jev AX Pilot, then return here. If the app is not listed, drag it into the list "
          + "from Finder or relaunch it after clicking the button."
      )
      .font(.system(size: 12)).foregroundStyle(Theme.muted)
      .fixedSize(horizontal: false, vertical: true)
      HStack {
        Button("Open Privacy & Security › Accessibility") {
          AXReader.requestTrust()
          if let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
          {
            NSWorkspace.shared.open(url)
          }
        }
        Button("Re-check") { pilot.refreshPermissions() }
      }
    }
    .padding(12)
    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.panel))
  }

  private var apiKeyPanel: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("OPENROUTER_API_KEY not found", systemImage: "key.fill").font(.headline).foregroundStyle(
        Theme.warning)
      Text(
        "Set the environment variable before launching, or paste a key here (stored in user defaults)."
      )
      .font(.system(size: 12)).foregroundStyle(Theme.muted)
      HStack {
        SecureField("TypeSafe API key", text: $apiKeyDraft).textFieldStyle(.roundedBorder)
        Button("Save") {
          UserDefaults.standard.set(apiKeyDraft, forKey: JevClient.defaultsKey)
          apiKeyDraft = ""
          pilot.refreshPermissions()
        }
        .disabled(apiKeyDraft.isEmpty)
      }
    }
    .padding(12)
    .background(RoundedRectangle(cornerRadius: 10).fill(Theme.panel))
  }

  private var presets: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Preset goals").font(.headline)
      ForEach(Preset.all) { preset in
        Button {
          pilot.start(goal: preset.goal)
        } label: {
          HStack {
            Image(systemName: "play.fill").font(.system(size: 11))
            Text(preset.goal).lineLimit(1)
            Spacer()
          }
          .padding(.vertical, 6).padding(.horizontal, 10)
          .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel))
        }
        .buttonStyle(.plain)
        .disabled(pilot.status.isActive || !pilot.isTrusted)
      }
    }
  }

  private var customGoalRow: some View {
    HStack {
      TextField("Custom goal, e.g. In Notes create a note titled Packing", text: $customGoal)
        .textFieldStyle(.roundedBorder)
        .onSubmit { startCustom() }
      Button("Run") { startCustom() }
        .disabled(customGoal.trimmingCharacters(in: .whitespaces).isEmpty || pilot.status.isActive)
    }
  }

  private var controls: some View {
    HStack(spacing: 12) {
      Picker("Mode", selection: $pilot.mode) {
        ForEach(DecisionMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
      }
      .pickerStyle(.segmented)
      .disabled(pilot.status.isActive)
      Button {
        pilot.stop()
      } label: {
        Label("STOP", systemImage: "stop.fill")
          .font(.system(size: 18, weight: .heavy))
          .frame(minWidth: 130, minHeight: 40)
      }
      .buttonStyle(.borderedProminent)
      .tint(.red)
      .keyboardShortcut(.escape, modifiers: [])
      .disabled(!pilot.status.isActive)
    }
  }

  private var stepLog: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("Steps").font(.headline)
        Spacer()
        Text(statusText).font(.system(size: 12, weight: .medium)).foregroundStyle(statusColor)
      }
      if let error = pilot.lastError {
        Text(error).font(.system(size: 11)).foregroundStyle(Theme.warning).lineLimit(2)
      }
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 3) {
            ForEach(pilot.steps) { step in
              HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(String(format: "%02d", step.step)).monospacedDigit().foregroundStyle(
                  Theme.muted)
                Text(step.action).frame(width: 70, alignment: .leading).foregroundStyle(
                  Theme.accent)
                Text(step.target ?? "").lineLimit(1)
                Spacer()
                Text(step.latencyMs.map { String(format: "%.0f ms", $0) } ?? step.source)
                  .monospacedDigit().foregroundStyle(Theme.muted)
              }
              .font(.system(size: 12, design: .monospaced))
              .id(step.id)
            }
          }
          .padding(8)
        }
        .frame(minHeight: 140)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.panel))
        .onChange(of: pilot.steps.count) { _, _ in
          if let last = pilot.steps.last { proxy.scrollTo(last.id) }
        }
      }
    }
  }

  private var statusText: String {
    switch pilot.status {
    case .idle: return "Idle"
    case .launching(let app): return "Launching \(app)…"
    case .running: return "Running"
    case .finished(let reason): return reason
    case .failed(let reason): return "Failed: \(reason)"
    }
  }

  private var statusColor: Color {
    switch pilot.status {
    case .running, .launching: return Theme.accent
    case .failed: return Theme.warning
    default: return Theme.muted
    }
  }

  private func startCustom() {
    let goal = customGoal.trimmingCharacters(in: .whitespaces)
    guard !goal.isEmpty else { return }
    pilot.start(goal: goal)
  }
}

enum Theme {
  static let background = Color(red: 0.07, green: 0.08, blue: 0.10)
  static let panel = Color(red: 0.12, green: 0.13, blue: 0.16)
  static let text = Color(red: 0.93, green: 0.94, blue: 0.96)
  static let muted = Color(red: 0.6, green: 0.63, blue: 0.7)
  static let accent = Color(red: 0.35, green: 0.85, blue: 0.65)
  static let warning = Color(red: 1.0, green: 0.7, blue: 0.3)
}
