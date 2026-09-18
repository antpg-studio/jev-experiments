import AppKit
import SwiftUI

/// Borderless windows refuse key status by default; a launcher must accept it to receive typing.
final class KeyablePanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

/// A floating, non-activating panel that sits above every window and every Space, like Spotlight.
@MainActor
final class LauncherPanelController: NSObject, NSWindowDelegate {
  static let panelWidth: CGFloat = 720
  static let panelHeight: CGFloat = 520

  let model: LauncherModel
  private let panel: KeyablePanel
  private var keyMonitor: Any?

  init(model: LauncherModel) {
    self.model = model
    panel = KeyablePanel(
      contentRect: NSRect(x: 0, y: 0, width: Self.panelWidth, height: Self.panelHeight),
      styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView], backing: .buffered,
      defer: false)
    super.init()
    panel.level = .floating
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.isMovableByWindowBackground = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = false
    panel.delegate = self
    let host = NSHostingView(rootView: LauncherView(model: model))
    host.frame = panel.contentView?.bounds ?? .zero
    host.autoresizingMask = [.width, .height]
    panel.contentView = host
    model.onExecute = { [weak self] in self?.hide() }
  }

  var isVisible: Bool { panel.isVisible }

  func toggle() {
    if panel.isVisible { hide() } else { show() }
  }

  func show() {
    model.panelWillShow()
    if let screen = NSScreen.main {
      let frame = screen.visibleFrame
      let origin = NSPoint(
        x: frame.midX - Self.panelWidth / 2,
        y: frame.midY - Self.panelHeight / 2 + frame.height * 0.12)
      panel.setFrameOrigin(origin)
    }
    panel.makeKeyAndOrderFront(nil)
    installKeyMonitor()
  }

  func hide() {
    panel.orderOut(nil)
    removeKeyMonitor()
    model.reset()
  }

  func windowDidResignKey(_ notification: Notification) {
    hide()
  }

  private func installKeyMonitor() {
    removeKeyMonitor()
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      guard let self, self.panel.isVisible else { return event }
      switch event.keyCode {
      case 53:  // Escape
        self.hide()
        return nil
      case 125:  // Down
        self.model.moveSelection(by: 1)
        return nil
      case 126:  // Up
        self.model.moveSelection(by: -1)
        return nil
      case 36, 76:  // Return, keypad Enter
        self.model.executeSelection()
        return nil
      default:
        return event
      }
    }
  }

  private func removeKeyMonitor() {
    if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    keyMonitor = nil
  }
}
