import XCTest

@testable import JevShellGuard

struct FixtureProbe: FileProbe {
  var dirs: Set<String>
  var files: Set<String>
  func exists(_ path: String) -> (exists: Bool, isDirectory: Bool) {
    if dirs.contains(path) { return (true, true) }
    if files.contains(path) { return (true, false) }
    return (false, false)
  }
}

final class StateBuilderTests: XCTestCase {
  let home = "/Users/dev"
  let cwd = "/Users/dev/proj"
  lazy var probe = FixtureProbe(
    dirs: ["/", "/Users/dev", "/Users/dev/proj", "/Users/dev/proj/build", "/usr"],
    files: ["/Users/dev/proj/README.md"])

  func testTokenizeHandlesQuotes() {
    XCTAssertEqual(
      StateBuilder.tokenize(#"curl -H "Authorization: Bearer x" 'https://a.b/c' d"#),
      ["curl", "-H", "Authorization: Bearer x", "https://a.b/c", "d"])
    XCTAssertEqual(StateBuilder.tokenize("  ls   -la  "), ["ls", "-la"])
    XCTAssertEqual(StateBuilder.tokenize("echo ''"), ["echo", ""])
  }

  func testPrimaryToolSkipsWrappersAndAssignments() {
    XCTAssertEqual(StateBuilder.primaryTool(StateBuilder.tokenize("sudo rm -rf /usr")), "rm")
    XCTAssertEqual(StateBuilder.primaryTool(StateBuilder.tokenize("FOO=1 env bar --x")), "bar")
    XCTAssertEqual(StateBuilder.primaryTool(StateBuilder.tokenize("gti status")), "gti")
    XCTAssertNil(StateBuilder.primaryTool([]))
  }

  func testResolvePath() {
    XCTAssertEqual(StateBuilder.resolvePath("~/", cwd: cwd, home: home), home)
    XCTAssertEqual(StateBuilder.resolvePath("~", cwd: cwd, home: home), home)
    XCTAssertEqual(StateBuilder.resolvePath("./build", cwd: cwd, home: home), cwd + "/build")
    XCTAssertEqual(StateBuilder.resolvePath("../x", cwd: cwd, home: home), home + "/x")
    XCTAssertEqual(StateBuilder.resolvePath("/", cwd: cwd, home: home), "/")
  }

  func testReferencedPathsFlagsHomeAndRoot() {
    let refs = StateBuilder.referencedPaths(
      tokens: StateBuilder.tokenize("rm -rf ~/"), cwd: cwd, home: home, probe: probe)
    XCTAssertEqual(refs.count, 1)
    XCTAssertTrue(refs[0].isHome)
    XCTAssertTrue(refs[0].exists)
    XCTAssertTrue(refs[0].isDirectory)
    XCTAssertFalse(refs[0].insideCwd)

    let root = StateBuilder.referencedPaths(
      tokens: StateBuilder.tokenize("sudo rm -rf /"), cwd: cwd, home: home, probe: probe)
    XCTAssertEqual(root.map(\.isFilesystemRoot), [true])
  }

  func testReferencedPathsInsideCwdAndMissing() {
    let refs = StateBuilder.referencedPaths(
      tokens: StateBuilder.tokenize("rm -rf ./build ./dist README.md"),
      cwd: cwd, home: home, probe: probe)
    XCTAssertEqual(refs.map(\.arg), ["./build", "./dist", "README.md"])
    XCTAssertEqual(refs.map(\.exists), [true, false, true])
    XCTAssertEqual(refs.map(\.insideCwd), [true, true, true])
    XCTAssertEqual(refs.map(\.isDirectory), [true, false, false])
  }

  func testReferencedPathsIgnoresFlagsToolsAndURLs() {
    let refs = StateBuilder.referencedPaths(
      tokens: StateBuilder.tokenize("curl -o out.json https://api.example.com/v1 && ls -la"),
      cwd: cwd, home: home, probe: probe)
    XCTAssertTrue(refs.isEmpty)
  }

  func testReferencedPathsGlobProbesParent() {
    let refs = StateBuilder.referencedPaths(
      tokens: StateBuilder.tokenize("rm -rf ~/*"), cwd: cwd, home: home, probe: probe)
    XCTAssertEqual(refs.count, 1)
    XCTAssertEqual(refs[0].resolved, home)
    XCTAssertTrue(refs[0].isHome)
  }

  func testReferencedPathsFlagEquals() {
    let refs = StateBuilder.referencedPaths(
      tokens: StateBuilder.tokenize("tar --directory=/usr -czf x.tgz ."),
      cwd: cwd, home: home, probe: probe)
    XCTAssertEqual(refs.map(\.resolved), ["/usr", cwd])
  }

  func testTokenLikeStrings() {
    XCTAssertTrue(
      StateBuilder.containsTokenLikeString(
        #"curl -H "Authorization: Bearer sk-live-9f8e7d6c5b4a3210" https://x"#))
    XCTAssertTrue(
      StateBuilder.containsTokenLikeString("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz12"))
    XCTAssertTrue(StateBuilder.containsTokenLikeString("mysql -u root password=Hunter2Secret"))
    XCTAssertTrue(
      StateBuilder.containsTokenLikeString("psql postgres://admin:s3cretpw@db.internal/x"))
    XCTAssertFalse(
      StateBuilder.containsTokenLikeString("curl -H \"Authorization: Bearer $TOKEN\" https://x"))
    XCTAssertFalse(StateBuilder.containsTokenLikeString("git push --force origin main"))
  }

  func testBuildAssemblesState() throws {
    let git = CommandState.Git(
      inRepo: true, branch: "main", workingTreeDirty: true, onDefaultBranch: true)
    let state = StateBuilder.build(
      command: "sudo rm -rf ~/", cwd: home, home: home, git: git, toolFound: true,
      previousCommands: ["a", "b", "c", "d"], probe: probe)
    XCTAssertTrue(state.usesSudo)
    XCTAssertTrue(state.cwdIsHome)
    XCTAssertEqual(state.tool.name, "rm")
    XCTAssertEqual(state.previousCommands, ["b", "c", "d"])
    XCTAssertEqual(state.referencedPaths.count, 1)
    XCTAssertTrue(state.referencedPaths[0].isHome)

    let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any]
    XCTAssertEqual(json?["uses_sudo"] as? Bool, true)
    XCTAssertEqual((json?["git"] as? [String: Any])?["working_tree_dirty"] as? Bool, true)
    XCTAssertNotNil((json?["referenced_paths"] as? [[String: Any]])?.first?["is_home"])
  }

  func testRequestContainsAllQuestions() throws {
    let state = StateBuilder.build(
      command: "ls", cwd: cwd, home: home,
      git: .init(inRepo: false, branch: nil, workingTreeDirty: nil, onDefaultBranch: false),
      toolFound: true, previousCommands: [], probe: probe)
    let request = Questions.request(state: state)
    XCTAssertEqual(request["model"] as? String, "typesafe/jev-1.13")
    let questions = request["questions"] as? [String: Any]
    XCTAssertEqual(
      Set(questions?.keys.map { $0 } ?? []), Set(Questions.noulIDs + [Questions.verdict]))
    XCTAssertTrue(JSONSerialization.isValidJSONObject(request))
  }

  func testParseGitHead() {
    XCTAssertEqual(GitProbe.parseHead("ref: refs/heads/main\n"), "main")
    XCTAssertEqual(GitProbe.parseHead("ref: refs/heads/feat/x"), "feat/x")
    XCTAssertEqual(GitProbe.parseHead("0123456789abcdef"), "detached@01234567")
  }
}
