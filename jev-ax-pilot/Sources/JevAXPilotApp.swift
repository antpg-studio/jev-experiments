import AppKit
import SwiftUI

@main
struct JevAXPilotApp: App {
  @State private var pilot = Pilot()
  @State private var overlays = OverlayWindows()

  var body: some Scene {
    WindowGroup("Jev AX Pilot") {
      ContentView(pilot: pilot)
        .frame(minWidth: 560, minHeight: 720)
        .onAppear {
          overlays.attach(pilot: pilot)
          NSApp.activate(ignoringOtherApps: true)
        }
    }
    .windowResizability(.contentMinSize)
    .commands {
      CommandGroup(replacing: .newItem) {}
    }
  }
}

/// Owns the floating HUD panel and the transparent highlight window.
@MainActor
final class OverlayWindows {
  private var hud: NSPanel?
  private var highlight: NSWindow?
  private var observation: Task<Void, Never>?

  func attach(pilot: Pilot) {
    guard hud == nil else { return }
    let panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 420, height: 360),
      styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView, .utilityWindow, .hudWindow],
      backing: .buffered, defer: false)
    panel.title = "Jev AX Pilot HUD"
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.isFloatingPanel = true
    panel.level = .statusBar
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.isMovableByWindowBackground = true
    panel.backgroundColor = .clear
    panel.isOpaque = false
    panel.contentView = NSHostingView(rootView: HUDView(pilot: pilot))
    if let screen = NSScreen.main {
      let frame = screen.visibleFrame
      panel.setFrameOrigin(NSPoint(x: frame.maxX - 440, y: frame.maxY - 380))
    }
    panel.orderFrontRegardless()
    hud = panel

    let window = NSWindow(
      contentRect: .zero, styleMask: .borderless, backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.level = .screenSaver
    window.ignoresMouseEvents = true
    window.hasShadow = false
    window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    window.contentView = NSHostingView(rootView: HighlightView())
    highlight = window

    observation = Task { [weak self] in
      var last: CGRect? = .zero
      while !Task.isCancelled {
        let frame = pilot.highlightFrame
        if frame != last {
          last = frame
          self?.moveHighlight(to: frame)
        }
        try? await Task.sleep(for: .milliseconds(50))
      }
    }
  }

  private func moveHighlight(to axFrame: CGRect?) {
    guard let window = highlight else { return }
    guard let axFrame, let primary = NSScreen.screens.first else {
      window.orderOut(nil)
      return
    }
    let padded = axFrame.insetBy(dx: -4, dy: -4)
    let cocoa = NSRect(
      x: padded.origin.x, y: primary.frame.height - padded.origin.y - padded.height,
      width: padded.width,
      height: padded.height)
    window.setFrame(cocoa, display: true)
    window.orderFrontRegardless()
  }
}

struct HighlightView: View {
  var body: some View {
    RoundedRectangle(cornerRadius: 6)
      .stroke(Color(red: 1.0, green: 0.85, blue: 0.1), lineWidth: 3)
      .shadow(color: .black.opacity(0.6), radius: 3)
      .padding(1)
  }
}
