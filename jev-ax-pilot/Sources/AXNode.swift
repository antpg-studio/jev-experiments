import CoreGraphics
import Foundation

/// One node of an Accessibility tree, as read from `AXUIElement` or a recorded fixture.
struct AXNode: Codable, Equatable {
  var role: String
  var subrole: String?
  var title: String?
  var value: String?
  var description: String?
  var help: String?
  var identifier: String?
  var enabled: Bool
  var focused: Bool
  var selected: Bool
  var frame: CGRect
  var actions: [String]
  var children: [AXNode]

  init(
    role: String, subrole: String? = nil, title: String? = nil, value: String? = nil,
    description: String? = nil, help: String? = nil, identifier: String? = nil,
    enabled: Bool = true, focused: Bool = false, selected: Bool = false,
    frame: CGRect = .zero, actions: [String] = [], children: [AXNode] = []
  ) {
    self.role = role
    self.subrole = subrole
    self.title = title
    self.value = value
    self.description = description
    self.help = help
    self.identifier = identifier
    self.enabled = enabled
    self.focused = focused
    self.selected = selected
    self.frame = frame
    self.actions = actions
    self.children = children
  }
}

extension AXNode {
  /// Fixtures omit false/empty/nil fields to stay small, so decoding fills in defaults.
  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    role = try container.decode(String.self, forKey: .role)
    subrole = try container.decodeIfPresent(String.self, forKey: .subrole)
    title = try container.decodeIfPresent(String.self, forKey: .title)
    value = try container.decodeIfPresent(String.self, forKey: .value)
    description = try container.decodeIfPresent(String.self, forKey: .description)
    help = try container.decodeIfPresent(String.self, forKey: .help)
    identifier = try container.decodeIfPresent(String.self, forKey: .identifier)
    enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
    focused = try container.decodeIfPresent(Bool.self, forKey: .focused) ?? false
    selected = try container.decodeIfPresent(Bool.self, forKey: .selected) ?? false
    frame = try container.decodeIfPresent(CGRect.self, forKey: .frame) ?? .zero
    actions = try container.decodeIfPresent([String].self, forKey: .actions) ?? []
    children = try container.decodeIfPresent([AXNode].self, forKey: .children) ?? []
  }
}

/// A recorded snapshot of the frontmost application, used both live and as a test fixture.
struct AXSnapshot: Codable, Equatable {
  var appName: String
  var bundleIdentifier: String?
  var windowTitle: String?
  var root: AXNode
}
