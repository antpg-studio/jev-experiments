import CoreGraphics
import Foundation

/// A pruned, addressable element that Jev can choose.
struct FlatElement: Codable, Equatable {
  var id: String
  var role: String
  var label: String?
  var value: String?
  var focused: Bool
  var selected: Bool
  var destructive: Bool
  var path: [Int]
  var frame: CGRect

  var isTextInput: Bool {
    role == "text field" || role == "text area" || role == "search field" || role == "combo box"
  }

  /// What the model sees for this option: role plus label and current value.
  var summary: String {
    var parts = [role]
    if let label, !label.isEmpty { parts.append("'\(label)'") }
    if let value, !value.isEmpty, value != label { parts.append("value=\(value)") }
    if focused { parts.append("(focused)") }
    if selected { parts.append("(selected)") }
    return parts.joined(separator: " ")
  }
}

/// The pruned view of one Accessibility snapshot.
struct FlatTree: Equatable {
  var elements: [FlatElement]
  var contextText: [String]
  var focused: FlatElement?
  var hasModalSheet: Bool

  /// True when `text` appears in any element value/label, visible text, or the window title.
  func showsText(_ text: String, windowTitle: String?) -> Bool {
    let needle = text.lowercased()
    if windowTitle?.lowercased().contains(needle) == true { return true }
    if contextText.contains(where: { $0.lowercased().contains(needle) }) { return true }
    return elements.contains { element in
      element.value?.lowercased().contains(needle) == true
        || element.label?.lowercased().contains(needle) == true
    }
  }
}

/// Turns a raw Accessibility tree into a compact list of actionable elements.
/// Pure code: everything about what Jev is allowed to see is decided here.
enum TreeFlattener {
  static let elementCap = 60
  static let contextCap = 14
  static let valueCap = 80
  static let menuItemCap = 10

  static let actionableRoles: Set<String> = [
    "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXComboBox",
    "AXTextField", "AXTextArea", "AXLink", "AXSlider", "AXRow", "AXDisclosureTriangle",
    "AXIncrementor",
    "AXToggle", "AXSwitch", "AXTab", "AXTabButton", "AXCell",
  ]
  static let ignoredSubroles: Set<String> = [
    "AXCloseButton", "AXZoomButton", "AXMinimizeButton", "AXFullScreenButton", "AXIncrementArrow",
    "AXDecrementArrow", "AXIncrementPage", "AXDecrementPage", "AXToolbarButton",
  ]
  static let containerRoles: Set<String> = [
    "AXWindow", "AXSheet", "AXDrawer", "AXPopover", "AXDialog",
  ]

  /// Menu items that never help a goal and would derail the loop if pressed.
  static let ignoredMenuPrefixes = [
    "About ", "Hide ", "Quit ", "Show All", "Services", "Hide Others",
  ]

  static let destructiveWords = [
    "delete", "empty trash", "erase", "send", "pay", "purchase", "buy", "remove", "discard",
    "trash",
    "uninstall", "format", "reset", "sign out", "log out", "shut down", "restart",
  ]

  static func flatten(_ snapshot: AXSnapshot, goal: String, screen: CGRect? = nil) -> FlatTree {
    var visitor = Visitor(
      goalTokens: Goal.relevanceTokens(goal), goal: goal.lowercased(), screen: screen)
    for (index, child) in snapshot.root.children.enumerated() {
      visitor.visit(child, path: [index], depth: 1, container: nil, menuTrail: [])
    }
    var candidates = visitor.candidates
    let hasModalSheet = candidates.contains { $0.inSheet }
    if hasModalSheet {
      candidates = candidates.filter { $0.inSheet || $0.isMenuItem }
    }
    var selected = rank(candidates)
    selected.sort { $0.order < $1.order }
    var elements: [FlatElement] = []
    for (index, candidate) in selected.enumerated() {
      var element = candidate.element
      element.id = "e\(index + 1)"
      elements.append(element)
    }
    let focused = elements.first { $0.focused }
    return FlatTree(
      elements: elements, contextText: Array(visitor.contextText.prefix(contextCap)),
      focused: focused,
      hasModalSheet: hasModalSheet)
  }

  /// Keeps the cap by relevance while preserving the goal-relevant menu items and every text input.
  private static func rank(_ candidates: [Candidate]) -> [Candidate] {
    let menuItems = candidates.filter(\.isMenuItem)
    let others = candidates.filter { !$0.isMenuItem }
    let keptMenu = Array(menuItems.sorted { $0.score > $1.score }.prefix(menuItemCap))
    let room = max(elementCap - keptMenu.count, 0)
    let keptOthers: [Candidate]
    if others.count <= room {
      keptOthers = others
    } else {
      keptOthers = Array(
        others.sorted { $0.score > $1.score || ($0.score == $1.score && $0.order < $1.order) }
          .prefix(room))
    }
    return keptMenu + keptOthers
  }

  static func shortRole(_ role: String, subrole: String?) -> String {
    if subrole == "AXSearchField" { return "search field" }
    if subrole == "AXSwitch" || subrole == "AXToggle" { return "switch" }
    let stripped = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
    var words = ""
    for (index, char) in stripped.enumerated() {
      if index > 0, char.isUppercase { words.append(" ") }
      words.append(char.lowercased())
    }
    return words
  }

  static func cleaned(_ text: String?) -> String? {
    guard let text else { return nil }
    let scalars = text.unicodeScalars.filter { !($0.properties.generalCategory == .format) }
    let collapsed = String(String.UnicodeScalarView(scalars))
      .replacingOccurrences(of: "\u{00a0}", with: " ")
      .replacingOccurrences(of: "\u{2011}", with: "-")
      .split(whereSeparator: \.isNewline).joined(separator: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !collapsed.isEmpty else { return nil }
    if collapsed.count > valueCap {
      return String(collapsed.prefix(valueCap)) + "…"
    }
    return collapsed
  }

  static func isDestructive(label: String?, goal: String) -> Bool {
    guard let label = label?.lowercased() else { return false }
    for word in destructiveWords where containsWord(label, word) {
      if !containsWord(goal, word) { return true }
    }
    return false
  }

  static func containsWord(_ text: String, _ word: String) -> Bool {
    let pattern = "\\b" + NSRegularExpression.escapedPattern(for: word) + "\\b"
    return text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
  }

  /// Text a row or cell shows, gathered from its static-text descendants.
  static func derivedLabel(_ node: AXNode, depth: Int = 0) -> String? {
    var parts: [String] = []
    for child in node.children {
      if child.role == "AXStaticText" || child.role == "AXTextField" {
        if let text = cleaned(child.value) ?? cleaned(child.title) { parts.append(text) }
      } else if depth < 4, let nested = derivedLabel(child, depth: depth + 1) {
        parts.append(nested)
      }
      if parts.count >= 3 { break }
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  private struct Candidate {
    var element: FlatElement
    var score: Double
    var order: Int
    var inSheet: Bool
    var isMenuItem: Bool
  }

  private struct Visitor {
    let goalTokens: Set<String>
    let goal: String
    let screen: CGRect?
    var candidates: [Candidate] = []
    var contextText: [String] = []
    var order = 0
    private var pathInSheet = false

    init(goalTokens: Set<String>, goal: String, screen: CGRect?) {
      self.goalTokens = goalTokens
      self.goal = goal
      self.screen = screen
    }

    mutating func visit(
      _ node: AXNode, path: [Int], depth: Int, container: CGRect?, menuTrail: [String]
    ) {
      order += 1
      let role = node.role
      if role == "AXMenuBar" {
        for (index, item) in node.children.enumerated() where item.title != "Apple" {
          visit(item, path: path + [index], depth: depth + 1, container: nil, menuTrail: [])
        }
        return
      }
      if role == "AXMenuBarItem" || role == "AXMenu" || role == "AXMenuItem" {
        visitMenu(node, path: path, menuTrail: menuTrail)
        return
      }
      if role == "AXScrollBar" || role == "AXRulerMarker" || role == "AXRuler"
        || role == "AXUnknown"
      {
        return
      }
      var container = container
      if TreeFlattener.containerRoles.contains(role) {
        container = node.frame
      }
      let isSheet = role == "AXSheet" || role == "AXDialog"
      if let subrole = node.subrole, TreeFlattener.ignoredSubroles.contains(subrole) {
        return
      }
      if role == "AXStaticText" {
        if isVisible(node.frame, container: container),
          let text = TreeFlattener.cleaned(node.value) ?? TreeFlattener.cleaned(node.title),
          !contextText.contains(text)
        {
          contextText.append(text)
        }
        return
      }
      if TreeFlattener.actionableRoles.contains(role) {
        addCandidate(node, path: path, container: container, inSheet: isSheet || pathInSheet)
        if role == "AXRow" || role == "AXCell" {
          // Rows own their label; descend only for nested controls such as switches.
          for (index, child) in node.children.enumerated()
          where child.role != "AXStaticText" && child.role != "AXCell" {
            visit(
              child, path: path + [index], depth: depth + 1, container: container,
              menuTrail: menuTrail)
          }
          return
        }
        if role == "AXTextField" || role == "AXTextArea" || role == "AXButton" { return }
      }
      let wasInSheet = pathInSheet
      if isSheet { pathInSheet = true }
      for (index, child) in node.children.enumerated() {
        visit(
          child, path: path + [index], depth: depth + 1, container: container, menuTrail: menuTrail)
      }
      pathInSheet = wasInSheet
    }

    private mutating func visitMenu(_ node: AXNode, path: [Int], menuTrail: [String]) {
      switch node.role {
      case "AXMenuBarItem", "AXMenu":
        let trail = node.role == "AXMenuBarItem" ? menuTrail + [node.title ?? ""] : menuTrail
        for (index, child) in node.children.enumerated() {
          visitMenu(child, path: path + [index], menuTrail: trail)
        }
      case "AXMenuItem":
        guard node.enabled, let title = TreeFlattener.cleaned(node.title) else { return }
        guard !TreeFlattener.ignoredMenuPrefixes.contains(where: { title.hasPrefix($0) }) else {
          return
        }
        if !node.children.isEmpty {
          for (index, child) in node.children.enumerated() {
            visitMenu(child, path: path + [index], menuTrail: menuTrail + [title])
          }
          return
        }
        let score = relevance(title)
        guard score > 0 else { return }
        order += 1
        let label = (menuTrail + [title]).joined(separator: " > ")
        let element = FlatElement(
          id: "", role: "menu item", label: label, value: nil, focused: false, selected: false,
          destructive: TreeFlattener.isDestructive(label: title, goal: goal), path: path,
          frame: node.frame)
        candidates.append(
          Candidate(element: element, score: score, order: order, inSheet: false, isMenuItem: true))
      default:
        return
      }
    }

    private mutating func addCandidate(
      _ node: AXNode, path: [Int], container: CGRect?, inSheet: Bool
    ) {
      guard node.enabled else { return }
      guard isVisible(node.frame, container: container) else { return }
      let role = TreeFlattener.shortRole(node.role, subrole: node.subrole)
      var label =
        TreeFlattener.cleaned(node.title) ?? TreeFlattener.cleaned(node.description)
        ?? TreeFlattener.cleaned(node.help)
      if label == nil,
        node.role == "AXRow" || node.role == "AXCell" || node.role == "AXButton"
          || node.role == "AXLink"
      {
        label = TreeFlattener.derivedLabel(node)
      }
      var value = TreeFlattener.cleaned(node.value)
      if node.role == "AXRow" || node.role == "AXCell" {
        guard label != nil, node.frame.height > 0 else { return }
        value = nil
      }
      let isTextInput =
        node.role == "AXTextField" || node.role == "AXTextArea" || node.role == "AXComboBox"
      if label == nil, value == nil, !isTextInput, node.identifier == nil { return }
      if label == nil, node.identifier != nil, !isTextInput {
        label = TreeFlattener.cleaned(node.identifier)
      }
      let element = FlatElement(
        id: "", role: role, label: label, value: value, focused: node.focused,
        selected: node.selected,
        destructive: TreeFlattener.isDestructive(label: label, goal: goal), path: path,
        frame: node.frame)
      var score = relevance(label ?? "") + relevance(value ?? "") * 0.5
      if node.focused { score += 5 }
      if isTextInput { score += 2 }
      if inSheet { score += 3 }
      candidates.append(
        Candidate(element: element, score: score, order: order, inSheet: inSheet, isMenuItem: false)
      )
    }

    private func isVisible(_ frame: CGRect, container: CGRect?) -> Bool {
      guard frame.width > 0, frame.height > 0 else { return false }
      if let container, container.width > 0, !container.intersects(frame) { return false }
      if let screen, !screen.intersects(frame) { return false }
      return true
    }

    private func relevance(_ text: String) -> Double {
      Goal.relevance(of: text, to: goalTokens)
    }
  }
}

/// Goal-string helpers shared by the flattener, the fallback heuristic and the tests.
enum Goal {
  static let stopWords: Set<String> = [
    "a", "an", "the", "in", "on", "to", "and", "of", "with", "new", "open", "make", "create", "go",
    "turn", "into",
    "it", "up", "for", "at", "by", "from", "my", "please", "then",
  ]

  static func tokens(_ text: String) -> Set<String> {
    let lowered = text.lowercased()
    let parts = lowered.split { !($0.isLetter || $0.isNumber) }
    return Set(parts.map(String.init).filter { $0.count > 1 && !stopWords.contains($0) })
  }

  /// Goals that ask for something new (a note, tab, document) cannot be satisfied by an item that
  /// already existed before the run.
  static func createsSomething(_ goal: String) -> Bool {
    let lowered = goal.lowercased()
    return ["new", "create", "make"].contains { TreeFlattener.containsWord(lowered, $0) }
  }

  /// Goal tokens minus the app's own name, which otherwise matches every "About X"/"X Help" item.
  static func relevanceTokens(_ goal: String) -> Set<String> {
    var result = tokens(goal)
    if let app = TextCandidates.appName(in: goal) { result.subtract(tokens(app)) }
    return result
  }

  /// Overlap with the goal, penalising unrelated extra words so "New Tab" beats "Tab Overview" ties.
  static func relevance(of text: String, to goalTokens: Set<String>) -> Double {
    let tokens = Goal.tokens(text)
    guard !tokens.isEmpty else { return 0 }
    let overlap = tokens.intersection(goalTokens).count
    guard overlap > 0 else { return 0 }
    return Double(overlap) * 10 - Double(tokens.count - overlap)
  }
}
