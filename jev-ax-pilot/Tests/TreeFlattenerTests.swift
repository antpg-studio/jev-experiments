import XCTest

@testable import JevAXPilot

final class TreeFlattenerTests: XCTestCase {
  func testCalculatorKeepsEveryKeypadButtonAndFlagsDelete() throws {
    let tree = try Fixture.tree("Calculator", goal: "In Calculator compute 48*12")
    let labels = tree.elements.compactMap(\.label)
    for digit in ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "Multiply", "Equals"] {
      XCTAssertTrue(labels.contains(digit), "missing \(digit)")
    }
    let delete = tree.elements.first { $0.label == "Delete" }
    XCTAssertEqual(delete?.destructive, true)
    XCTAssertFalse(labels.contains { $0.hasPrefix("Quit") || $0.contains("About") })
    XCTAssertLessThanOrEqual(tree.elements.count, TreeFlattener.elementCap)
  }

  func testIdsAreSequentialAndUnique() throws {
    let tree = try Fixture.tree(
      "SystemSettings", goal: "Open System Settings and turn on Dark Mode")
    XCTAssertEqual(tree.elements.map(\.id), (1...tree.elements.count).map { "e\($0)" })
  }

  func testSystemSettingsSidebarRowsUseDerivedLabels() throws {
    let tree = try Fixture.tree(
      "SystemSettings", goal: "Open System Settings and turn on Dark Mode")
    let rows = tree.elements.filter { $0.role == "row" }
    XCTAssertTrue(rows.contains { $0.label == "Appearance" })
    XCTAssertTrue(rows.contains { $0.label == "General" && $0.selected })
    XCTAssertTrue(tree.elements.contains { $0.role == "search field" })
  }

  func testTextEditFocusedTextAreaIsReported() throws {
    let tree = try Fixture.tree(
      "TextEdit", goal: "In TextEdit make a new document and type Hello from Jev")
    XCTAssertEqual(tree.focused?.role, "text area")
    XCTAssertTrue(tree.focused?.isTextInput ?? false)
  }

  func testSafariMenuItemsOnlyIncludeGoalRelevantOnes() throws {
    let tree = try Fixture.tree("Safari", goal: "In Safari open a new tab and go to typesafe.ai")
    let menuItems = tree.elements.filter { $0.role == "menu item" }.compactMap(\.label)
    XCTAssertTrue(menuItems.contains("File > New Tab"))
    XCTAssertFalse(menuItems.contains { $0.contains("Quit") })
    XCTAssertTrue(
      tree.elements.contains { $0.label == "smart search field" && $0.role == "text field" })
  }

  func testDisabledAndZeroSizedElementsArePruned() {
    let root = AXNode(
      role: "AXApplication",
      children: [
        AXNode(
          role: "AXWindow", frame: CGRect(x: 0, y: 0, width: 800, height: 600),
          children: [
            AXNode(
              role: "AXButton", title: "Visible", frame: CGRect(x: 10, y: 10, width: 80, height: 30)
            ),
            AXNode(
              role: "AXButton", title: "Disabled", enabled: false,
              frame: CGRect(x: 10, y: 50, width: 80, height: 30)),
            AXNode(role: "AXButton", title: "Zero", frame: .zero),
            AXNode(
              role: "AXButton", title: "Offscreen",
              frame: CGRect(x: 2000, y: 10, width: 80, height: 30)),
            AXNode(
              role: "AXStaticText", value: "Some label",
              frame: CGRect(x: 10, y: 90, width: 80, height: 30)),
          ])
      ])
    let snapshot = AXSnapshot(appName: "Test", bundleIdentifier: nil, windowTitle: nil, root: root)
    let tree = TreeFlattener.flatten(snapshot, goal: "press visible")
    XCTAssertEqual(tree.elements.map(\.label), ["Visible"])
    XCTAssertEqual(tree.contextText, ["Some label"])
  }

  func testCapKeepsGoalRelevantElements() {
    var buttons = (0..<120).map { index in
      AXNode(
        role: "AXButton", title: "Filler \(index)",
        frame: CGRect(x: 0, y: CGFloat(index) * 20, width: 50, height: 18))
    }
    buttons.append(
      AXNode(
        role: "AXButton", title: "Dark Mode", frame: CGRect(x: 0, y: 3000, width: 50, height: 18)))
    let root = AXNode(
      role: "AXApplication",
      children: [
        AXNode(
          role: "AXWindow", frame: CGRect(x: 0, y: 0, width: 800, height: 4000), children: buttons)
      ])
    let snapshot = AXSnapshot(appName: "Test", bundleIdentifier: nil, windowTitle: nil, root: root)
    let tree = TreeFlattener.flatten(snapshot, goal: "turn on Dark Mode")
    XCTAssertEqual(tree.elements.count, TreeFlattener.elementCap)
    XCTAssertTrue(tree.elements.contains { $0.label == "Dark Mode" })
  }

  func testModalSheetHidesElementsBehindIt() {
    let root = AXNode(
      role: "AXApplication",
      children: [
        AXNode(
          role: "AXWindow", frame: CGRect(x: 0, y: 0, width: 800, height: 600),
          children: [
            AXNode(
              role: "AXButton", title: "Behind", frame: CGRect(x: 10, y: 10, width: 80, height: 30)),
            AXNode(
              role: "AXSheet", frame: CGRect(x: 100, y: 100, width: 400, height: 200),
              children: [
                AXNode(
                  role: "AXButton", title: "Cancel",
                  frame: CGRect(x: 120, y: 250, width: 80, height: 30)),
                AXNode(
                  role: "AXButton", title: "Save",
                  frame: CGRect(x: 220, y: 250, width: 80, height: 30)),
              ]),
          ])
      ])
    let snapshot = AXSnapshot(appName: "Test", bundleIdentifier: nil, windowTitle: nil, root: root)
    let tree = TreeFlattener.flatten(snapshot, goal: "save the file")
    XCTAssertTrue(tree.hasModalSheet)
    XCTAssertEqual(Set(tree.elements.compactMap(\.label)), ["Cancel", "Save"])
  }

  func testDestructiveDetectionRespectsGoal() {
    XCTAssertTrue(TreeFlattener.isDestructive(label: "Empty Trash", goal: "clean up the desktop"))
    XCTAssertTrue(TreeFlattener.isDestructive(label: "Send", goal: "write a draft"))
    XCTAssertFalse(TreeFlattener.isDestructive(label: "Send", goal: "send the message to Bob"))
    XCTAssertFalse(TreeFlattener.isDestructive(label: "Sender", goal: "sort by sender"))
    XCTAssertFalse(TreeFlattener.isDestructive(label: nil, goal: "anything"))
  }

  func testShortRole() {
    XCTAssertEqual(TreeFlattener.shortRole("AXPopUpButton", subrole: nil), "pop up button")
    XCTAssertEqual(TreeFlattener.shortRole("AXTextField", subrole: "AXSearchField"), "search field")
    XCTAssertEqual(TreeFlattener.shortRole("AXCheckBox", subrole: "AXSwitch"), "switch")
  }

  func testCleanedTruncatesAndCollapsesWhitespace() {
    XCTAssertEqual(TreeFlattener.cleaned("  a\nb  "), "a b")
    XCTAssertNil(TreeFlattener.cleaned("   "))
    let long = String(repeating: "x", count: 200)
    XCTAssertEqual(TreeFlattener.cleaned(long)?.count, TreeFlattener.valueCap + 1)
  }
}
