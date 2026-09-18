import AppKit
import SwiftUI

@main
struct JevLauncherApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

  var body: some Scene {
    MenuBarExtra("Jev Launcher", systemImage: "bolt.fill") {
      Button("Toggle Launcher  ⌥Space") { delegate.togglePanel() }
      Divider()
      SettingsLink { Text("Settings…") }
      Button("Quit Jev Launcher") { NSApplication.shared.terminate(nil) }
    }
    Settings {
      SettingsView()
    }
  }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private let model = LauncherModel()
  private var panel: LauncherPanelController?
  private var hotKey: HotKey?

  func applicationDidFinishLaunching(_ notification: Notification) {
    panel = LauncherPanelController(model: model)
    hotKey = HotKey { [weak self] in self?.togglePanel() }
    if ProcessInfo.processInfo.arguments.contains("--show") {
      togglePanel()
    }
  }

  func togglePanel() {
    panel?.toggle()
  }
}

struct SettingsView: View {
  @AppStorage(JevClient.apiKeyDefaultsKey) private var apiKey = ""

  var body: some View {
    Form {
      Section("OpenRouter") {
        SecureField("API key", text: $apiKey)
        Text(
          ProcessInfo.processInfo.environment["OPENROUTER_API_KEY"] == nil
            ? "OPENROUTER_API_KEY is not set in the environment; the key above is used instead."
            : "OPENROUTER_API_KEY is set in the environment and takes precedence."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Section("Permissions") {
        Text(
          "Dark Mode, Sleep and Empty Trash send Apple Events to System Events / Finder. macOS asks for Automation permission the first time."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 440)
    .padding()
  }
}
