import SwiftUI

@main
struct JevVoiceTurnApp: App {
  @StateObject private var engine = SessionEngine()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(engine)
        .frame(minWidth: 1180, minHeight: 680)
        .preferredColorScheme(.dark)
    }
    .defaultSize(width: 1280, height: 720)
    .windowResizability(.contentMinSize)

    Settings {
      SettingsView()
    }
  }
}

struct SettingsView: View {
  @AppStorage(JevClient.apiKeyDefaultsKey) private var storedKey = ""
  private var envKeySet: Bool {
    !(ProcessInfo.processInfo.environment["OPENROUTER_API_KEY"] ?? "").isEmpty
  }

  var body: some View {
    Form {
      Section("TypeSafe API key") {
        if envKeySet {
          Text("Using OPENROUTER_API_KEY from the environment.")
            .foregroundStyle(.secondary)
        }
        SecureField("Fallback key (stored in UserDefaults)", text: $storedKey)
        Text(
          "The env var takes precedence. The key never leaves this Mac except in the Authorization header to openrouter.ai."
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 460, height: 200)
  }
}
