import Foundation

/// Everything Jev is told about a command line. Built entirely in code; Jev only judges it.
public struct CommandState: Codable, Equatable {
  public struct Tool: Codable, Equatable {
    public var name: String
    public var foundInPath: Bool?

    enum CodingKeys: String, CodingKey {
      case name
      case foundInPath = "found_in_path"
    }
  }

  public struct Git: Codable, Equatable {
    public var inRepo: Bool
    public var branch: String?
    public var workingTreeDirty: Bool?
    public var onDefaultBranch: Bool

    enum CodingKeys: String, CodingKey {
      case inRepo = "in_repo"
      case branch
      case workingTreeDirty = "working_tree_dirty"
      case onDefaultBranch = "on_default_branch"
    }
  }

  public struct PathRef: Codable, Equatable {
    public var arg: String
    public var resolved: String
    public var exists: Bool
    public var isDirectory: Bool
    public var isHome: Bool
    public var isFilesystemRoot: Bool
    public var insideCwd: Bool

    enum CodingKeys: String, CodingKey {
      case arg, resolved, exists
      case isDirectory = "is_directory"
      case isHome = "is_home"
      case isFilesystemRoot = "is_filesystem_root"
      case insideCwd = "inside_cwd"
    }
  }

  public var command: String
  public var cwd: String
  public var cwdIsHome: Bool
  public var tool: Tool
  public var usesSudo: Bool
  public var git: Git
  public var referencedPaths: [PathRef]
  public var containsTokenLikeString: Bool
  public var previousCommands: [String]

  enum CodingKeys: String, CodingKey {
    case command, cwd, tool, git
    case cwdIsHome = "cwd_is_home"
    case usesSudo = "uses_sudo"
    case referencedPaths = "referenced_paths"
    case containsTokenLikeString = "contains_token_like_string"
    case previousCommands = "previous_commands"
  }
}

/// Filesystem facts the state builder needs, abstracted so tests can use fixtures.
public protocol FileProbe {
  func exists(_ path: String) -> (exists: Bool, isDirectory: Bool)
}

public struct RealFileProbe: FileProbe {
  public init() {}
  public func exists(_ path: String) -> (exists: Bool, isDirectory: Bool) {
    var isDir: ObjCBool = false
    let ok = FileManager.default.fileExists(atPath: path, isDirectory: &isDir)
    return (ok, isDir.boolValue)
  }
}

public enum StateBuilder {
  static let separators: Set<String> = ["|", "||", "&&", ";", "&"]
  static let wrappers: Set<String> = ["sudo", "env", "time", "nohup", "exec", "command", "builtin"]

  /// Splits a command line into words with minimal quote handling.
  public static func tokenize(_ line: String) -> [String] {
    var tokens: [String] = []
    var current = ""
    var quote: Character?
    var hasContent = false
    for ch in line {
      if let q = quote {
        if ch == q { quote = nil } else { current.append(ch) }
        continue
      }
      switch ch {
      case "'", "\"":
        quote = ch
        hasContent = true
      case " ", "\t", "\n":
        if hasContent {
          tokens.append(current)
          current = ""
          hasContent = false
        }
      default:
        current.append(ch)
        hasContent = true
      }
    }
    if hasContent { tokens.append(current) }
    return tokens
  }

  /// The program name of the first simple command, skipping `sudo`/`env`-style wrappers.
  public static func primaryTool(_ tokens: [String]) -> String? {
    var i = 0
    while i < tokens.count {
      let t = tokens[i]
      let isAssignment = t.contains("=") && !t.hasPrefix("-")
      if wrappers.contains(t) || isAssignment || t.hasPrefix("-") {
        i += 1
        continue
      }
      return t
    }
    return nil
  }

  static let tokenPatterns: [NSRegularExpression] = {
    let sources = [
      #"sk-[A-Za-z0-9_-]{8,}"#,
      #"gh[pousr]_[A-Za-z0-9]{20,}"#,
      #"AKIA[0-9A-Z]{12,}"#,
      #"xox[abpr]-[A-Za-z0-9-]{10,}"#,
      #"(?i)bearer\s+[A-Za-z0-9._~+/=-]{16,}"#,
      #"(?i)(password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S{6,}"#,
      #"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"#,
      #"://[^/\s:]+:[^@\s]{4,}@"#,
    ]
    return sources.compactMap { try? NSRegularExpression(pattern: $0) }
  }()

  public static func containsTokenLikeString(_ line: String) -> Bool {
    let range = NSRange(line.startIndex..., in: line)
    return tokenPatterns.contains { $0.firstMatch(in: line, range: range) != nil }
  }

  static func looksLikePath(_ token: String) -> Bool {
    if token.hasPrefix("/") || token.hasPrefix("~") || token.hasPrefix(".") { return true }
    if token.contains("/") && !token.contains("://") { return true }
    return false
  }

  public static func resolvePath(_ arg: String, cwd: String, home: String) -> String {
    var p = arg
    if p == "~" { p = home } else if p.hasPrefix("~/") { p = home + p.dropFirst(1) }
    if !p.hasPrefix("/") { p = cwd + "/" + p }
    return (p as NSString).standardizingPath
  }

  /// Extracts path-like arguments and probes them. Globs are probed on their literal parent.
  public static func referencedPaths(
    tokens: [String], cwd: String, home: String, probe: FileProbe
  ) -> [CommandState.PathRef] {
    var refs: [CommandState.PathRef] = []
    var expectTool = true
    let normalizedCwd = (cwd as NSString).standardizingPath
    let normalizedHome = (home as NSString).standardizingPath
    for raw in tokens {
      if separators.contains(raw) {
        expectTool = true
        continue
      }
      var token = raw
      if token.hasPrefix("-") {
        if let eq = token.firstIndex(of: "="), token.hasPrefix("--") {
          token = String(token[token.index(after: eq)...])
        } else {
          continue
        }
      }
      if expectTool {
        expectTool = wrappers.contains(token)
        if !looksLikePath(token) { continue }
      }
      let isGlob = token.contains("*") || token.contains("?")
      var literal = token
      if isGlob, let star = token.firstIndex(where: { $0 == "*" || $0 == "?" }) {
        literal = String(token[..<star])
        if let slash = literal.lastIndex(of: "/") {
          literal = String(literal[...slash])
        } else {
          literal = "."
        }
      }
      let alreadyProbed = refs.contains { $0.arg == token }
      if alreadyProbed { continue }
      if !looksLikePath(token) {
        let candidate = resolvePath(token, cwd: cwd, home: home)
        if !probe.exists(candidate).exists { continue }
      }
      let resolved = resolvePath(literal, cwd: cwd, home: home)
      let (exists, isDir) = probe.exists(resolved)
      refs.append(
        CommandState.PathRef(
          arg: token,
          resolved: resolved,
          exists: exists,
          isDirectory: isDir,
          isHome: resolved == normalizedHome,
          isFilesystemRoot: resolved == "/",
          insideCwd: resolved == normalizedCwd || resolved.hasPrefix(normalizedCwd + "/")
        ))
      if refs.count >= 8 { break }
    }
    return refs
  }

  public static func build(
    command: String,
    cwd: String,
    home: String,
    git: CommandState.Git,
    toolFound: Bool?,
    previousCommands: [String],
    probe: FileProbe
  ) -> CommandState {
    let tokens = tokenize(command)
    let toolName = primaryTool(tokens) ?? ""
    return CommandState(
      command: command,
      cwd: cwd,
      cwdIsHome: (cwd as NSString).standardizingPath == (home as NSString).standardizingPath,
      tool: .init(name: toolName, foundInPath: toolFound),
      usesSudo: tokens.contains("sudo"),
      git: git,
      referencedPaths: referencedPaths(tokens: tokens, cwd: cwd, home: home, probe: probe),
      containsTokenLikeString: containsTokenLikeString(command),
      previousCommands: Array(previousCommands.suffix(3))
    )
  }
}
