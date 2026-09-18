import Foundation
import JevShellGuard

let usage = """
  jevsh — Jev-judged shell guard

    jevsh check [--prev "<cmds>"] [--tool-found 0|1] [--cwd DIR] -- <command line>
    jevsh explain <command line>
    jevsh bench [--heuristic] [-n COUNT]
    jevsh stats [--reset]
    jevsh config

  exit codes for `check`: 0 run, 1 declined, 3 blocked, 2 usage error
  """

func tty(_ s: String) {
  FileHandle.standardError.write(Data((s + "\n").utf8))
}

/// Reads one line from the controlling terminal, byte by byte in non-canonical mode with
/// manual echo, so it behaves the same under zle's raw tty and a cooked one. Ends on CR/LF.
func readTTYLine() -> String? {
  let fd = open("/dev/tty", O_RDWR)
  guard fd >= 0 else { return nil }
  defer { close(fd) }
  var saved = termios()
  let haveTermios = tcgetattr(fd, &saved) == 0
  if haveTermios {
    var raw = saved
    raw.c_lflag &= ~tcflag_t(ICANON | ECHO)
    withUnsafeMutableBytes(of: &raw.c_cc) { cc in
      cc[Int(VMIN)] = 1
      cc[Int(VTIME)] = 0
    }
    tcsetattr(fd, TCSANOW, &raw)
  }
  defer { if haveTermios { tcsetattr(fd, TCSANOW, &saved) } }
  var bytes = [UInt8]()
  var byte: UInt8 = 0
  while bytes.count < 64 {
    guard read(fd, &byte, 1) == 1 else { break }
    if byte == UInt8(ascii: "\n") || byte == UInt8(ascii: "\r") { break }
    if byte == 0x7f || byte == 0x08 {
      if !bytes.isEmpty {
        bytes.removeLast()
        _ = "\u{8} \u{8}".withCString { write(fd, $0, 3) }
      }
      continue
    }
    if byte == 0x03 { break }
    bytes.append(byte)
    _ = write(fd, &byte, 1)
  }
  return String(decoding: bytes, as: UTF8.self).trimmingCharacters(in: .whitespaces)
}

func toolFoundInPath(_ name: String) -> Bool? {
  guard !name.isEmpty, !name.contains("/") else { return nil }
  let path = ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"
  for dir in path.split(separator: ":") {
    if FileManager.default.isExecutableFile(atPath: "\(dir)/\(name)") { return true }
  }
  return false
}

struct Evaluation {
  var state: CommandState
  var decision: Decision
  var judgment: Judgment?
  var latencyMs: Double?
  var error: JevError?
  var offline: Bool { judgment == nil }
}

func buildState(command: String, cwd: String, prev: [String], toolFound: Bool?) -> CommandState {
  let tokens = StateBuilder.tokenize(command)
  let tool = StateBuilder.primaryTool(tokens) ?? ""
  return StateBuilder.build(
    command: command,
    cwd: cwd,
    home: NSHomeDirectory(),
    git: GitProbe.probe(cwd: cwd),
    toolFound: toolFound ?? toolFoundInPath(tool),
    previousCommands: prev,
    probe: RealFileProbe()
  )
}

func evaluate(_ state: CommandState, config: Config, heuristicOnly: Bool = false) -> Evaluation {
  if heuristicOnly {
    let d = Fallback.decide(state.command, toolFound: state.tool.foundInPath)
    return Evaluation(state: state, decision: d, judgment: nil, latencyMs: 0, error: nil)
  }
  let client: JevClient
  do {
    client = try JevClient()
  } catch let e as JevError {
    let d = Fallback.decide(state.command, toolFound: state.tool.foundInPath)
    return Evaluation(state: state, decision: d, judgment: nil, latencyMs: nil, error: e)
  } catch {
    fatalError("unreachable")
  }
  switch client.judge(state, deadlineMs: config.deadlineMs) {
  case .success(let r):
    return Evaluation(
      state: state, decision: Policy.decide(r.judgment, config: config), judgment: r.judgment,
      latencyMs: r.latencyMs, error: nil)
  case .failure(let e):
    let d = Fallback.decide(state.command, toolFound: state.tool.foundInPath)
    return Evaluation(state: state, decision: d, judgment: nil, latencyMs: nil, error: e)
  }
}

func record(_ ev: Evaluation) {
  Stats.append(
    StatsRecord(
      ts: Date().timeIntervalSince1970,
      ms: ev.latencyMs ?? 0,
      inputTokens: ev.judgment?.inputTokens ?? 0,
      decision: ev.decision.label,
      offline: ev.offline))
}

// MARK: - check

func runCheck(_ args: [String]) -> Int32 {
  var prev: [String] = []
  var toolFound: Bool?
  var cwd = FileManager.default.currentDirectoryPath
  var rest: [String] = []
  var i = 0
  while i < args.count {
    let a = args[i]
    switch a {
    case "--prev":
      i += 1
      if i < args.count {
        prev = args[i].split(separator: "\n").map {
          $0.trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
      }
    case "--tool-found":
      i += 1
      if i < args.count { toolFound = args[i] == "1" }
    case "--cwd":
      i += 1
      if i < args.count { cwd = args[i] }
    case "--":
      rest = Array(args[(i + 1)...])
      i = args.count
    default:
      rest.append(a)
    }
    i += 1
  }
  let command = rest.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
  guard !command.isEmpty else { return 0 }

  let config = Config.load()
  guard config.enabled else { return 0 }
  let tokens = StateBuilder.tokenize(command)
  if let tool = StateBuilder.primaryTool(tokens), config.skipTools.contains(tool) { return 0 }

  let state = buildState(command: command, cwd: cwd, prev: prev, toolFound: toolFound)
  let ev = evaluate(state, config: config)
  record(ev)

  // Under the zle hook the cursor is still on the command line; move below it before printing.
  let fromZLE = ProcessInfo.processInfo.environment["JEVSH_ZLE"] != nil

  switch ev.decision {
  case .run:
    return 0
  case .block(let reasons):
    if fromZLE { FileHandle.standardError.write(Data("\n".utf8)) }
    if let e = ev.error { tty(Banner.offlineNote(e.description)) }
    tty(Banner.block(command: command, reasons: reasons, ms: ev.latencyMs, offline: ev.offline))
    return 3
  case .confirm(let reasons):
    if fromZLE { FileHandle.standardError.write(Data("\n".utf8)) }
    if let e = ev.error { tty(Banner.offlineNote(e.description)) }
    FileHandle.standardError.write(
      Data(
        Banner.confirm(command: command, reasons: reasons, ms: ev.latencyMs, offline: ev.offline)
          .utf8))
    let answer = readTTYLine()?.lowercased() ?? ""
    let accepted = answer == "y" || answer == "yes"
    // On accept under zle, `.accept-line` supplies the newline itself.
    if !(fromZLE && accepted) { FileHandle.standardError.write(Data("\r\n".utf8)) }
    return accepted ? 0 : 1
  }
}

// MARK: - explain

func fmt(_ v: Double) -> String { String(format: "%.2f", v) }

func runExplain(_ args: [String]) -> Int32 {
  let command = args.joined(separator: " ")
  guard !command.isEmpty else {
    tty(usage)
    return 2
  }
  let config = Config.load()
  let state = buildState(
    command: command, cwd: FileManager.default.currentDirectoryPath, prev: [], toolFound: nil)
  let ev = evaluate(state, config: config)

  let enc = JSONEncoder()
  enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
  if let data = try? enc.encode(state) {
    print("\(ANSI.dim)state\(ANSI.reset)")
    print(String(decoding: data, as: UTF8.self))
  }
  print("")
  if let j = ev.judgment {
    print("\(ANSI.dim)answers (\(j.model))\(ANSI.reset)")
    for id in Questions.noulIDs {
      let v = j.nouls[id] ?? 0
      let t = config.thresholds[id] ?? 1
      let mark = v >= t ? "\(ANSI.yellow)▲\(ANSI.reset)" : " "
      print(
        "  \(mark) \(id.padding(toLength: 14, withPad: " ", startingAt: 0)) \(fmt(v))  (threshold \(fmt(t)))"
      )
    }
    let probs = j.verdictProbabilities.sorted { $0.value > $1.value }
      .map { "\($0.key) \(fmt($0.value))" }.joined(separator: "  ")
    print("    verdict        \(j.verdict)  [\(probs)]  confidence \(fmt(j.verdictConfidence))")
    print("")
    let cost = Double(j.inputTokens) * jevUSDPerInputToken
    print(
      "\(ANSI.dim)jev \(Int((ev.latencyMs ?? 0).rounded()))ms · \(j.inputTokens) in / \(j.outputTokens) out tokens · $\(String(format: "%.6f", cost))\(ANSI.reset)"
    )
  } else {
    print(Banner.offlineNote(ev.error?.description ?? "unknown"))
  }
  let color: String
  switch ev.decision {
  case .run: color = ANSI.green
  case .confirm: color = ANSI.yellow
  case .block: color = ANSI.red
  }
  let why = ev.decision.reasons.isEmpty ? "" : "  (\(Banner.reasons(ev.decision.reasons)))"
  print("\(color)\(ANSI.bold)decision: \(ev.decision.label)\(ANSI.reset)\(why)")
  return 0
}

// MARK: - bench

let benchCommands: [String] = [
  "ls", "ls -la", "pwd", "git status", "git log --oneline -5", "git diff", "npm test",
  "npm run build", "cargo build --release", "swift build", "make", "python3 -m pytest",
  "cat README.md", "grep -rn TODO src", "find . -name '*.swift'", "docker ps", "kubectl get pods",
  "brew update", "cd ..", "echo hello", "mkdir -p build", "touch notes.txt",
  "cp README.md README.bak", "mv notes.txt docs/", "tar czf backup.tgz src",
  "curl https://example.com",
  "ssh dev.internal uptime", "git checkout -b feature/x", "git commit -am wip", "git push",
  "rm -rf ./build", "rm -rf node_modules", "rm -rf dist .cache", "git stash", "git pull --rebase",
  "rm -rf ~/", "rm -rf /", "sudo rm -rf /usr", "git push --force origin main", "git reset --hard",
  "git clean -fdx", "git branch -D main",
  "curl -H 'Authorization: Bearer sk-live-9f8e7d6c5b4a3210' https://api.example.com/v1/charges",
  "mysql -u root -pHunter2Secret prod_db",
  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY aws s3 ls",
  "gti status", "sl -la", "pytohn app.py", "dokcer ps",
  "psql -h prod-db.internal -c 'DROP TABLE users'",
]

func runBench(_ args: [String]) -> Int32 {
  var heuristic = false
  var count = 50
  var i = 0
  while i < args.count {
    if args[i] == "--heuristic" { heuristic = true }
    if args[i] == "-n", i + 1 < args.count { count = Int(args[i + 1]) ?? count }
    i += 1
  }
  let config = Config.load()
  let cwd = FileManager.default.currentDirectoryPath
  var latencies: [Double] = []
  var tokens: [Int] = []
  var offline = 0
  var decisions: [String: Int] = [:]
  let wallStart = Date()
  print(
    "\(ANSI.dim)mode: \(heuristic ? "heuristic (regex only)" : "typesafe/jev-1.13") · \(count) commands · deadline \(config.deadlineMs)ms\(ANSI.reset)"
  )
  print("")
  for n in 0..<count {
    let command = benchCommands[n % benchCommands.count]
    let state = buildState(command: command, cwd: cwd, prev: [], toolFound: nil)
    let t0 = Date()
    let ev = evaluate(state, config: config, heuristicOnly: heuristic)
    let total = Date().timeIntervalSince(t0) * 1000
    if heuristic {
      latencies.append(total)
    } else if let ms = ev.latencyMs, let j = ev.judgment {
      latencies.append(ms)
      tokens.append(j.inputTokens)
    } else {
      offline += 1
    }
    decisions[ev.decision.label, default: 0] += 1
    let color: String
    switch ev.decision {
    case .run: color = ANSI.green
    case .confirm: color = ANSI.yellow
    case .block: color = ANSI.red
    }
    let ms = heuristic ? total : (ev.latencyMs ?? 0)
    let tag = ev.offline && !heuristic ? "offline" : "\(Int(ms.rounded()))ms"
    var why =
      ev.decision.reasons.isEmpty
      ? "" : "  \(ANSI.dim)\(Banner.reasons(ev.decision.reasons))\(ANSI.reset)"
    if let e = ev.error, !heuristic { why += "  \(ANSI.dim)(\(e.description))\(ANSI.reset)" }
    print(
      "  \(color)\(ev.decision.label.padding(toLength: 7, withPad: " ", startingAt: 0))\(ANSI.reset) \(tag.padding(toLength: 7, withPad: " ", startingAt: 0)) \(command)\(why)"
    )
  }
  let wall = Date().timeIntervalSince(wallStart)
  let sorted = latencies.sorted()
  let mean = sorted.isEmpty ? 0 : sorted.reduce(0, +) / Double(sorted.count)
  let meanTokens = tokens.isEmpty ? 0 : Double(tokens.reduce(0, +)) / Double(tokens.count)
  let cost = Double(tokens.reduce(0, +)) * jevUSDPerInputToken
  print("")
  print(
    "\(ANSI.bold)latency\(ANSI.reset)   p50 \(Int(Stats.percentile(sorted, 50).rounded()))ms · p95 \(Int(Stats.percentile(sorted, 95).rounded()))ms · mean \(Int(mean.rounded()))ms · min \(Int((sorted.first ?? 0).rounded()))ms · max \(Int((sorted.last ?? 0).rounded()))ms"
  )
  print(
    "\(ANSI.bold)throughput\(ANSI.reset) \(String(format: "%.1f", Double(count) / wall)) decisions/s sequential · \(count) requests · \(offline) offline"
  )
  if !heuristic {
    print(
      "\(ANSI.bold)tokens\(ANSI.reset)    mean \(Int(meanTokens.rounded())) input/decision · total \(tokens.reduce(0, +)) · $\(String(format: "%.5f", cost)) (\(String(format: "$%.7f", meanTokens * jevUSDPerInputToken))/decision)"
    )
  }
  let d = ["run", "confirm", "block"].map { "\($0) \(decisions[$0] ?? 0)" }.joined(separator: " · ")
  print("\(ANSI.bold)decisions\(ANSI.reset) \(d)")
  return 0
}

// MARK: - stats

func runStats(_ args: [String]) -> Int32 {
  if args.contains("--reset") {
    try? FileManager.default.removeItem(atPath: Stats.path)
    print("cleared \(Stats.path)")
    return 0
  }
  let records = Stats.load()
  guard !records.isEmpty else {
    print("no checks recorded yet (\(Stats.path))")
    return 0
  }
  let s = Stats.summarize(records)
  print("\(ANSI.bold)jevsh stats\(ANSI.reset)  \(ANSI.dim)\(Stats.path)\(ANSI.reset)")
  print("  requests    \(s.count) (\(s.online) answered by jev, \(s.count - s.online) offline)")
  print(
    "  latency     last \(Int(s.last.rounded()))ms · p50 \(Int(s.p50.rounded()))ms · p95 \(Int(s.p95.rounded()))ms · mean \(Int(s.mean.rounded()))ms"
  )
  print(
    "  throughput  \(String(format: "%.1f", s.decisionsPerSecond)) decisions/s (1000 / mean latency)"
  )
  print(
    "  tokens      \(Int(s.meanTokens.rounded())) input/decision · \(s.totalTokens) total · $\(String(format: "%.5f", s.costUSD))"
  )
  let d = ["run", "confirm", "block"].map { "\($0) \(s.decisions[$0] ?? 0)" }.joined(
    separator: " · ")
  print("  decisions   \(d)")
  return 0
}

func runConfig() -> Int32 {
  let enc = JSONEncoder()
  enc.outputFormatting = [.prettyPrinted, .sortedKeys]
  print("\(ANSI.dim)\(Config.path)\(ANSI.reset)")
  if let data = try? enc.encode(Config.load()) { print(String(decoding: data, as: UTF8.self)) }
  return 0
}

let argv = Array(CommandLine.arguments.dropFirst())
guard let sub = argv.first else {
  tty(usage)
  exit(2)
}
let rest = Array(argv.dropFirst())
switch sub {
case "check": exit(runCheck(rest))
case "explain": exit(runExplain(rest))
case "bench": exit(runBench(rest))
case "stats": exit(runStats(rest))
case "config": exit(runConfig())
case "-h", "--help", "help":
  print(usage)
  exit(0)
default:
  tty(usage)
  exit(2)
}
