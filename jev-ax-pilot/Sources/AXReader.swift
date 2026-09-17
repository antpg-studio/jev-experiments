import AppKit
import ApplicationServices
import Foundation

/// Reads the Accessibility tree of a running application and performs actions on it.
/// Everything here talks to `AXUIElement`; the pure logic lives in `TreeFlattener`.
final class AXReader: @unchecked Sendable {
  struct Limits {
    var maxDepth = 24
    var maxNodes = 2500
    var maxChildrenPerNode = 120
    var maxMenuDepth = 4
  }

  var limits = Limits()
  /// Elements addressed by their child-index path from the application element.
  private(set) var elementsByPath: [[Int]: AXUIElement] = [:]

  static var isTrusted: Bool { AXIsProcessTrusted() }

  static func requestTrust() {
    let options =
      [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
  }

  func snapshot(of app: NSRunningApplication) -> AXSnapshot {
    elementsByPath = [:]
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    var visited = 0
    var root = read(appElement, path: [], depth: 0, visited: &visited, menuDepth: 0)
    root.role = "AXApplication"
    root.title = app.localizedName
    let focusedWindow = children(of: appElement, attribute: kAXFocusedWindowAttribute).first
    let windowTitle = focusedWindow.flatMap { stringAttribute($0, kAXTitleAttribute) }
    return AXSnapshot(
      appName: app.localizedName ?? "Unknown",
      bundleIdentifier: app.bundleIdentifier,
      windowTitle: windowTitle,
      root: root)
  }

  func element(at path: [Int]) -> AXUIElement? { elementsByPath[path] }

  // MARK: - Actions

  @discardableResult
  func press(_ element: AXUIElement) -> Bool {
    let names = actionNames(element)
    for action in [kAXPressAction, kAXPickAction, kAXConfirmAction, "AXOpen", kAXShowMenuAction] {
      if names.contains(action), AXUIElementPerformAction(element, action as CFString) == .success {
        return true
      }
    }
    if AXUIElementPerformAction(element, kAXPressAction as CFString) == .success { return true }
    // Rows/cells without a press action (list rows, URL suggestions): selecting alone does not
    // activate them, so select and then click the centre of the frame.
    AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue)
    if let frame = frame(of: element) {
      clickCenter(of: frame)
      return true
    }
    return false
  }

  @discardableResult
  func setValue(_ text: String, on element: AXUIElement) -> Bool {
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
    guard settable.boolValue else { return false }
    return AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
      == .success
  }

  @discardableResult
  func focus(_ element: AXUIElement) -> Bool {
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
      == .success
  }

  func value(of element: AXUIElement) -> String? { stringAttribute(element, kAXValueAttribute) }

  func focusedElement(in app: NSRunningApplication) -> AXUIElement? {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    var value: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &value)
        == .success,
      let value
    else { return nil }
    return unsafeDowncast(value, to: AXUIElement.self)
  }

  func role(of element: AXUIElement) -> String? { stringAttribute(element, kAXRoleAttribute) }

  func frame(of element: AXUIElement) -> CGRect? {
    guard let position: CGPoint = axValue(element, kAXPositionAttribute, type: .cgPoint),
      let size: CGSize = axValue(element, kAXSizeAttribute, type: .cgSize)
    else { return nil }
    return CGRect(origin: position, size: size)
  }

  func clickCenter(of frame: CGRect) {
    let point = CGPoint(x: frame.midX, y: frame.midY)
    let down = CGEvent(
      mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point,
      mouseButton: .left)
    let up = CGEvent(
      mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left
    )
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
  }

  func typeText(_ text: String) {
    // One character per event: apps that read key events instead of the unicode string
    // (Calculator) only see the first character of a multi-character event.
    for character in text {
      let chunk = Array(String(character).utf16)
      guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
      else { return }
      chunk.withUnsafeBufferPointer { buffer in
        down.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: buffer.baseAddress)
        up.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: buffer.baseAddress)
      }
      down.post(tap: .cghidEventTap)
      up.post(tap: .cghidEventTap)
      usleep(4000)
    }
  }

  func pressKey(_ key: KeyChord) {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key.keyCode, keyDown: true),
      let up = CGEvent(keyboardEventSource: nil, virtualKey: key.keyCode, keyDown: false)
    else { return }
    down.flags = key.flags
    up.flags = key.flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
  }

  func scroll(lines: Int32) {
    let event = CGEvent(
      scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0
    )
    event?.post(tap: .cghidEventTap)
  }

  // MARK: - Tree reading

  private static let attributeNames: [String] = [
    kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXValueAttribute,
    kAXDescriptionAttribute, kAXHelpAttribute, kAXIdentifierAttribute, kAXEnabledAttribute,
    kAXFocusedAttribute, kAXSelectedAttribute, kAXPositionAttribute, kAXSizeAttribute,
  ]

  private func read(
    _ element: AXUIElement, path: [Int], depth: Int, visited: inout Int, menuDepth: Int
  )
    -> AXNode
  {
    visited += 1
    elementsByPath[path] = element
    var values: CFArray?
    let names = Self.attributeNames as CFArray
    AXUIElementCopyMultipleAttributeValues(
      element, names, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
    let raw = (values as? [AnyObject]) ?? []
    func at(_ index: Int) -> AnyObject? {
      guard index < raw.count else { return nil }
      let value = raw[index]
      if CFGetTypeID(value) == AXValueGetTypeID(),
        AXValueGetType(unsafeDowncast(value, to: AXValue.self)) == .axError
      {
        return nil
      }
      return value
    }
    let role = (at(0) as? String) ?? "AXUnknown"
    var node = AXNode(role: role)
    node.subrole = at(1) as? String
    node.title = Self.trimmed(at(2) as? String)
    node.value = Self.describeValue(at(3))
    node.description = Self.trimmed(at(4) as? String)
    node.help = Self.trimmed(at(5) as? String)
    node.identifier = at(6) as? String
    node.enabled = (at(7) as? Bool) ?? true
    node.focused = (at(8) as? Bool) ?? false
    node.selected = (at(9) as? Bool) ?? false
    if let position = at(10), let size = at(11),
      let origin: CGPoint = Self.unwrap(position, type: .cgPoint),
      let dimensions: CGSize = Self.unwrap(size, type: .cgSize)
    {
      node.frame = CGRect(origin: origin, size: dimensions)
    }
    node.actions = actionNames(element)

    let isMenu =
      role == "AXMenuBar" || role == "AXMenu" || role == "AXMenuBarItem" || role == "AXMenuItem"
    let nextMenuDepth = isMenu ? menuDepth + 1 : menuDepth
    guard depth < limits.maxDepth, visited < limits.maxNodes, nextMenuDepth <= limits.maxMenuDepth
    else {
      return node
    }
    // Static text and images never have interesting children; skipping them keeps reads fast.
    if role == "AXStaticText" || role == "AXImage"
      || role == "AXMenuBarItem" && node.title == "Apple"
    {
      return node
    }
    let kids = children(of: element, attribute: kAXChildrenAttribute).prefix(
      limits.maxChildrenPerNode)
    for (index, child) in kids.enumerated() where visited < limits.maxNodes {
      node.children.append(
        read(
          child, path: path + [index], depth: depth + 1, visited: &visited, menuDepth: nextMenuDepth
        ))
    }
    return node
  }

  private func children(of element: AXUIElement, attribute: String) -> [AXUIElement] {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
      let value
    else {
      return []
    }
    if CFGetTypeID(value) == CFArrayGetTypeID() {
      return (value as? [AXUIElement]) ?? []
    }
    if CFGetTypeID(value) == AXUIElementGetTypeID() {
      return [unsafeDowncast(value, to: AXUIElement.self)]
    }
    return []
  }

  private func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return (names as? [String]) ?? []
  }

  private func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
      return nil
    }
    return value as? String
  }

  private func axValue<T>(_ element: AXUIElement, _ attribute: String, type: AXValueType) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
      let value
    else {
      return nil
    }
    return Self.unwrap(value, type: type)
  }

  private static func unwrap<T>(_ value: AnyObject, type: AXValueType) -> T? {
    guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    let axValue = unsafeDowncast(value, to: AXValue.self)
    guard AXValueGetType(axValue) == type else { return nil }
    switch type {
    case .cgPoint:
      var point = CGPoint.zero
      guard AXValueGetValue(axValue, type, &point) else { return nil }
      return point as? T
    case .cgSize:
      var size = CGSize.zero
      guard AXValueGetValue(axValue, type, &size) else { return nil }
      return size as? T
    default:
      return nil
    }
  }

  private static func trimmed(_ string: String?) -> String? {
    guard let string else { return nil }
    let cleaned = string.trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? nil : cleaned
  }

  private static func describeValue(_ value: AnyObject?) -> String? {
    guard let value else { return nil }
    if let string = value as? String { return trimmed(string) }
    if let number = value as? NSNumber { return number.stringValue }
    if let url = value as? URL { return url.absoluteString }
    if let date = value as? Date { return ISO8601DateFormatter().string(from: date) }
    if let attributed = value as? NSAttributedString { return trimmed(attributed.string) }
    return nil
  }
}

/// A key chord Jev can choose from; the set is fixed so the model never invents a key.
struct KeyChord: Equatable {
  let name: String
  let keyCode: CGKeyCode
  let flags: CGEventFlags

  static let all: [KeyChord] = [
    KeyChord(name: "Return", keyCode: 36, flags: []),
    KeyChord(name: "Escape", keyCode: 53, flags: []),
    KeyChord(name: "Tab", keyCode: 48, flags: []),
    KeyChord(name: "Space", keyCode: 49, flags: []),
    KeyChord(name: "Delete", keyCode: 51, flags: []),
    KeyChord(name: "Down", keyCode: 125, flags: []),
    KeyChord(name: "Up", keyCode: 126, flags: []),
    KeyChord(name: "Cmd+N", keyCode: 45, flags: .maskCommand),
    KeyChord(name: "Cmd+T", keyCode: 17, flags: .maskCommand),
    KeyChord(name: "Cmd+L", keyCode: 37, flags: .maskCommand),
    KeyChord(name: "Cmd+A", keyCode: 0, flags: .maskCommand),
    KeyChord(name: "Cmd+W", keyCode: 13, flags: .maskCommand),
    KeyChord(name: "Cmd+Comma", keyCode: 43, flags: .maskCommand),
  ]

  static func named(_ name: String) -> KeyChord? { all.first { $0.name == name } }
}
